import { route, json } from '@/lib/api/route';
import { loginSchema } from '@/lib/api/schemas';
import { db, nowIso } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, csrfCookieOptions, sessionCookieOptions, ttlForRole, CSRF_COOKIE, SESSION_COOKIE } from '@/lib/auth/session';
import { assertRateLimit, clearFailures, isOverLimit, recordFailure } from '@/lib/rate-limit';
import { forbidden, unauthorized } from '@/lib/auth/rbac';
import { logSecurity } from '@/lib/audit';
import { mfaRequiredFor } from '@/lib/auth/mfa-policy';
import { configInt } from '@/lib/config';

export const dynamic = 'force-dynamic';

/** Consecutive failed sign-ins on one account before it is locked, and for how long. */
const MAX_FAILED_LOGINS = 10;
const LOCK_MS = 15 * 60_000;
const FAILURE_WINDOW_MS = 15 * 60_000;

/**
 * One message for every way a sign-in can be refused for credential reasons — wrong password,
 * unknown email, temporarily locked — so the response never reveals which emails have accounts.
 */
const REFUSED = 'Email or password is incorrect, or sign-in is temporarily paused for this account after repeated failures. Try again in a few minutes.';

export const POST = route(
  async (request, { body, meta }) => {
    assertRateLimit({ key: `login:${meta.ip}`, limit: configInt('security.rate_limit_login'), windowMs: 15 * 60_000 });

    // The per-IP limit above is only as trustworthy as the client IP, which a directly exposed
    // server cannot vouch for. Throttling by ACCOUNT is what actually stops guessing: rotating a
    // header does not change whose password is being tried. It applies to unknown emails too, so
    // "never gets locked" cannot be used to discover which emails do not exist.
    const accountKey = `login-failures:${body.email.toLowerCase()}`;
    const accountLimit = { key: accountKey, limit: MAX_FAILED_LOGINS, windowMs: FAILURE_WINDOW_MS };

    const user = await db.one<any>('SELECT * FROM users WHERE email = ?', [body.email]);
    const lockedInDb = Boolean(user?.locked_until && new Date(user.locked_until).getTime() > Date.now());
    const blocked = isOverLimit(accountLimit) || lockedInDb;

    // The password is verified even when blocked (and for unknown emails) so every path costs
    // the same, but a blocked account can never succeed, however right the password is.
    const passwordOk = await verifyPassword(body.password, user?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

    if (blocked || !user || !passwordOk) {
      recordFailure(accountLimit);
      if (user && !blocked) {
        const failures = Number(user.failed_login_count ?? 0) + 1;
        if (failures >= MAX_FAILED_LOGINS) {
          // Durable lock, so it survives a restart and applies on every instance.
          await db.run('UPDATE users SET failed_login_count = 0, locked_until = ?, updated_at = ? WHERE id = ?', [new Date(Date.now() + LOCK_MS).toISOString(), nowIso(), user.id]);
          await logSecurity({ userId: user.id, event: 'account_locked', detail: `locked for ${LOCK_MS / 60_000} minutes after ${MAX_FAILED_LOGINS} failed sign-ins`, ip: meta.ip });
        } else {
          await db.run('UPDATE users SET failed_login_count = ?, updated_at = ? WHERE id = ?', [failures, nowIso(), user.id]);
        }
      }
      await logSecurity({ userId: user?.id ?? null, event: 'login_failed', detail: blocked ? 'refused while locked' : 'invalid credentials', ip: meta.ip });
      throw unauthorized(REFUSED);
    }
    if (user.status === 'suspended') {
      await logSecurity({ userId: user.id, event: 'login_failed', detail: 'account suspended', ip: meta.ip });
      throw forbidden('This account has been suspended. Contact the platform administrator.');
    }
    if (user.status === 'deleted') throw unauthorized('Email or password is incorrect.');
    await db.run('UPDATE users SET last_login_at = ?, failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), user.id]);
    clearFailures(accountKey);
    const session = await createSession({ id: user.id, role: user.role }, meta);
    await logSecurity({ userId: user.id, event: 'login_success', detail: `role=${user.role}`, ip: meta.ip });

    const response = json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mfaRequired: mfaRequiredFor(user.role),
    });
    response.cookies.set(SESSION_COOKIE, session.cookieValue, sessionCookieOptions(ttlForRole(user.role)));
    response.cookies.set(CSRF_COOKIE, session.csrfToken, csrfCookieOptions());
    return response;
  },
  { schema: loginSchema },
);
