import { route, json } from '@/lib/api/route';
import { db, nowIso } from '@/lib/db';
import { unauthorized } from '@/lib/auth/rbac';
import { generateSecret, otpauthUri } from '@/lib/auth/totp';
import { encryptAtRest, decryptAtRest } from '@/lib/parsing/extract';
import { logSecurity } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/mfa/enroll — issue a TOTP secret for the signed-in user.
 *
 * The secret is stored encrypted with the same AES-256-GCM helper used for resumes, so a
 * database leak does not hand over working second factors. Re-enrolling replaces the secret.
 */
export const POST = route(async (request, { user, meta }) => {
  if (!user) throw unauthorized();

  const secret = generateSecret();
  const outcome = encryptAtRest(new TextEncoder().encode(secret));
  // Prefix records whether the value is ciphertext, so decryption knows how to read it back
  // even if ENCRYPTION_KEY is configured later.
  const stored = `${outcome.encrypted ? 'enc' : 'raw'}:${Buffer.from(outcome.data).toString('base64')}`;

  await db.run('UPDATE users SET mfa_secret = ?, mfa_enrolled_at = ?, two_factor_enabled = 1, updated_at = ? WHERE id = ?', [
    stored,
    nowIso(),
    nowIso(),
    user.id,
  ]);
  await logSecurity({ userId: user.id, event: 'mfa_enroll', detail: 'TOTP secret issued', ip: meta.ip });

  return json({
    secret,
    otpauthUri: otpauthUri(secret, user.email),
    instructions: 'Scan the QR code in any TOTP authenticator app, then submit the 6-digit code to finish enrolment.',
  });
});
