import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db, nowIso, uid } from '@/lib/db';
import type { Role } from './permissions';
import { requiresMfa } from './permissions';

export const SESSION_COOKIE = 'oaa_session';
export const CSRF_COOKIE = 'oaa_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 7);
const ADMIN_SESSION_TTL_DAYS = Number(process.env.ADMIN_SESSION_TTL_DAYS ?? 1);

function secret(): string {
  const value = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!value) {
    // Dev-only fallback so the app still boots without configuration. Production
    // deployments must set SESSION_SECRET (validated by /api/health).
    return 'oaa-dev-insecure-secret-change-me';
  }
  return value;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signSession(payload: string): string {
  const hmac = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${hmac}`;
}

export function verifySignedSession(value: string): string | null {
  const index = value.lastIndexOf('.');
  if (index <= 0) return null;
  const payload = value.slice(0, index);
  const signature = value.slice(index + 1);
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return payload;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  sessionId?: string;
  mfaVerified?: boolean;
}

export function ttlForRole(role: string): number {
  return requiresMfa(role) ? ADMIN_SESSION_TTL_DAYS : SESSION_TTL_DAYS;
}

export async function createSession(
  user: { id: string; role: string },
  meta: { userAgent?: string; ip?: string } = {},
): Promise<{ cookieValue: string; csrfToken: string; sessionId: string; expiresAt: string }> {
  const sessionId = uid();
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlForRole(user.role) * 86_400_000).toISOString();
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      user.id,
      hashToken(token),
      (meta.userAgent ?? '').slice(0, 300),
      (meta.ip ?? '').slice(0, 64),
      expiresAt,
      nowIso(),
    ],
  );
  const csrfToken = randomBytes(24).toString('base64url');
  const cookieValue = signSession(`${sessionId}:${token}`);
  return { cookieValue, csrfToken, sessionId, expiresAt };
}

export async function readSessionUser(cookieValue?: string | null): Promise<SessionUser | null> {
  const raw = cookieValue ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const payload = verifySignedSession(raw);
  if (!payload) return null;
  const [sessionId, token] = payload.split(':');
  if (!sessionId || !token) return null;

  const row = await db.one<{
    id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
    mfa_verified_at: string | null;
    email: string;
    name: string;
    role: Role;
    status: string;
  }>(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.mfa_verified_at,
            u.email, u.name, u.role, u.status
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.run('UPDATE sessions SET revoked_at = ? WHERE id = ?', [nowIso(), row.id]);
    return null;
  }
  if (row.status !== 'active') return null;
  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    sessionId: row.id,
    mfaVerified: Boolean(row.mfa_verified_at),
  };
}

/**
 * Marks the *current* session as second-factor verified. Verification is per session, not
 * per user, so a stolen password alone still cannot reach privileged actions.
 */
export async function markSessionMfaVerified(): Promise<void> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return;
  const payload = verifySignedSession(raw);
  if (!payload) return;
  const [sessionId] = payload.split(':');
  await db.run('UPDATE sessions SET mfa_verified_at = ? WHERE id = ?', [nowIso(), sessionId]);
}

export async function revokeSession(cookieValue?: string | null): Promise<void> {
  const raw = cookieValue ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return;
  const payload = verifySignedSession(raw);
  if (!payload) return;
  const [sessionId] = payload.split(':');
  await db.run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso(), sessionId]);
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const res = await db.run(
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
    [nowIso(), userId],
  );
  return res.changes;
}

/**
 * Cookie scope. The default, `lax`, is what a normal deployment wants: the browser does not send
 * the session cookie on cross-site requests.
 *
 * `COOKIE_SAMESITE=none` exists for the one case that needs the opposite — the app running INSIDE
 * another site's frame (a preview or portal), where a `lax` cookie is never sent and sign-in would
 * silently fail. It requires HTTPS (browsers refuse `SameSite=None` without `Secure`) and marks the
 * cookie `Partitioned`, so it is keyed to the embedding site rather than shared across sites.
 * CSRF is still defended in that mode: every state-changing request must carry the
 * `x-csrf-token` header matching the CSRF cookie, and a cross-origin page cannot set a custom
 * header without the server granting CORS, which this app never does.
 */
function cookieScope() {
  const embedded = (process.env.COOKIE_SAMESITE ?? 'lax').trim().toLowerCase() === 'none';
  return embedded
    ? ({ sameSite: 'none' as const, secure: true, partitioned: true })
    : ({ sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', partitioned: false });
}

export function sessionCookieOptions(maxAgeDays: number) {
  return {
    httpOnly: true,
    ...cookieScope(),
    path: '/',
    maxAge: maxAgeDays * 86_400,
  };
}

export function csrfCookieOptions() {
  return {
    httpOnly: false, // JS must read it for the double-submit check
    ...cookieScope(),
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86_400,
  };
}
