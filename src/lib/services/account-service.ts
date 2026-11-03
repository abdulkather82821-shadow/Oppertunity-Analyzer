import fs from 'node:fs/promises';
import path from 'node:path';
import { db, nowIso } from '@/lib/db';
import { ApiError } from '@/lib/auth/rbac';
import { PRIVILEGED_ROLES } from '@/lib/auth/permissions';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit, logSecurity } from '@/lib/audit';
import { UPLOAD_DIR } from '@/lib/services/profile-service';

/**
 * Full data deletion for one account.
 *
 * Removes resumes from disk, then every row the user owns, then the account itself (which stays
 * as an anonymised tombstone so references remain valid), and revokes every session.
 *
 * Two exceptions, both about accountability:
 *   • the audit and security logs of a PRIVILEGED user are anonymised, not deleted. Otherwise an
 *     administrator could make a change and then delete their own account to erase the
 *     evidence. (A candidate's log rows concern their own data and are deleted with it.)
 *   • the last active super admin cannot delete themselves, which would leave nobody able to
 *     manage the platform.
 */
export async function deleteAccount(user: { id: string; role: string }, _meta: { ip?: string } = {}): Promise<{ resumesRemoved: number }> {
  if (user.role === 'super_admin') {
    const others = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND status = 'active' AND id <> ?`, [user.id]);
    if (!Number(others?.n ?? 0)) {
      throw new ApiError(409, 'You are the only active super admin. Make another account a super admin before deleting this one.', 'last_super_admin');
    }
  }
  const accountable = (PRIVILEGED_ROLES as string[]).includes(user.role);
  const resumes = await db.query<{ id: string; storage_path: string }>('SELECT id, storage_path FROM resumes WHERE user_id = ?', [user.id]);

  // Every database change happens in ONE transaction: the account is either deleted completely
  // or not at all. (Files are removed only after it commits, so a failure can never leave an
  // account half-deleted with its resume files already gone.)
  await db.transaction(async () => {
    // Tables keyed by user_id. The profile's children (education, experience, skills,
    // certifications, projects) are keyed by profile_id and are removed by the cascade from
    // `candidate_profiles`. Children come before parents.
    for (const table of [
      'feedback', 'notifications', 'deadlines', 'applications', 'saved_opportunities', 'resume_optimizations',
      'candidate_profiles', 'search_logs', 'search_jobs', 'ai_analysis', 'resumes', 'user_settings', 'sessions', 'analytics_events',
      ...(accountable ? [] : ['audit_logs', 'security_logs']),
    ]) {
      await db.run(`DELETE FROM ${table} WHERE user_id = ?`, [user.id]);
    }
    if (accountable) {
      // Keep what was done, drop who-and-where: the record of the action survives, the personal
      // identifiers do not.
      await db.run(`UPDATE audit_logs SET actor_email = 'deleted user', ip_address = '', session_id = '' WHERE user_id = ?`, [user.id]);
      await db.run(`UPDATE security_logs SET ip_address = '' WHERE user_id = ?`, [user.id]);
    }
    await db.run(`UPDATE users SET status = 'deleted', email = ?, name = 'Deleted user', password_hash = NULL, mfa_secret = NULL, updated_at = ? WHERE id = ?`, [
      `deleted-${user.id}@deleted.invalid`,
      nowIso(),
      user.id,
    ]);
  });

  for (const resume of resumes) {
    try {
      await fs.unlink(path.join(UPLOAD_DIR, resume.storage_path));
    } catch (error) {
      // The rows are already gone. An orphaned file is worth a loud log line, not a failure.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error(`[account] could not remove resume file ${resume.storage_path}:`, error);
    }
  }

  await revokeAllSessions(user.id);
  // The record that a deletion happened is kept (it is how compliance is shown), but it carries no
  // address: it must not re-create the personal data that was just erased.
  await logSecurity({ userId: user.id, event: 'account_deleted', detail: 'account deleted by owner', ip: '' });
  await audit({ userId: user.id, action: 'user.delete', resourceType: 'user', resourceId: user.id, reason: 'self-service account deletion', ip: '' });
  return { resumesRemoved: resumes.length };
}
