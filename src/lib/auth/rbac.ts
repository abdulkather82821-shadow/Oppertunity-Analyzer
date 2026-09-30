import { NextResponse } from 'next/server';
import { db, nowIso } from '@/lib/db';
import { readSessionUser, type SessionUser } from './session';
import { hasPermission, type Permission, type Role } from './permissions';
import { mfaRequiredFor } from './mfa-policy';
import { logSecurity } from '@/lib/audit';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'You must be signed in.') => new ApiError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new ApiError(403, message, 'forbidden');
export const notFound = (message = 'Not found.') => new ApiError(404, message, 'not_found');
export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, 'bad_request', details);
export const conflict = (message: string) => new ApiError(409, message, 'conflict');

export interface RequestMeta {
  ip: string;
  sessionId: string;
  userAgent: string;
}

/**
 * The client's IP address, used for rate limits and the audit trail.
 *
 * `X-Forwarded-For` is a list that every proxy APPENDS to, while the client can put anything it
 * likes at the front. So behind N trusted proxies the only reliable entry is the Nth from the
 * RIGHT (what the outermost trusted proxy actually saw); everything to its left is
 * client-supplied. Set TRUST_PROXY_HOPS to the number of reverse proxies in front of the app.
 *
 * With none configured (the default) the header is used as-is, which is right only for a
 * directly exposed server where Next fills it from the socket — a client can still forge it, so
 * the IP is advisory there and account-level lockout is what actually stops password guessing.
 */
export function clientIp(forwardedFor: string | null, realIp: string | null = null, trustedHops = Number(process.env.TRUST_PROXY_HOPS ?? 0)): string {
  const entries = (forwardedFor ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (trustedHops > 0 && entries.length > 0) return entries[Math.max(0, entries.length - trustedHops)].slice(0, 64);
  return (entries[0] ?? realIp ?? '').trim().slice(0, 64);
}

export function requestMeta(request: Request): RequestMeta {
  return {
    ip: clientIp(request.headers.get('x-forwarded-for'), request.headers.get('x-real-ip')),
    sessionId: request.headers.get('x-session-id') ?? '',
    userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
  };
}

/**
 * Full authorisation chain, exactly as specified:
 *   Authentication → User identity → Role → Permission → (resource ownership at the call site) → Action
 */
export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<{ user: SessionUser; meta: RequestMeta }> {
  const meta = requestMeta(request);
  const user = await readSessionUser();
  if (!user) throw unauthorized();

  // Privileged roles must complete the second factor before any privileged action.
  if (mfaRequiredFor(user.role) && !user.mfaVerified && permission !== 'profile.read') {
    throw new ApiError(403, 'This role requires two-factor verification for privileged actions.', 'mfa_required');
  }

  if (!hasPermission(user.role, permission)) {
    await logSecurity({
      userId: user.id,
      event: 'unauthorized',
      detail: `denied ${permission} for role ${user.role}`,
      ip: meta.ip,
    });
    throw forbidden(`Role "${user.role}" does not have the "${permission}" permission.`);
  }
  return { user, meta };
}

export async function requireRole(request: Request, roles: Role[]): Promise<{ user: SessionUser; meta: RequestMeta }> {
  const user = await readSessionUser();
  const meta = requestMeta(request);
  if (!user) throw unauthorized();
  if (!roles.includes(user.role)) throw forbidden();
  return { user, meta };
}

/**
 * Resource-ownership guard. `ownerId` is the owning user id read from the database —
 * never from the request body. Admins with the given override permission bypass it
 * (and the access is audited by the caller).
 */
export async function requireOwnership(
  user: SessionUser,
  ownerId: string | null | undefined,
  overridePermission?: Permission,
): Promise<void> {
  if (ownerId && ownerId === user.id) return;
  if (overridePermission && hasPermission(user.role, overridePermission)) return;
  await logSecurity({
    userId: user.id,
    event: 'unauthorized',
    detail: `ownership check failed (owner=${ownerId ?? 'null'})`,
    ip: '',
  });
  throw forbidden('You can only access your own resources.');
}

export async function getUserSettings(userId: string) {
  const row = await db.one(
    `SELECT preferred_locations, preferred_job_types, salary_min, salary_max, currency, timezone,
            date_format, notify_deadline, notify_new_match, notify_exam, notify_browser, notify_email,
            digest_daily, digest_weekly, scoring_weights, organization_id
       FROM user_settings WHERE user_id = ?`,
    [userId],
  );
  return row;
}

/** Uniform error surface: never leak stack traces or SQL to clients. */
export function handleApiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details ?? undefined },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  console.error('[api] unhandled error:', error);
  return NextResponse.json(
    { error: 'Unexpected server error.', code: 'internal_error', detail: message.slice(0, 200) },
    { status: 500 },
  );
}

export async function touchLogin(userId: string, success: boolean): Promise<void> {
  if (success) {
    await db.run(
      'UPDATE users SET last_login_at = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [nowIso(), userId],
    );
  } else {
    await db.run(
      `UPDATE users SET failed_login_count = failed_login_count + 1,
              locked_until = CASE WHEN failed_login_count + 1 >= 8
                THEN datetime('now', '+15 minutes') ELSE locked_until END
        WHERE id = ?`,
      [userId],
    );
  }
}
