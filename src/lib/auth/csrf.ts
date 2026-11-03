import { cookies } from 'next/headers';
import { ApiError } from './rbac';
import { CSRF_COOKIE, CSRF_HEADER } from './session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence = SameSite=Lax session cookie + double-submit token.
 * The token lives in a JS-readable cookie and must be echoed back in the
 * `x-csrf-token` header on every state-changing request. Cross-origin forms cannot
 * set that header, which is what makes the pair effective.
 */
export async function assertCsrf(request: Request): Promise<void> {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const jar = await cookies();
  const expected = jar.get(CSRF_COOKIE)?.value;
  const provided = request.headers.get(CSRF_HEADER) ?? '';
  if (!expected || !provided || expected !== provided) {
    throw new ApiError(403, 'CSRF token missing or invalid. Reload the page and try again.', 'csrf_failed');
  }
}

export async function getCsrfToken(): Promise<string | undefined> {
  return (await cookies()).get(CSRF_COOKIE)?.value;
}
