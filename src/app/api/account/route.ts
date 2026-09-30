import { route, json } from '@/lib/api/route';
import { requirePermission } from '@/lib/auth/rbac';
import { SESSION_COOKIE, CSRF_COOKIE, sessionCookieOptions, csrfCookieOptions } from '@/lib/auth/session';
import { deleteAccount } from '@/lib/services/account-service';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/account — the signed-in user deletes their own account and all their data.
 * The rules (what is erased, what is only anonymised, who may not do this) live in
 * `deleteAccount`; this route only authorises the request and clears the cookies.
 */
export const DELETE = route(async (request, { meta }) => {
  const { user } = await requirePermission(request, 'profile.delete');
  const result = await deleteAccount(user, meta);

  const response = json({ deleted: true, resumesRemoved: result.resumesRemoved });
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  response.cookies.set(CSRF_COOKIE, '', csrfCookieOptions());
  return response;
});
