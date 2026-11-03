import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { CSRF_COOKIE, csrfCookieOptions } from '@/lib/auth/session';
import { ensureMigrated } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/csrf — mints the double-submit CSRF token for a browser that does not have one yet.
 *
 * The token is only useful to same-origin JavaScript (it lives in a non-httpOnly cookie and
 * must be echoed back in the `x-csrf-token` header), so issuing it to an anonymous visitor
 * does not weaken the defence: a cross-origin attacker can neither read the cookie nor set
 * the custom header on a cross-site request.
 */
export async function GET() {
  await ensureMigrated();
  const token = randomBytes(24).toString('base64url');
  const response = NextResponse.json({ csrfToken: token });
  response.cookies.set(CSRF_COOKIE, token, csrfCookieOptions());
  return response;
}
