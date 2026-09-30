import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCsrf } from '@/lib/auth/csrf';
import { ApiError, handleApiError, badRequest, type RequestMeta, requestMeta } from '@/lib/auth/rbac';
import { flagEnabled, refreshConfig } from '@/lib/config';
import { readSessionUser, type SessionUser } from '@/lib/auth/session';
import { ensureMigrated } from '@/lib/db';

/**
 * Wraps every route handler with: migration check → CSRF check → body validation →
 * uniform error mapping. Keeping this in one place is what guarantees the security
 * controls are applied consistently instead of per-route by hand.
 */
export interface HandlerContext {
  user: SessionUser | null;
  meta: RequestMeta;
}

interface RouteOptions<Body> {
  schema?: z.ZodType<Body>;
  csrf?: boolean;
  /** Runs even for unauthenticated callers (e.g. login/register). */
  public?: boolean;
}

export function route<Body = unknown>(
  handler: (request: Request, context: HandlerContext & { body: Body; params: Record<string, string> }) => Promise<NextResponse>,
  options: RouteOptions<Body> = {},
) {
  // The context parameter must be required and `params` must be a Promise: Next.js generates
  // per-route type validators that check handler parameter types against its own RouteContext,
  // which types params as `Promise<any>`. An optional or non-Promise params fails that check.
  return async (request: Request, ctx: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      await ensureMigrated();
      // Bring the settings snapshot up to date (at most one query every few seconds) so the many
      // synchronous readers downstream see what an administrator last saved.
      await refreshConfig();
      const params = (await ctx?.params) ?? {};

      if (options.csrf !== false) await assertCsrf(request);

      const user = await readSessionUser();
      const meta = requestMeta(request);

      // Maintenance mode: reading stays available; changes from anyone but an administrator are
      // paused. Signing in/out stays open so an administrator can get in to switch it off.
      if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS' && flagEnabled('maintenance_mode')) {
        const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
        const path = new URL(request.url).pathname;
        const authPath = path === '/api/csrf' || path.startsWith('/api/auth/login') || path.startsWith('/api/auth/logout') || path.startsWith('/api/auth/mfa/');
        if (!isAdmin && !authPath) {
          throw new ApiError(503, 'The platform is in maintenance mode. You can keep browsing, but changes are paused for now.', 'maintenance');
        }
      }

      let body = {} as Body;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const contentType = request.headers.get('content-type') ?? '';
        if (contentType.includes('multipart/form-data')) {
          body = (await request.formData()) as unknown as Body;
        } else if (contentType.includes('application/json')) {
          const text = await request.text();
          body = (text ? JSON.parse(text) : {}) as Body;
        }
        if (options.schema) {
          const result = options.schema.safeParse(body);
          if (!result.success) {
            throw badRequest('Request validation failed.', result.error.flatten().fieldErrors);
          }
          body = result.data;
        }
      }

      return await handler(request, { user, meta, body, params });
    } catch (error) {
      return handleApiError(error);
    }
  };
}

export const json = (data: unknown, init?: ResponseInit) =>
  NextResponse.json(data, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init?.headers ?? {}) },
  });

export const empty = () => new NextResponse(null, { status: 204 });

export { z };
