import { flagEnabled } from '@/lib/config';
import { route, json } from '@/lib/api/route';
import { db, bool, jsonList, num } from '@/lib/db';
import { permissionsFor, ROLE_LABELS, type Role } from '@/lib/auth/permissions';
import { unauthorized } from '@/lib/auth/rbac';
import { getCsrfToken } from '@/lib/auth/csrf';
import { mfaRequiredFor } from '@/lib/auth/mfa-policy';
import { aiStatus } from '@/lib/ai';
import { searchStatus } from '@/lib/search';

export const dynamic = 'force-dynamic';

export const GET = route(async (request, { user }) => {
  if (!user) throw unauthorized();
  const settings = await db.one<any>('SELECT * FROM user_settings WHERE user_id = ?', [user.id]);
  const profile = await db.one<any>('SELECT id, career_level, full_name, updated_at FROM candidate_profiles WHERE user_id = ?', [user.id]);
  const resume = await db.one<any>('SELECT id, original_name, size_bytes, parse_status, created_at FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [user.id]);
  const unread = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL`, [user.id]);

  return json({
    user: {
      ...user,
      roleLabel: ROLE_LABELS[user.role as Role] ?? user.role,
      permissions: permissionsFor(user.role),
      mfaRequired: mfaRequiredFor(user.role),
    },
    csrfToken: await getCsrfToken(),
    settings: settings
      ? {
          preferredLocations: jsonList<string>(settings.preferred_locations),
          preferredJobTypes: jsonList<string>(settings.preferred_job_types),
          salaryMin: num(settings.salary_min),
          salaryMax: num(settings.salary_max),
          currency: settings.currency,
          timezone: settings.timezone,
          dateFormat: settings.date_format,
          notifyDeadline: bool(settings.notify_deadline),
          notifyNewMatch: bool(settings.notify_new_match),
          notifyExam: bool(settings.notify_exam),
          notifyBrowser: bool(settings.notify_browser),
          notifyEmail: bool(settings.notify_email),
          digestDaily: bool(settings.digest_daily),
          digestWeekly: bool(settings.digest_weekly),
        }
      : null,
    hasProfile: Boolean(profile),
    profile: profile ? { id: profile.id, careerLevel: profile.career_level, name: profile.full_name } : null,
    hasResume: Boolean(resume),
    resume: resume ?? null,
    unreadNotifications: Number(unread?.n ?? 0),
    integrations: { ai: aiStatus(), search: searchStatus() },
    // What the administrator has switched on, so the UI never offers a control that would be refused.
    features: {
      browserNotifications: flagEnabled('browser_notifications'),
      resumeOptimizer: flagEnabled('resume_optimizer'),
      maintenance: flagEnabled('maintenance_mode'),
    },
  });
}, { csrf: false });
