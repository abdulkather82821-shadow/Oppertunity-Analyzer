import { afterEach, describe, expect, it } from 'vitest';
import { useTempDb } from './helpers/db';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import {
  ALERT_THRESHOLDS,
  deliverPendingEmails,
  emailStatus,
  generateDeadlineAlerts,
  isoWeekKey,
  runNotificationSweep,
  secretMatches,
  thresholdFor,
  watchedDeadlines,
  type MailMessage,
} from '@/lib/notifications';

useTempDb();

/**
 * Deadline alerts, digests and email delivery.
 *
 * The rules under test: alerts are idempotent, fire only for things the user is waiting on,
 * tell the truth about email (never "sent" without a provider), and never nag about a deadline
 * that has already passed or an application that has already been submitted.
 */

const DAY = 86_400_000;
const NOW = new Date('2026-09-30T04:00:00.000Z'); // 09:30 IST
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY).toISOString();

async function makeUser(label: string, settings: Record<string, unknown> = {}) {
  const id = uid();
  const now = nowIso();
  await insertRow('users', { id, email: `${label}-${id.slice(0, 6)}@example.test`, name: label, role: 'candidate', created_at: now, updated_at: now });
  await insertRow('user_settings', { user_id: id, updated_at: now, ...settings });
  return id;
}

async function makeOpportunity(title: string, deadline: string | null, extra: Record<string, unknown> = {}) {
  const id = uid();
  const now = nowIso();
  await insertRow('opportunities', {
    id,
    canonical_key: `k-${id}`,
    title,
    type: 'job',
    organization: 'Acme Finance',
    application_deadline: deadline,
    status: 'applications_open',
    first_discovered: now,
    created_at: now,
    updated_at: now,
    ...extra,
  });
  return id;
}

const save = (userId: string, opportunityId: string) =>
  insertRow('saved_opportunities', { id: uid(), user_id: userId, opportunity_id: opportunityId, created_at: nowIso() });

const alertsFor = (userId: string, channel = 'in_app') =>
  db.query<any>(`SELECT * FROM notifications WHERE user_id = ? AND kind = 'deadline' AND channel = ? ORDER BY created_at`, [userId, channel]);

describe('alert thresholds', () => {
  it('picks the tightest applicable threshold and nothing outside the window', () => {
    expect(ALERT_THRESHOLDS).toEqual([7, 3, 1, 0]);
    expect(thresholdFor(7)).toBe(7);
    expect(thresholdFor(5)).toBe(7);
    expect(thresholdFor(3)).toBe(3);
    expect(thresholdFor(2)).toBe(3);
    expect(thresholdFor(1)).toBe(1);
    expect(thresholdFor(0)).toBe(0);
    expect(thresholdFor(8)).toBeNull();
    expect(thresholdFor(40)).toBeNull();
  });

  it('never alerts for a passed or unknown deadline', () => {
    expect(thresholdFor(-1)).toBeNull();
    expect(thresholdFor(null)).toBeNull();
    expect(thresholdFor(Number.NaN)).toBeNull();
  });

  it('computes ISO week keys on the IST calendar', () => {
    expect(isoWeekKey(new Date('2026-09-30T04:00:00.000Z'))).toBe('2026-W40');
    // 19:00 UTC on Sunday is already Monday in India, so it belongs to the NEXT ISO week.
    expect(isoWeekKey(new Date('2026-10-04T19:00:00.000Z'))).toBe('2026-W41');
  });
});

