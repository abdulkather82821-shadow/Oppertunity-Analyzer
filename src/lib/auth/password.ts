import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

interface ScryptOptions { N: number; r: number; p: number; maxmem?: number }
const scrypt = promisify(_scrypt) as unknown as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const KEYLEN = 64;
const PARAMS = { N: 16384, r: 8, p: 1 };

/**
 * Password hashing with Node's built-in scrypt (no native dependency).
 * Format: `scrypt$N$r$p$<salt-b64>$<hash-b64>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(normalise(password), salt, KEYLEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  try {
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(normalise(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** NFKC normalisation + trailing-whitespace strip, per the WHATWG password guidance. */
function normalise(password: string): string {
  return password.normalize('NFKC').replace(/[\u0000]/g, '');
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
  score: number; // 0-4
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 10) errors.push('Password must be at least 10 characters.');
  if (password.length > 200) errors.push('Password must be shorter than 200 characters.');
  let score = 0;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (score < 3) errors.push('Use a mix of upper/lower case, numbers and symbols.');
  return { ok: errors.length === 0, errors, score };
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
