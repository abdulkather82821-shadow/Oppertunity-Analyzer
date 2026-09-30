import { configInt } from '@/lib/config';
/**
 * Deadline intelligence.
 *
 * India Standard Time is a fixed UTC+05:30 offset with no daylight saving, so every
 * "days remaining" figure is computed against an IST-normalised date. Official Indian
 * notifications quote deadlines in IST (commonly "23:00 hrs"), and getting this wrong by
 * a day is the single most damaging bug a deadline tracker can have.
 */

export const IST_OFFSET_MINUTES = 330;

export type Urgency = 'critical' | 'high' | 'medium' | 'normal' | 'closed' | 'unknown';

export type ExamStatus =
  | 'applications_open'
  | 'closing_soon'
  | 'deadline_today'
  | 'applications_closed'
  | 'exam_upcoming'
  | 'admit_card_released'
  | 'exam_completed'
  | 'result_released'
  | 'notification_expected'
  | 'needs_verification';

export const STATUS_META: Record<ExamStatus, { label: string; dot: string; tone: string }> = {
  applications_open: { label: 'Applications Open', dot: '🟢', tone: 'success' },
  closing_soon: { label: 'Closing Soon', dot: '🟡', tone: 'warning' },
  deadline_today: { label: 'Application Deadline Today', dot: '🟠', tone: 'danger' },
  applications_closed: { label: 'Applications Closed', dot: '🔴', tone: 'muted' },
  exam_upcoming: { label: 'Exam Upcoming', dot: '🔵', tone: 'info' },
  admit_card_released: { label: 'Admit Card Released', dot: '🟣', tone: 'info' },
  exam_completed: { label: 'Exam Completed', dot: '⚫', tone: 'muted' },
  result_released: { label: 'Result Released', dot: '🟢', tone: 'success' },
  notification_expected: { label: 'Notification Expected', dot: '⚪', tone: 'neutral' },
  needs_verification: { label: 'Needs Verification', dot: '⚠️', tone: 'warning' },
};

export const URGENCY_META: Record<Urgency, { label: string; tone: string; description: string }> = {
  critical: { label: 'Critical', tone: 'danger', description: '0–2 days remaining' },
  high: { label: 'High', tone: 'warning', description: '3–7 days remaining' },
  medium: { label: 'Medium', tone: 'caution', description: '8–15 days remaining' },
  normal: { label: 'Normal', tone: 'info', description: '16+ days remaining' },
  closed: { label: 'Closed', tone: 'muted', description: 'Deadline has passed' },
  unknown: { label: 'Unknown', tone: 'neutral', description: 'No verified deadline available' },
};

/** Parse a date into a UTC instant, treating the value as an IST wall-clock date. */
export function parseIstDate(value: string | null | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  // Already an ISO instant — take it as-is.
  const isoWithTime = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
  const isoTimeMatch = trimmed.match(isoWithTime);
  if (isoTimeMatch) {
    const hasExplicitZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
    if (hasExplicitZone) {
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const [, y, m, d, hh, mm, ss] = isoTimeMatch;
    return istToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), Number(ss ?? 0));
  }

  const plainIso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plainIso) {
    const [, y, m, d] = plainIso;
    return endOfDay ? istToUtc(+y, +m, +d, 23, 59, 59) : istToUtc(+y, +m, +d, 0, 0, 0);
  }

  // Indian formats: DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const indian = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (indian) {
    let [, a, b, y] = indian;
    let day = Number(a);
    let month = Number(b);
    if (day > 12 && month <= 12) {
      /* DD/MM — correct already */
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day]; // MM/DD → swap
    }
    let year = Number(y);
    if (year < 100) year += year <= 49 ? 2000 : 1900;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return endOfDay ? istToUtc(year, month, day, 23, 59, 59) : istToUtc(year, month, day, 0, 0, 0);
  }

  // "20 September 2026" / "20 Sep 2026"
  const long = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/);
  if (long) {
    const months: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    };
    const month = months[long[2].toLowerCase().slice(0, 4)];
    if (!month) return null;
    const day = Number(long[1]);
    if (day < 1 || day > 31) return null;
    return endOfDay ? istToUtc(Number(long[3]), month, day, 23, 59, 59) : istToUtc(Number(long[3]), month, day, 0, 0, 0);
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function istToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMillis);
}

