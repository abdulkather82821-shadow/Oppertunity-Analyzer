import { createHash, timingSafeEqual } from 'node:crypto';
import { bool, db, insertRow, nowIso, uid } from '@/lib/db';
import { configInt } from '@/lib/config';
import { daysRemaining, formatIstDate } from '@/lib/opportunity/deadline';

/**
 * Notifications: deadline alerts, digests and optional email delivery.
 *
 * Design rules
 *   • In-app alerts need no infrastructure. They are generated from the user's own saved and
 *     to-apply items, so a fresh install works with no SMTP server and no scheduler.
 *   • Every alert is idempotent. Each carries a `dedupeKey` in its payload; generating twice
 *     never produces two notifications, and a deadline *extension* (new date → new key)
 *     correctly alerts again.
 *   • Email is only queued when it can actually be sent. If no mail provider is configured
 *     nothing is marked as "sent" and no phantom email row is created.
 *   • Alerts never claim a deadline is certain. They link to the detail page, which shows
 *     the source, its verification status and the official notification.
 */

/** Days-before-deadline at which an alert fires. The tightest applicable threshold is used. */
export const ALERT_THRESHOLDS = [7, 3, 1, 0] as const;

export interface WatchedDeadline {
  targetKind: 'opportunity' | 'exam';
  targetId: string;
  title: string;
  organization: string;
  deadline: string;
  link: string;
  reason: 'saved' | 'to_apply';
}

/** Returns the threshold an item currently falls in, or null when no alert is due. */
export function thresholdFor(days: number | null): number | null {
  if (days === null || !Number.isFinite(days) || days < 0) return null;
  const applicable = ALERT_THRESHOLDS.filter((threshold) => days <= threshold);
  return applicable.length ? Math.min(...applicable) : null;
}

