import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTempDb } from './helpers/db';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import { refreshConfig, resetConfigCache } from '@/lib/config';
import { runNotificationSweep } from '@/lib/notifications';

process.env.UPLOAD_DIR = mkdtempSync(path.join(os.tmpdir(), 'oaa-digest-uploads-'));
useTempDb();

/**
 * Daily digests start at the administrator's configured hour (India time), are created once per
 * day, and only for people who have a profile to personalise them with.
 */

let storage: typeof import('@/lib/services/profile-service');
beforeAll(async () => {
  storage = await import('@/lib/services/profile-service');
});

const RESUME = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'sample-resume.txt')));

async function userWithProfile(settings: Record<string, unknown>) {
  const id = uid();
  const now = nowIso();
  await insertRow('users', { id, email: `digest-${id.slice(0, 6)}@example.test`, name: 'Digest', role: 'candidate', created_at: now, updated_at: now });
  await insertRow('user_settings', { user_id: id, updated_at: now, ...settings });
  await storage.storeResume(id, { name: 'resume.txt', type: 'text/plain', bytes: RESUME });
  return id;
}

async function setHour(hour: string) {
  await db.run("DELETE FROM platform_config WHERE key = 'notifications.digest_hour_local'");
  await insertRow('platform_config', { key: 'notifications.digest_hour_local', value: hour, is_secret: 0, category: 'notifications', description: '', updated_at: nowIso() });
  resetConfigCache();
  await refreshConfig(true);
}

const digests = (userId: string) => db.query<any>("SELECT payload FROM notifications WHERE user_id = ? AND kind = 'digest' AND channel = 'in_app'", [userId]);

// 2026-09-30 in India: 03:00 IST = 21:30 UTC the day before; 09:00 IST = 03:30 UTC.
const AT_3AM_IST = new Date('2026-09-29T21:30:00.000Z');
const AT_9AM_IST = new Date('2026-09-30T03:30:00.000Z');

describe('daily digest timing', () => {
  it('waits for the configured hour, then creates one digest per day', async () => {
    vi.stubEnv('DIGEST_HOUR_LOCAL', '');
    const user = await userWithProfile({ digest_daily: 1, digest_weekly: 0 });
    await setHour('8');

    expect((await runNotificationSweep({ now: AT_3AM_IST })).digestsCreated).toBe(0); // too early
    expect(await digests(user)).toHaveLength(0);

    expect((await runNotificationSweep({ now: AT_9AM_IST })).digestsCreated).toBe(1);
    expect(await digests(user)).toHaveLength(1);

    expect((await runNotificationSweep({ now: AT_9AM_IST })).digestsCreated).toBe(0); // same day: not again
    expect(await digests(user)).toHaveLength(1);
  }, 60_000);

  it('follows the hour an administrator sets: a digest at 03:00 when the hour is 0', async () => {
    vi.stubEnv('DIGEST_HOUR_LOCAL', '');
    const user = await userWithProfile({ digest_daily: 1, digest_weekly: 0 });
    await setHour('0');
    expect((await runNotificationSweep({ now: AT_3AM_IST })).digestsCreated).toBeGreaterThanOrEqual(1);
    expect(await digests(user)).toHaveLength(1);
  }, 60_000);

  it('skips people who have switched digests off, and people with no profile to personalise from', async () => {
    vi.stubEnv('DIGEST_HOUR_LOCAL', '');
    await setHour('0');
    const off = await userWithProfile({ digest_daily: 0, digest_weekly: 0 });
    const noProfile = uid();
    const now = nowIso();
    await insertRow('users', { id: noProfile, email: `noprofile-${noProfile.slice(0, 6)}@example.test`, name: 'No profile', role: 'candidate', created_at: now, updated_at: now });
    await insertRow('user_settings', { user_id: noProfile, digest_daily: 1, updated_at: now });

    await runNotificationSweep({ now: new Date('2026-10-05T10:00:00.000Z') });
    expect(await digests(off)).toHaveLength(0);
    expect(await digests(noProfile)).toHaveLength(0); // never send a generic digest
  }, 60_000);
});
