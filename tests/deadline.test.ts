import { describe, expect, it } from 'vitest';
import { describeDeadline, deriveStatus, daysRemaining, URGENCY_META } from '@/lib/opportunity/deadline';

const now = new Date();
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

describe('deadline intelligence', () => {
  it('reports days remaining and an honest CTA for an open window', () => {
    const info = describeDeadline(inDays(12), inDays(-3));
    expect(info.daysRemaining).toBeGreaterThanOrEqual(11);
    expect(info.daysRemaining).toBeLessThanOrEqual(12);
    expect(info.isClosed).toBe(false);
    expect(info.cta).toMatch(/day/i);
  });

  it('bands urgency as critical for 0-2 days, high for 3-7, medium for 8-15', () => {
    expect(describeDeadline(inDays(1), null).urgency).toBe('critical');
    expect(describeDeadline(inDays(5), null).urgency).toBe('high');
    expect(describeDeadline(inDays(12), null).urgency).toBe('medium');
    expect(describeDeadline(inDays(30), null).urgency).toBe('normal');
    expect(URGENCY_META.critical).toBeDefined();
  });

  it('marks a past deadline closed rather than showing a negative countdown', () => {
    const info = describeDeadline(inDays(-5), inDays(-20));
    expect(info.isClosed).toBe(true);
    expect(info.cta).toMatch(/closed/i);
  });

  it('says the deadline is unknown when no date was published', () => {
    const info = describeDeadline(null, null);
    expect(info.daysRemaining).toBeNull();
    expect(info.formatted).toMatch(/unknown|not published/i);
  });

  it('formats dates for an Indian reader', () => {
    const info = describeDeadline('2026-11-06T18:29:00.000Z', null);
    expect(info.formatted).toMatch(/2026/);
    expect(info.formatted).toMatch(/November|Nov/);
  });

  it('treats an unparseable deadline as unknown rather than epoch zero', () => {
    const info = describeDeadline('not-a-date', null);
    expect(info.daysRemaining).toBeNull();
    expect(daysRemaining('not-a-date')).toBeNull();
  });
});

describe('exam status derivation', () => {
  it('never guesses: with no dates at all the status is needs_verification', () => {
    expect(deriveStatus({})).toBe('needs_verification');
  });

  it('reports applications_open while the window is live', () => {
    expect(deriveStatus({ applicationStart: inDays(-2), applicationDeadline: inDays(10) })).toBe('applications_open');
  });

  it('escalates to deadline_today and closing_soon as the window narrows', () => {
    const today = deriveStatus({ applicationStart: inDays(-5), applicationDeadline: inDays(0.4) });
    expect(['deadline_today', 'closing_soon']).toContain(today);
    expect(deriveStatus({ applicationStart: inDays(-5), applicationDeadline: inDays(4) })).toBe('closing_soon');
  });

  it('reports notification_expected when the window has not opened', () => {
    expect(deriveStatus({ applicationStart: inDays(20), applicationDeadline: inDays(40) })).toBe('notification_expected');
  });

  it('reports applications_closed once the window has passed', () => {
    expect(deriveStatus({ applicationStart: inDays(-40), applicationDeadline: inDays(-10) })).toBe('applications_closed');
  });

  it('prefers a published result over a stale open status', () => {
    expect(
      deriveStatus({ applicationStart: inDays(-60), applicationDeadline: inDays(-40), examDate: inDays(-20), resultStatus: 'declared' }),
    ).toBe('result_released');
  });
});
