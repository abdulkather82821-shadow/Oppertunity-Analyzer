import { normaliseWeights } from '@/lib/opportunity/matcher';
import { route, json } from '@/lib/api/route';
import { settingsSchema } from '@/lib/api/schemas';
import { db, bool, jsonList, nowIso, num } from '@/lib/db';
import { requirePermission } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'profile.read');
  const row = await db.one<any>('SELECT * FROM user_settings WHERE user_id = ?', [user.id]);
  return json({
    settings: row
      ? {
          preferredLocations: jsonList<string>(row.preferred_locations),
          preferredJobTypes: jsonList<string>(row.preferred_job_types),
          salaryMin: num(row.salary_min),
          salaryMax: num(row.salary_max),
          currency: row.currency,
          timezone: row.timezone,
          dateFormat: row.date_format,
          notifyDeadline: bool(row.notify_deadline),
          notifyNewMatch: bool(row.notify_new_match),
          notifyExam: bool(row.notify_exam),
          notifyBrowser: bool(row.notify_browser),
          notifyEmail: bool(row.notify_email),
          digestDaily: bool(row.digest_daily),
          digestWeekly: bool(row.digest_weekly),
          organizationId: row.organization_id,
          scoringWeights: row.scoring_weights ? JSON.parse(row.scoring_weights) : null,
        }
      : null,
    // What "reset to defaults" means right now: the built-in weights, or the administrator's
    // configured ones. Sent by the server so the page never hard-codes a different answer.
    defaults: { scoringWeights: Object.fromEntries(Object.entries(normaliseWeights(null)).map(([key, value]) => [key, Math.round(value)])) },
  });
}, { csrf: false });

export const PATCH = route(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'profile.update');
  const row = await db.one<any>('SELECT * FROM user_settings WHERE user_id = ?', [user.id]);
  const now = nowIso();

  const updates: Record<string, unknown> = { updated_at: now };
  if (body.preferredLocations) updates.preferred_locations = JSON.stringify(body.preferredLocations);
  if (body.preferredJobTypes) updates.preferred_job_types = JSON.stringify(body.preferredJobTypes);
  if (body.salaryMin !== undefined) updates.salary_min = body.salaryMin;
  if (body.salaryMax !== undefined) updates.salary_max = body.salaryMax;
  if (body.currency) updates.currency = body.currency;
  if (body.timezone) updates.timezone = body.timezone;
  if (body.dateFormat) updates.date_format = body.dateFormat;
  if (body.notifyDeadline !== undefined) updates.notify_deadline = body.notifyDeadline ? 1 : 0;
  if (body.notifyNewMatch !== undefined) updates.notify_new_match = body.notifyNewMatch ? 1 : 0;
  if (body.notifyExam !== undefined) updates.notify_exam = body.notifyExam ? 1 : 0;
  if (body.notifyBrowser !== undefined) updates.notify_browser = body.notifyBrowser ? 1 : 0;
  if (body.notifyEmail !== undefined) updates.notify_email = body.notifyEmail ? 1 : 0;
  if (body.digestDaily !== undefined) updates.digest_daily = body.digestDaily ? 1 : 0;
  if (body.digestWeekly !== undefined) updates.digest_weekly = body.digestWeekly ? 1 : 0;
  if (body.scoringWeights) updates.scoring_weights = JSON.stringify(body.scoringWeights);

  if (row) {
    const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    await db.run(`UPDATE user_settings SET ${sets} WHERE user_id = ?`, [...Object.values(updates), user.id]);
  } else {
    const columns = ['user_id', ...Object.keys(updates)];
    const values = [user.id, ...Object.values(updates)];
    await db.run(`INSERT INTO user_settings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
  }

  await audit({ userId: user.id, action: 'settings.update', resourceType: 'user_settings', resourceId: user.id, newValue: body, ip: meta.ip });
  return json({ ok: true });
}, { schema: settingsSchema });
