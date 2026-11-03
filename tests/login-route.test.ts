import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDb } from './helpers/db';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { resetRateLimits } from '@/lib/rate-limit';
import { refreshConfig, resetConfigCache } from '@/lib/config';

// The route reads cookies through Next's request-scoped store, which does not exist in a unit
// test. A fake store that knows one CSRF token is all the route needs.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name === 'oaa_csrf' ? { value: 'test-csrf' } : undefined), set: () => undefined }),
}));

useTempDb();

/**
 * The sign-in route, called directly.
 *
 * Covers what the live test cannot: the administrator-set attempt limit taking effect, and the
 * account lock surviving a server restart (it lives in the database, not in memory).
 */

const PASSWORD = 'Correct-Horse-Battery-7';
let POST: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const attempt = async (email: string, password: string, ip: string) => {
  const response = await POST(
    new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'test-csrf', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password }),
    }),
    { params: Promise.resolve({}) },
  );
  return { status: response.status, body: (await response.json()) as any };
};

async function makeUser(label: string) {
  const id = uid();
  const now = nowIso();
  const email = `${label}-${id.slice(0, 6)}@example.test`;
  await insertRow('users', { id, email, name: label, role: 'candidate', password_hash: await hashPassword(PASSWORD), created_at: now, updated_at: now });
  return { id, email };
}

async function setLimit(value: string) {
  const exists = await db.one("SELECT key FROM platform_config WHERE key = 'security.rate_limit_login'");
  if (exists) await db.run("UPDATE platform_config SET value = ? WHERE key = 'security.rate_limit_login'", [value]);
  else await insertRow('platform_config', { key: 'security.rate_limit_login', value, is_secret: 0, category: 'security', description: '', updated_at: nowIso() });
  await refreshConfig(true);
}

beforeEach(async () => {
  vi.stubEnv('RATE_LIMIT_LOGIN', '');
  resetRateLimits();
  resetConfigCache();
  await db.run('DELETE FROM platform_config');
  POST = (await import('@/app/api/auth/login/route')).POST as typeof POST;
});

afterEach(() => vi.unstubAllEnvs());

describe('the per-IP attempt limit', () => {
  it('follows the administrator setting: refuses the attempt over the limit, and a raised limit applies at once', async () => {
    const { email } = await makeUser('limit');
    await setLimit('3');
    for (let i = 0; i < 3; i += 1) expect((await attempt(email, 'wrong', '203.0.113.7')).status).toBe(401);
    const over = await attempt(email, 'wrong', '203.0.113.7');
    expect(over.status).toBe(429);
    expect(over.body.code).toBe('rate_limited');

    await setLimit('50');
    expect((await attempt(email, 'wrong', '203.0.113.7')).status).toBe(401); // no longer refused
  });

  it('counts each address separately', async () => {
    const { email } = await makeUser('separate');
    await setLimit('3');
    for (let i = 0; i < 4; i += 1) await attempt(email, 'wrong', '203.0.113.50');
    expect((await attempt(email, 'wrong', '203.0.113.51')).status).toBe(401);
  });
});

describe('account lockout', () => {
  it('locks after ten failures from ANY mix of addresses, and refuses even the right password', async () => {
    const { id, email } = await makeUser('locked');
    for (let i = 0; i < 10; i += 1) expect((await attempt(email, `wrong-${i}`, `198.51.100.${i + 1}`)).status).toBe(401);

    const row = await db.one<any>('SELECT locked_until, failed_login_count FROM users WHERE id = ?', [id]);
    expect(new Date(row.locked_until).getTime()).toBeGreaterThan(Date.now());

    const refused = await attempt(email, PASSWORD, '198.51.100.99');
    expect(refused.status).toBe(401);
  });

  it('keeps the lock across a server restart, because it is stored in the database', async () => {
    const { email } = await makeUser('restart');
    for (let i = 0; i < 10; i += 1) await attempt(email, `wrong-${i}`, `198.51.100.${i + 1}`);

    resetRateLimits(); // what a restart does to in-memory counters
    expect((await attempt(email, PASSWORD, '198.51.100.120')).status).toBe(401);
  });

  it('lets the right password in again once the lock has expired, and clears the count', async () => {
    const { id, email } = await makeUser('expiry');
    for (let i = 0; i < 10; i += 1) await attempt(email, `wrong-${i}`, `198.51.100.${i + 1}`);
    await db.run('UPDATE users SET locked_until = ? WHERE id = ?', [new Date(Date.now() - 60_000).toISOString(), id]);
    resetRateLimits();

    const ok = await attempt(email, PASSWORD, '198.51.100.130');
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe(email);
    const row = await db.one<any>('SELECT locked_until, failed_login_count FROM users WHERE id = ?', [id]);
    expect(row.locked_until).toBeNull();
    expect(Number(row.failed_login_count)).toBe(0);
  });

  it('gives the same answer for a wrong password, an unknown email and a locked account', async () => {
    const { email } = await makeUser('uniform');
    const wrongPassword = await attempt(email, 'nope', '203.0.113.1');
    const unknownEmail = await attempt('ghost@example.test', 'nope', '203.0.113.2');
    for (let i = 0; i < 10; i += 1) await attempt(email, `wrong-${i}`, `198.51.100.${i + 1}`);
    const locked = await attempt(email, PASSWORD, '203.0.113.3');
    expect(new Set([wrongPassword.status, unknownEmail.status, locked.status])).toEqual(new Set([401]));
    expect(new Set([wrongPassword.body.error, unknownEmail.body.error, locked.body.error]).size).toBe(1);
  });

  it('does not lock an account that only ever signs in correctly, however often', async () => {
    const { email } = await makeUser('happy');
    for (let i = 0; i < 12; i += 1) expect((await attempt(email, PASSWORD, `192.0.2.${i + 1}`)).status).toBe(200);
  });

  it('does not let failures against one account affect another', async () => {
    const victim = await makeUser('victim');
    const bystander = await makeUser('bystander');
    for (let i = 0; i < 12; i += 1) await attempt(victim.email, `wrong-${i}`, `198.51.100.${i + 1}`);
    expect((await attempt(bystander.email, PASSWORD, '203.0.113.77')).status).toBe(200);
  });

  it('counts a failure only when the password is wrong, so valid use never eats the allowance', async () => {
    const { id, email } = await makeUser('valid-use');
    for (let i = 0; i < 9; i += 1) await attempt(email, `wrong-${i}`, `198.51.100.${i + 1}`);
    expect((await attempt(email, PASSWORD, '203.0.113.88')).status).toBe(200); // the 10th try is right
    const row = await db.one<any>('SELECT failed_login_count FROM users WHERE id = ?', [id]);
    expect(Number(row.failed_login_count)).toBe(0);
    // ...and the clean slate means nine more wrong guesses still do not lock it.
    for (let i = 0; i < 9; i += 1) await attempt(email, `again-${i}`, `198.51.101.${i + 1}`);
    expect((await attempt(email, PASSWORD, '203.0.113.89')).status).toBe(200);
  });
});
