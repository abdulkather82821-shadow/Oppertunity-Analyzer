import { route, json, z } from '@/lib/api/route';
import { registerSchema } from '@/lib/api/schemas';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password';
import { createSession, sessionCookieOptions, csrfCookieOptions, SESSION_COOKIE, CSRF_COOKIE } from '@/lib/auth/session';
import { assertRateLimit } from '@/lib/rate-limit';
import { audit, logSecurity } from '@/lib/audit';
import { conflict } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export const POST = route(
  async (request, { body, meta }) => {
    assertRateLimit({ key: `register:${meta.ip}`, limit: 5, windowMs: 15 * 60_000 });

    const policy = checkPasswordPolicy(body.password);
    if (!policy.ok) throw z.ZodError.create([{ code: 'custom', path: ['password'], message: policy.errors.join(' ') }] as any);

    const existing = await db.one('SELECT id FROM users WHERE email = ?', [body.email]);
    if (existing) throw conflict('An account with this email already exists.');

    const id = uid();
    const now = nowIso();
    // Every self-registration is a Candidate. Privileged roles can only be granted by an
    // authorised administrator through /api/admin/users.
    await insertRow('users', {
      id,
      email: body.email,
      password_hash: await hashPassword(body.password),
      name: body.name,
      role: 'candidate',
      status: 'active',
      email_verified: 0,
      auth_provider: 'password',
      mfa_required_for_role: 0,
      created_at: now,
      updated_at: now,
    });
    await insertRow('user_settings', {
      user_id: id,
      preferred_locations: JSON.stringify(['India']),
      timezone: 'Asia/Kolkata',
      date_format: 'indian',
      updated_at: now,
    });

    const session = await createSession({ id, role: 'candidate' }, meta);
    await logSecurity({ userId: id, event: 'login_success', detail: 'registration', ip: meta.ip });
    await audit({ userId: id, actorEmail: body.email, actorRole: 'candidate', action: 'user.create', resourceType: 'user', resourceId: id, ip: meta.ip });

    const response = json({ id, email: body.email, name: body.name, role: 'candidate' }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, session.cookieValue, sessionCookieOptions(7));
    response.cookies.set(CSRF_COOKIE, session.csrfToken, csrfCookieOptions());
    return response;
  },
  { schema: registerSchema },
);