function istDay(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** ISO-8601 week key (e.g. 2026-W40) computed on the IST calendar date. */
export function isoWeekKey(now: Date): string {
  const [y, m, d] = istDay(now).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------
// Watched deadlines
// ---------------------------------------------------------------------------------------

/**
 * Everything the user is waiting on: saved opportunities and exams, plus applications that
 * are still only "interested" or "to apply". Anything already applied-for is excluded —
 * nagging someone about a deadline they have met is noise.
 */
export async function watchedDeadlines(userId: string): Promise<WatchedDeadline[]> {
  const [savedOpps, savedExams, appOpps, appExams] = await Promise.all([
    db.query<any>(
      `SELECT o.id, o.title, o.organization, o.application_deadline AS deadline
         FROM saved_opportunities s JOIN opportunities o ON o.id = s.opportunity_id
        WHERE s.user_id = ? AND o.is_active = 1 AND o.application_deadline IS NOT NULL`,
      [userId],
    ),
    db.query<any>(
      `SELECT e.id, e.exam_name AS title, e.organization, e.application_deadline AS deadline
         FROM saved_opportunities s JOIN government_exams e ON e.id = s.exam_id
        WHERE s.user_id = ? AND e.is_active = 1 AND e.application_deadline IS NOT NULL`,
      [userId],
    ),
    db.query<any>(
      `SELECT o.id, o.title, o.organization, o.application_deadline AS deadline
         FROM applications a JOIN opportunities o ON o.id = a.opportunity_id
        WHERE a.user_id = ? AND a.status IN ('interested', 'to_apply')
          AND o.is_active = 1 AND o.application_deadline IS NOT NULL`,
      [userId],
    ),
    db.query<any>(
      `SELECT e.id, e.exam_name AS title, e.organization, e.application_deadline AS deadline
         FROM applications a JOIN government_exams e ON e.id = a.exam_id
        WHERE a.user_id = ? AND a.status IN ('interested', 'to_apply')
          AND e.is_active = 1 AND e.application_deadline IS NOT NULL`,
      [userId],
    ),
  ]);

  const items: WatchedDeadline[] = [];
  const push = (rows: any[], targetKind: 'opportunity' | 'exam', reason: 'saved' | 'to_apply') => {
    for (const row of rows) {
      items.push({
        targetKind,
        targetId: row.id,
        title: String(row.title ?? '').trim() || 'Untitled opportunity',
        organization: String(row.organization ?? '').trim(),
        deadline: row.deadline,
        link: targetKind === 'exam' ? `/exam/${row.id}` : `/opportunity/${row.id}`,
        reason,
      });
    }
  };
  push(savedOpps, 'opportunity', 'saved');
  push(savedExams, 'exam', 'saved');
  push(appOpps, 'opportunity', 'to_apply');
  push(appExams, 'exam', 'to_apply');

  // An exam and its parent opportunity describe one thing; alert once, not twice.
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title.toLowerCase()}|${item.deadline.slice(0, 10)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------

interface NotificationPrefs {
  deadline: boolean;
  exam: boolean;
  email: boolean;
  browser: boolean;
  digestDaily: boolean;
  digestWeekly: boolean;
}

async function preferencesFor(userId: string): Promise<NotificationPrefs> {
  const row = await db.one<any>('SELECT * FROM user_settings WHERE user_id = ?', [userId]);
  // Defaults mirror the column defaults, so a user who never opened Settings behaves the same
  // as one who saved the defaults.
  return {
    deadline: row ? bool(row.notify_deadline) : true,
    exam: row ? bool(row.notify_exam) : true,
    email: row ? bool(row.notify_email) : false,
    browser: row ? bool(row.notify_browser) : false,
    digestDaily: row ? bool(row.digest_daily) : false,
    digestWeekly: row ? bool(row.digest_weekly) : true,
  };
}

// ---------------------------------------------------------------------------------------
// Email configuration
// ---------------------------------------------------------------------------------------

export interface EmailStatus {
  provider: 'smtp' | 'console' | null;
  configured: boolean;
  reason?: string;
}

export function emailStatus(): EmailStatus {
  const requested = (process.env.EMAIL_PROVIDER ?? (process.env.SMTP_HOST ? 'smtp' : '')).trim().toLowerCase();
  if (requested === 'smtp') {
    return process.env.SMTP_HOST
      ? { provider: 'smtp', configured: true }
      : { provider: 'smtp', configured: false, reason: 'EMAIL_PROVIDER=smtp but SMTP_HOST is not set.' };
  }
  if (requested === 'console') return { provider: 'console', configured: true };
  return { provider: null, configured: false, reason: 'No email provider is configured (set EMAIL_PROVIDER and SMTP_HOST).' };
}

// ---------------------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------------------

async function alreadyRecorded(userId: string, kind: string, channel: string, dedupeKey: string): Promise<boolean> {
  const row = await db.one(
    'SELECT id FROM notifications WHERE user_id = ? AND kind = ? AND channel = ? AND payload LIKE ?',
    [userId, kind, channel, `%"dedupeKey":"${dedupeKey}"%`],
  );
  return Boolean(row);
}

async function record(input: {
  userId: string;
  channel: 'in_app' | 'email';
  kind: 'deadline' | 'digest';
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
  extra?: Record<string, unknown>;
}): Promise<boolean> {
  if (await alreadyRecorded(input.userId, input.kind, input.channel, input.dedupeKey)) return false;
  await insertRow('notifications', {
    id: uid(),
    user_id: input.userId,
    channel: input.channel,
    kind: input.kind,
    title: input.title,
    body: input.body,
    link: input.link,
    payload: JSON.stringify({ dedupeKey: input.dedupeKey, ...(input.extra ?? {}) }),
    created_at: nowIso(),
  });
  return true;
}

// ---------------------------------------------------------------------------------------
// Deadline alerts
// ---------------------------------------------------------------------------------------

export interface AlertOutcome {
  created: number;
  emailQueued: number;
  skipped: 'disabled' | null;
}

export async function generateDeadlineAlerts(userId: string, now = new Date()): Promise<AlertOutcome> {
  const prefs = await preferencesFor(userId);
  if (!prefs.deadline) return { created: 0, emailQueued: 0, skipped: 'disabled' };

  const email = emailStatus();
  const wantsEmail = prefs.email && email.configured;
  let created = 0;
  let emailQueued = 0;

  for (const item of await watchedDeadlines(userId)) {
    // Exam-specific alerts can be switched off separately from job deadlines.
    if (item.targetKind === 'exam' && !prefs.exam) continue;

    const days = daysRemaining(item.deadline, now);
    const threshold = thresholdFor(days);
    if (threshold === null || days === null) continue;

    const dedupeKey = `deadline:${item.targetKind}:${item.targetId}:${threshold}:${item.deadline.slice(0, 10)}`;
    const headline = days === 0 ? 'Deadline today' : days === 1 ? 'Deadline tomorrow' : `Deadline in ${days} days`;
    const title = `${headline} — ${item.title}`;
    const body =
      `${item.organization ? `${item.organization}. ` : ''}Applications close ${formatIstDate(item.deadline)} (IST). ` +
      'Confirm the date on the official notification before you apply.';
    const extra = { targetKind: item.targetKind, targetId: item.targetId, days, threshold, deadline: item.deadline, reason: item.reason };

    if (await record({ userId, channel: 'in_app', kind: 'deadline', title, body, link: item.link, dedupeKey, extra })) created += 1;
    if (wantsEmail && (await record({ userId, channel: 'email', kind: 'deadline', title, body, link: item.link, dedupeKey, extra }))) {
      emailQueued += 1;
    }
  }
  return { created, emailQueued, skipped: null };
}

// ---------------------------------------------------------------------------------------
// Digest persistence
// ---------------------------------------------------------------------------------------

export async function persistDigestNotification(
  userId: string,
  digest: { headline: string; oneThingToDoToday: string; topJobs: unknown[]; closingSoon: unknown[]; bestMatch: { title: string } },
  dedupeKey: string,
): Promise<boolean> {
  const prefs = await preferencesFor(userId);
  const email = emailStatus();
  const common = {
    userId,
    kind: 'digest' as const,
    title: digest.headline,
    body: digest.oneThingToDoToday,
    link: '/dashboard',
    dedupeKey,
    extra: { topJobs: digest.topJobs.length, closingSoon: digest.closingSoon.length, bestMatch: digest.bestMatch.title },
  };
  const created = await record({ ...common, channel: 'in_app' });
  if (prefs.email && email.configured) await record({ ...common, channel: 'email' });
  return created;
}

// ---------------------------------------------------------------------------------------
// Sweep (cron / admin)
// ---------------------------------------------------------------------------------------

export interface SweepOutcome {
  users: number;
  alertsCreated: number;
  emailQueued: number;
  digestsCreated: number;
  errors: { userId: string; message: string }[];
}

export async function runNotificationSweep(options: { includeDigests?: boolean; now?: Date } = {}): Promise<SweepOutcome> {
  const now = options.now ?? new Date();
  const users = await db.query<{ id: string }>(`SELECT id FROM users WHERE status = 'active'`);
  const outcome: SweepOutcome = { users: users.length, alertsCreated: 0, emailQueued: 0, digestsCreated: 0, errors: [] };

  // Imported lazily: the profile service pulls in the parsing stack and the digest builder
  // pulls in the AI layer, neither of which the alert path (or a test that only needs alerts)
  // should have to load.
  const digests =
    options.includeDigests === false
      ? null
      : {
          loadProfile: (await import('@/lib/services/profile-service')).loadProfile,
          buildDigest: (await import('@/lib/ai/chat')).buildDigest,
        };

  for (const { id } of users) {
    try {
      const alerts = await generateDeadlineAlerts(id, now);
      outcome.alertsCreated += alerts.created;
      outcome.emailQueued += alerts.emailQueued;

      if (!digests) continue;
      const prefs = await preferencesFor(id);
      if (!prefs.digestDaily && !prefs.digestWeekly) continue;
      const profile = await digests.loadProfile(id);
      if (!profile) continue; // no resume, nothing to personalise — never send a generic digest

      const keys: string[] = [];
      // Daily digests start at the configured hour (India time), not at midnight.
      const istHour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
      if (prefs.digestDaily && istHour >= configInt('notifications.digest_hour_local')) keys.push(`digest:daily:${istDay(now)}`);
      if (prefs.digestWeekly) keys.push(`digest:weekly:${isoWeekKey(now)}`);
      const pending: string[] = [];
      for (const key of keys) if (!(await alreadyRecorded(id, 'digest', 'in_app', key))) pending.push(key);
      if (!pending.length) continue;

      const digest = await digests.buildDigest(id, profile);
      for (const key of pending) if (await persistDigestNotification(id, digest, key)) outcome.digestsCreated += 1;
    } catch (error) {
      outcome.errors.push({ userId: id, message: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }
  return outcome;
}

// ---------------------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------------------

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export interface DeliveryOutcome {
  sent: number;
  failed: number;
  pending: number;
  skipped: boolean;
  reason?: string;
}

async function buildTransport(): Promise<MailTransport | null> {
  const status = emailStatus();
  if (!status.configured) return null;
  if (status.provider === 'console') {
    return {
      async sendMail(message) {
        console.log(`[mail:console] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
      },
    };
  }
  const nodemailer = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: user ? { user, pass: process.env.SMTP_PASS ?? '' } : undefined,
  }) as unknown as MailTransport;
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export async function deliverPendingEmails(options: { transport?: MailTransport; limit?: number } = {}): Promise<DeliveryOutcome> {
  const rows = await db.query<any>(
    `SELECT n.id, n.title, n.body, n.link, u.email
       FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.channel = 'email' AND n.sent_at IS NULL AND n.error IS NULL AND u.status = 'active'
      ORDER BY n.created_at ASC LIMIT ?`,
    [options.limit ?? 100],
  );
  if (rows.length === 0) return { sent: 0, failed: 0, pending: 0, skipped: false };

  const transport = options.transport ?? (await buildTransport());
  if (!transport) {
    // Nothing is marked sent and nothing is marked failed: the rows stay queued, and the
    // caller is told why. Faking a send here would be exactly the dishonesty we avoid.
    return { sent: 0, failed: 0, pending: rows.length, skipped: true, reason: emailStatus().reason };
  }

  const from = process.env.EMAIL_FROM ?? 'Opportunity Analyzer <no-reply@localhost>';
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const link = row.link ? `${appBaseUrl()}${row.link}` : appBaseUrl();
    try {
      await transport.sendMail({
        from,
        to: row.email,
        subject: String(row.title).replace(/\s+/g, ' ').trim().slice(0, 200),
        text:
          `${row.body}\n\nOpen: ${link}\n\n` +
          'Opportunity Analyzer is a discovery assistant, not an authority. Always verify dates and eligibility ' +
          'against the official notification. You can change these emails in Settings.',
      });
      await db.run('UPDATE notifications SET sent_at = ? WHERE id = ?', [nowIso(), row.id]);
      sent += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await db.run('UPDATE notifications SET error = ? WHERE id = ?', [message.slice(0, 300), row.id]);
    }
  }
  return { sent, failed, pending: rows.length - sent - failed, skipped: false };
}

// ---------------------------------------------------------------------------------------
// Auth helper for the cron endpoint
// ---------------------------------------------------------------------------------------

/** Constant-time comparison of a presented secret against the configured one. */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