describe('deadline alerts', () => {
  it('alerts for a saved item inside the window, with the IST date and a verify reminder', async () => {
    const user = await makeUser('saver');
    const job = await makeOpportunity('Junior Accountant', inDays(2));
    await save(user, job);

    const outcome = await generateDeadlineAlerts(user, NOW);
    expect(outcome.created).toBe(1);

    const [alert] = await alertsFor(user);
    expect(alert.title).toBe('Deadline in 2 days — Junior Accountant');
    expect(alert.body).toMatch(/\(IST\)/);
    expect(alert.body).toMatch(/official notification/i);
    expect(alert.link).toBe(`/opportunity/${job}`);
    expect(alert.read_at).toBeNull();
  });

  it('is idempotent: generating twice never produces a second alert', async () => {
    const user = await makeUser('idem');
    await save(user, await makeOpportunity('Tax Associate', inDays(1)));
    expect((await generateDeadlineAlerts(user, NOW)).created).toBe(1);
    expect((await generateDeadlineAlerts(user, NOW)).created).toBe(0);
    expect(await alertsFor(user)).toHaveLength(1);
  });

  it('escalates as the deadline closes, one alert per threshold', async () => {
    const user = await makeUser('escalate');
    const job = await makeOpportunity('Audit Trainee', inDays(6));
    await save(user, job);

    await generateDeadlineAlerts(user, NOW); // 6 days → the 7-day alert
    const dayBefore = new Date(NOW.getTime() + 5 * DAY);
    await generateDeadlineAlerts(user, dayBefore); // 1 day left → the 1-day alert
    const alerts = await alertsFor(user);
    expect(alerts.map((a) => a.title)).toEqual(['Deadline in 6 days — Audit Trainee', 'Deadline tomorrow — Audit Trainee']);
  });

  it('alerts again when a deadline is extended to a new date', async () => {
    const user = await makeUser('extended');
    const job = await makeOpportunity('Clerk', inDays(1));
    await save(user, job);
    await generateDeadlineAlerts(user, NOW);

    // The organisation extends the window; the new date is a different alert, not a duplicate.
    await db.run('UPDATE opportunities SET application_deadline = ? WHERE id = ?', [inDays(2), job]);
    expect((await generateDeadlineAlerts(user, NOW)).created).toBe(1);
  });

  it('stays quiet outside the window, after the deadline, and with no deadline at all', async () => {
    const user = await makeUser('quiet');
    await save(user, await makeOpportunity('Far away', inDays(30)));
    await save(user, await makeOpportunity('Already closed', inDays(-2)));
    await save(user, await makeOpportunity('No date published', null));
    expect((await generateDeadlineAlerts(user, NOW)).created).toBe(0);
  });

  it('respects the user having switched deadline alerts off', async () => {
    const user = await makeUser('optout', { notify_deadline: 0 });
    await save(user, await makeOpportunity('Junior Accountant', inDays(1)));
    const outcome = await generateDeadlineAlerts(user, NOW);
    expect(outcome).toEqual({ created: 0, emailQueued: 0, skipped: 'disabled' });
  });

  it('watches to-apply items but not ones already applied for', async () => {
    const user = await makeUser('applications');
    const pending = await makeOpportunity('Still to apply', inDays(2));
    const done = await makeOpportunity('Already applied', inDays(2));
    const now = nowIso();
    await insertRow('applications', { id: uid(), user_id: user, opportunity_id: pending, title: 'x', status: 'to_apply', created_at: now, updated_at: now });
    await insertRow('applications', { id: uid(), user_id: user, opportunity_id: done, title: 'y', status: 'applied', created_at: now, updated_at: now });

    const watched = (await watchedDeadlines(user)).map((w) => w.title);
    expect(watched).toEqual(['Still to apply']);
  });

  it('alerts once when an exam and its parent opportunity are both saved', async () => {
    const user = await makeUser('dedupe');
    const opp = await makeOpportunity('SSC CGL 2026', inDays(2));
    const now = nowIso();
    const examId = uid();
    await insertRow('government_exams', {
      id: examId, opportunity_id: opp, exam_name: 'SSC CGL 2026', organization: 'SSC', application_deadline: inDays(2), created_at: now, updated_at: now,
    });
    await save(user, opp);
    await insertRow('saved_opportunities', { id: uid(), user_id: user, exam_id: examId, created_at: now });
    expect((await generateDeadlineAlerts(user, NOW)).created).toBe(1);
  });

  it("never reads another user's saved items", async () => {
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');
    await save(owner, await makeOpportunity('Private to owner', inDays(1)));
    expect((await generateDeadlineAlerts(stranger, NOW)).created).toBe(0);
    expect(await alertsFor(stranger)).toHaveLength(0);
  });
});

