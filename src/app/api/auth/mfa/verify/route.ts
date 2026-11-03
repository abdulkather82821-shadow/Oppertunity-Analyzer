import { route, json } from '@/lib/api/route';
import { verifySchema } from '@/lib/api/schemas';
import { db } from '@/lib/db';
import { unauthorized, badRequest } from '@/lib/auth/rbac';
import { verifyTotp } from '@/lib/auth/totp';
import { markSessionMfaVerified } from '@/lib/auth/session';
import { decryptAtRest } from '@/lib/parsing/extract';
import { assertRateLimit } from '@/lib/rate-limit';
import { logSecurity } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function splitStoredSecret(stored: string): [string, string] {
  const index = stored.indexOf(':');
  return index === -1 ? ['enc', stored] : [stored.slice(0, index), stored.slice(index + 1)];
}

/**
 * POST /api/auth/mfa/verify — check a TOTP code and mark this session second-factor verified.
 * Rate-limited per user so the 6-digit space cannot be brute-forced.
 */
export const POST = route<import('zod').z.infer<typeof verifySchema>>(async (request, { user, body, meta }) => {
  if (!user) throw unauthorized();
  assertRateLimit({ key: `mfa:${user.id}`, limit: 10, windowMs: 15 * 60_000 });

  const row = await db.one<{ mfa_secret: string | null }>('SELECT mfa_secret FROM users WHERE id = ?', [user.id]);
  if (!row?.mfa_secret) throw badRequest('Two-factor authentication is not enrolled yet. Enrol first.');

  const [prefix, payload] = splitStoredSecret(row.mfa_secret);
  const secret = new TextDecoder().decode(decryptAtRest(Buffer.from(payload, 'base64'), prefix === 'enc'));
  if (!verifyTotp(secret, body.code)) {
    await logSecurity({ userId: user.id, event: 'mfa_failed', detail: 'invalid TOTP code', ip: meta.ip });
    throw badRequest('That code is not valid. Check your authenticator app and try again.');
  }

  await markSessionMfaVerified();
  await logSecurity({ userId: user.id, event: 'mfa_verified', detail: 'session elevated', ip: meta.ip });
  return json({ verified: true });
}, { schema: verifySchema });
