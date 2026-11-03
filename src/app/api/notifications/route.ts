import { route, json } from '@/lib/api/route';
import { db, nowIso } from '@/lib/db';
import { requirePermission } from '@/lib/auth/rbac';
import { relativeTime } from '@/lib/opportunity/deadline';
import { emailStatus, generateDeadlineAlerts } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/**
 * GET /api/notifications
 *
 * Deadline alerts are generated lazily here for the signed-in user, from their own saved and
 * to-apply items. That keeps in-app alerts working with no scheduler at all; the sweep
 * endpoint only adds background generation, digests and email for people who are not online.
 * Generation is idempotent, and a failure must never stop the list from loading.
 */
export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'notification.read');

  let generated = 0;
  try {
    generated = (await generateDeadlineAlerts(user.id)).created;
  } catch (error) {
    console.error('[notifications] alert generation failed:', error);
  }

  const rows = await db.query<any>(
    `SELECT id, channel, kind, title, body, link, read_at, created_at FROM notifications
      WHERE user_id = ? AND channel = 'in_app' ORDER BY created_at DESC LIMIT 50`,
    [user.id],
  );
  const unread = await db.one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL`,
    [user.id],
  );
  const email = emailStatus();

  return json({
    notifications: rows.map((row) => ({ ...row, createdAtAgo: relativeTime(row.created_at), read: Boolean(row.read_at) })),
    unread: Number(unread?.n ?? 0),
    generated,
    // Tells the Settings screen the truth about email instead of letting a toggle imply delivery.
    email: { available: email.configured, provider: email.provider, reason: email.reason ?? null },
  });
}, { csrf: false });

/** PATCH /api/notifications?id=… (or no id to mark all read) */
export const PATCH = route(async (request) => {
  const { user } = await requirePermission(request, 'notification.manage');
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?', [nowIso(), id, user.id]);
  } else {
    await db.run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL`, [nowIso(), user.id]);
  }
  return json({ ok: true });
});