describe('email delivery', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('reports exactly what is configured, never more', () => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_HOST;
    expect(emailStatus()).toMatchObject({ provider: null, configured: false });

    process.env.EMAIL_PROVIDER = 'smtp';
    expect(emailStatus()).toMatchObject({ provider: 'smtp', configured: false }); // no host yet
    process.env.SMTP_HOST = 'smtp.example.test';
    expect(emailStatus()).toMatchObject({ provider: 'smtp', configured: true });

    process.env.EMAIL_PROVIDER = 'console';
    expect(emailStatus()).toMatchObject({ provider: 'console', configured: true });
  });

  it('does not queue any email when no provider is configured, even if the user opted in', async () => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_HOST;
    const user = await makeUser('wants-email', { notify_email: 1 });
    await save(user, await makeOpportunity('Junior Accountant', inDays(1)));
    const outcome = await generateDeadlineAlerts(user, NOW);
    expect(outcome.created).toBe(1);
    expect(outcome.emailQueued).toBe(0);
    expect(await alertsFor(user, 'email')).toHaveLength(0);
  });

  it('queues and delivers email when a provider is configured, marking only real sends as sent', async () => {
    process.env.EMAIL_PROVIDER = 'console';
    const user = await makeUser('email-user', { notify_email: 1 });
    await save(user, await makeOpportunity('Payroll Executive', inDays(1)));
    const outcome = await generateDeadlineAlerts(user, NOW);
    expect(outcome.emailQueued).toBe(1);

    const sent: MailMessage[] = [];
    const result = await deliverPendingEmails({ transport: { sendMail: async (m) => void sent.push(m) } });
    expect(result).toMatchObject({ sent: 1, failed: 0, skipped: false });
    expect(sent[0].subject).toBe('Deadline tomorrow — Payroll Executive');
    expect(sent[0].text).toMatch(/verify dates and eligibility/i);
    expect(sent[0].to).toMatch(/email-user/);

    const [row] = await alertsFor(user, 'email');
    expect(row.sent_at).not.toBeNull();
    // A second pass finds nothing left to send.
    expect(await deliverPendingEmails({ transport: { sendMail: async () => { throw new Error('must not be called'); } } })).toMatchObject({ sent: 0, pending: 0 });
  });

  it('records a failed send as a failure instead of pretending it was delivered', async () => {
    process.env.EMAIL_PROVIDER = 'console';
    const user = await makeUser('fails', { notify_email: 1 });
    await save(user, await makeOpportunity('Cashier', inDays(1)));
    await generateDeadlineAlerts(user, NOW);

    const result = await deliverPendingEmails({ transport: { sendMail: async () => { throw new Error('550 mailbox unavailable'); } } });
    expect(result).toMatchObject({ sent: 0, failed: 1 });
    const [row] = await alertsFor(user, 'email');
    expect(row.sent_at).toBeNull();
    expect(row.error).toMatch(/550 mailbox unavailable/);
  });

  it('leaves queued email untouched and says why when the provider disappears', async () => {
    process.env.EMAIL_PROVIDER = 'console';
    const user = await makeUser('orphaned', { notify_email: 1 });
    await save(user, await makeOpportunity('Accounts Clerk', inDays(1)));
    await generateDeadlineAlerts(user, NOW);

    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_HOST;
    const result = await deliverPendingEmails();
    expect(result.skipped).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.reason).toMatch(/no email provider/i);
    const [row] = await alertsFor(user, 'email');
    expect(row.sent_at).toBeNull();
    expect(row.error).toBeNull(); // still queued, not failed
  });
});

describe('sweep', () => {
  it('generates alerts for every active user and skips suspended accounts', async () => {
    const active = await makeUser('sweep-active');
    const suspended = await makeUser('sweep-suspended');
    await db.run("UPDATE users SET status = 'suspended' WHERE id = ?", [suspended]);
    const job = await makeOpportunity('Shared listing', inDays(1));
    await save(active, job);
    await save(suspended, job);

    const outcome = await runNotificationSweep({ includeDigests: false, now: NOW });
    expect(outcome.errors).toEqual([]);
    expect(await alertsFor(active)).toHaveLength(1);
    expect(await alertsFor(suspended)).toHaveLength(0);
  });
});

describe('cron secret', () => {
  it('matches only the exact secret and is closed when none is configured', () => {
    expect(secretMatches('s3cret', 's3cret')).toBe(true);
    expect(secretMatches('s3cret', 'other')).toBe(false);
    expect(secretMatches('', 's3cret')).toBe(false);
    expect(secretMatches(null, 's3cret')).toBe(false);
    // With CRON_SECRET unset the header path must be closed, not open.
    expect(secretMatches('anything', undefined)).toBe(false);
    expect(secretMatches('anything', '')).toBe(false);
  });
});

