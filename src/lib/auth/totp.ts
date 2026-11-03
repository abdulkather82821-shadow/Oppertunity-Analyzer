import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) second factor — no external dependency.
 *
 * Used for privileged roles (admin, super_admin). The shared secret is stored per user and
 * the code is verified with a constant-time comparison and a one-step clock-skew window, so
 * a slightly drifted authenticator app still works while replay across steps does not.
 */

const PERIOD_SECONDS = 30;
const DIGITS = 6;
const SKEW_STEPS = 1;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSecret(bytes = 20): string {
  const buffer = randomBytes(bytes);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCodeAt(secret: string, timeMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(timeMs / 1000 / PERIOD_SECONDS) + stepOffset;
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Verifies a user-supplied code, tolerating ±1 step of clock skew. */
export function verifyTotp(secret: string, code: string, timeMs = Date.now()): boolean {
  const cleaned = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  for (let offset = -SKEW_STEPS; offset <= SKEW_STEPS; offset += 1) {
    const expected = totpCodeAt(secret, timeMs, offset);
    const a = Buffer.from(cleaned);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUri(secret: string, email: string, issuer = 'Opportunity Analyzer AI'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_SECONDS}`;
}
