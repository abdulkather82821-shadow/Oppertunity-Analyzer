import { route, json } from '@/lib/api/route';
import { adminUserSchema } from '@/lib/api/schemas';
import { db, nowIso } from '@/lib/db';
import { requirePermission, forbidden, notFound, badRequest } from '@/lib/auth/rbac';
import { ROLE_LABELS, ROLE_RANK, isPrivilegedRole, type Role } from '@/lib/auth/permissions';
import { revokeAllSessions } from '@/lib/auth/session';
import { audit, logSecurity } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  await requirePermission(request, 'user.read');
  const rows = await db.query(
    `SELECT id, email, name, role, status, auth_provider, email_verified, two_factor_enabled,
            last_login_at, failed_login_count, created_at
       FROM users ORDER BY created_at DESC LIMIT 200`,
  );
  const sessions = await db.query(
    'SELECT user_id, COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ? GROUP BY user_id',
    [nowIso()],
  );
  const active = new Map((sessions as any[]).map((row) => [row.user_id, Number(row.n)]));
  return json({
    users: rows.map((row: any) => ({
      ...row,
      roleLabel: ROLE_LABELS[row.role as Role] ?? row.role,
      activeSessions: active.get(row.id) ?? 0,
    })),
    roles: Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label, rank: ROLE_RANK[key as Role] })),
  });
}, { csrf: false });

/**
 * PATCH /api/admin/users — suspend, reactivate, force-logout, or change a role.
 *
 * Escalation protection:
 *   • nobody can change their own role
 *   • only a super_admin can grant or hold a privileged role
 *   • privileged role changes require an explicit `confirm: true`
 *   • every change is audited with before/after values
 */
export const PATCH = route(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'user.manage_roles');
  const target = await db.one<any>('SELECT * FROM users WHERE id = ?', [body.userId]);
  if (!target) throw notFound('User not found.');

  const before = { role: target.role, status: target.status };
  const changes: Record<string, unknown> = { updated_at: nowIso() };

  if (body.role && body.role !== target.role) {
    if (target.id === user.id) throw forbidden('You cannot change your own role.');
    if (isPrivilegedRole(body.role) && user.role !== 'super_admin') {
      throw forbidden('Only a super admin can grant a privileged role.');
    }
    if (isPrivilegedRole(target.role) && user.role !== 'super_admin') {
      throw forbidden('Only a super admin can remove a privileged role.');
    }
    if (isPrivilegedRole(body.role) && !body.confirm) {
      throw badRequest('Granting a privileged role requires explicit confirmation (confirm: true).', { requiresConfirmation: true });
    }
    if (body.role === 'super_admin' && user.role !== 'super_admin') {
      throw forbidden('Only a super admin can create another super admin.');
    }
    changes.role = body.role;
    changes.mfa_required_for_role = ['admin', 'super_admin'].includes(body.role) ? 1 : 0;
  }

  if (body.status && body.status !== target.status) {
    if (target.id === user.id) throw forbidden('You cannot change your own account status.');
    if (ROLE_RANK[target.role as Role] > ROLE_RANK[user.role as Role]) {
      throw forbidden('You cannot modify an account with a higher role than yours.');
    }
    changes.status = body.status;
  }

  const keys = Object.keys(changes);
  if (keys.length === 1) throw badRequest('Nothing to change.');

  const sets = keys.map((key) => `${key} = ?`).join(', ');
  await db.run(`UPDATE users SET ${sets} WHERE id = ?`, [...keys.map((key) => changes[key]), target.id]);

  if (body.status === 'suspended' || (body.role && body.role !== target.role)) {
    const revoked = await revokeAllSessions(target.id);
    await logSecurity({ userId: target.id, event: 'role_change', detail: `sessions revoked: ${revoked}`, ip: meta.ip });
  }

  await audit({
    userId: user.id,
    actorEmail: user.email,
    actorRole: user.role,
    action: body.role ? 'user.manage_roles' : 'user.suspend',
    resourceType: 'user',
    resourceId: target.id,
    previousValue: before,
    newValue: { role: body.role, status: body.status },
    reason: body.reason ?? '',
    ip: meta.ip,
  });

  return json({ ok: true, user: { id: target.id, role: (changes.role as string) ?? target.role, status: (changes.status as string) ?? target.status } });
}, { schema: adminUserSchema });
