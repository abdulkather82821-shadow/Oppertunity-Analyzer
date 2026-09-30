import { route, json } from '@/lib/api/route';
import { revokeSession, CSRF_COOKIE, SESSION_COOKIE, csrfCookieOptions, sessionCookieOptions } from '@/lib/auth/session';
import { logSecurity } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const POST = route(async (request, { user, meta }) => {
  await revokeSession();
  if (user) await logSecurity({ userId: user.id, event: 'logout', ip: meta.ip });
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  response.cookies.set(CSRF_COOKIE, '', csrfCookieOptions());
  return response;
});