/** Format an instant as an IST calendar date, e.g. "20 September 2026". */
export function formatIstDate(value: string | Date | null | undefined, options?: { withTime?: boolean }): string {
  const date = value instanceof Date ? value : parseIstDate(value ?? null);
  if (!date || Number.isNaN(date.getTime())) return 'Unknown';
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const day = shifted.getUTCDate();
  const month = shifted.getUTCMonth();
  const year = shifted.getUTCFullYear();
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const base = `${day} ${months[month]} ${year}`;
  if (!options?.withTime) return base;
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${base}, ${hh}:${mm} IST`;
}

/**
 * Whole IST calendar days between now and a deadline — not 24h blocks.
 * A deadline of "tomorrow 23:00 IST" is 1 day away even if it is 4 hours off.
 */
export function daysRemaining(deadline: string | Date | null | undefined, now = new Date()): number | null {
  const target = deadline instanceof Date ? deadline : parseIstDate(deadline ?? null, true);
  if (!target) return null;
  const nowIst = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const targetIst = new Date(target.getTime() + IST_OFFSET_MINUTES * 60_000);
  const a = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate());
  const b = Date.UTC(targetIst.getUTCFullYear(), targetIst.getUTCMonth(), targetIst.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

export function urgencyFor(days: number | null): Urgency {
  if (days === null) return 'unknown';
  if (days < 0) return 'closed';
  if (days <= 2) return 'critical';
  if (days <= 7) return 'high';
  if (days <= 15) return 'medium';
  return 'normal';
}

export interface DeadlineInfo {
  deadline: string | null;
  formatted: string;
  daysRemaining: number | null;
  urgency: Urgency;
  urgencyLabel: string;
  cta: string;
  isClosed: boolean;
  isOpen: boolean;
  opensInDays: number | null;
}

export function describeDeadline(
  deadline: string | null | undefined,
  startDate: string | null | undefined,
  now = new Date(),
): DeadlineInfo {
  const parsed = parseIstDate(deadline ?? null, true);
  const days = daysRemaining(parsed, now);
  const urgency = urgencyFor(days);
  const start = parseIstDate(startDate ?? null, false);
  const opensInDays = start ? daysRemaining(start, now) : null;
  const notYetOpen = opensInDays !== null && opensInDays > 0;

  let cta = 'Verify deadline on the official notification';
  if (days === null) cta = notYetOpen ? `Applications open in ${opensInDays} day(s)` : 'Deadline not published — check the official source';
  else if (days < 0) cta = 'Application Closed';
  else if (days === 0) cta = 'Apply Now — Deadline Today';
  else if (days <= 2) cta = `Apply Now — Deadline in ${days} Day${days === 1 ? '' : 's'}`;
  else if (notYetOpen) cta = `Applications open in ${opensInDays} day(s)`;
  else cta = `Apply — ${days} days remaining`;

  return {
    deadline: parsed ? parsed.toISOString() : null,
    formatted: parsed ? formatIstDate(parsed) : 'Unknown',
    daysRemaining: days,
    urgency,
    urgencyLabel: URGENCY_META[urgency].label,
    cta,
    isClosed: days !== null && days < 0,
    isOpen: days !== null && days >= 0 && !notYetOpen,
    opensInDays: notYetOpen ? opensInDays : null,
  };
}

export interface StatusInput {
  applicationStart?: string | null;
  applicationDeadline?: string | null;
  examDate?: string | null;
  admitCardDate?: string | null;
  resultStatus?: string | null;
  answerKeyStatus?: string | null;
  notificationDate?: string | null;
  explicitStatus?: string | null;
  conflicts?: string[];
}

/**
 * Derives the status from verified dates. Where the dates are insufficient to decide
 * confidently the result is `needs_verification` — we never assert a status we cannot
 * support, and we never silently pick between conflicting sources.
 */
export function deriveStatus(input: StatusInput, now = new Date()): ExamStatus {
  if (input.conflicts && input.conflicts.length > 0) return 'needs_verification';
  if (input.explicitStatus && isKnownStatus(input.explicitStatus)) return input.explicitStatus as ExamStatus;

  const deadline = parseIstDate(input.applicationDeadline ?? null, true);
  const start = parseIstDate(input.applicationStart ?? null, false);
  const exam = parseIstDate(input.examDate ?? null, false);
  const admit = parseIstDate(input.admitCardDate ?? null, false);
  const notification = parseIstDate(input.notificationDate ?? null, false);

  if (input.resultStatus && input.resultStatus !== 'not_declared' && input.resultStatus !== 'unknown') return 'result_released';
  if (admit && admit.getTime() <= now.getTime()) return 'admit_card_released';
  if (exam && exam.getTime() < now.getTime()) return 'exam_completed';

  if (deadline) {
    const days = daysRemaining(deadline, now)!;
    if (days < 0) return exam ? 'exam_upcoming' : 'applications_closed';
    if (days === 0) return 'deadline_today';
    if (days <= 7) return 'closing_soon';
    if (start && start.getTime() > now.getTime()) return 'notification_expected';
    return 'applications_open';
  }

  if (exam && exam.getTime() >= now.getTime()) return 'exam_upcoming';
  if (notification) return 'applications_closed';
  if (start) return 'applications_open';
  // No dates at all. Reporting "notification expected" here would be a guess dressed up as
  // a status, so the honest answer is that this record needs verification.
  return 'needs_verification';
}

function isKnownStatus(value: string): boolean {
  return Object.keys(STATUS_META).includes(value);
}

/** Relative time such as "verified 3 hours ago". */
export function relativeTime(value: string | null | undefined, now = new Date()): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'never';
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(months / 12)} year(s) ago`;
}

/**
 * Verification scheduling: opportunities with near deadlines are re-checked sooner.
 * This is what keeps "closing soon" listings from going stale.
 */
export function nextVerificationDate(deadline: string | null | undefined, lastVerified: string | null, now = new Date()): string {
  const days = daysRemaining(deadline, now);
  // The configured interval is the ceiling; deadline-critical records are always re-checked
  // sooner than that, however long it is set.
  const ceiling = configInt('verification.recheck_hours');
  let intervalHours: number;
  if (days === null) intervalHours = ceiling;
  else if (days <= 2) intervalHours = Math.min(6, ceiling);
  else if (days <= 7) intervalHours = Math.min(12, ceiling);
  else if (days <= 30) intervalHours = Math.min(24, ceiling);
  else intervalHours = ceiling;
  const base = lastVerified ? new Date(lastVerified) : now;
  return new Date((Number.isNaN(base.getTime()) ? now.getTime() : base.getTime()) + intervalHours * 3_600_000).toISOString();
}
