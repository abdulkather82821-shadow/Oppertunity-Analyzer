import { afterEach, describe, expect, it, vi } from 'vitest';
import { csrfCookieOptions, sessionCookieOptions } from '@/lib/auth/session';

/**
 * Framing and cookie scope.
 *
 * The defaults are strict. The two opt-outs exist for running the app inside another site's frame
 * (a preview, a portal), and must fail safe: a mistyped value must never quietly turn protection off.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function headersFor(env: string | undefined) {
  if (env === undefined) vi.stubEnv('FRAME_ANCESTORS', '');
  else vi.stubEnv('FRAME_ANCESTORS', env);
  vi.resetModules();
  // @ts-expect-error -- next.config.mjs is a plain JavaScript file with no type declarations
  const module = (await import('../next.config.mjs')) as { default: { headers: () => Promise<{ headers: { key: string; value: string }[] }[]> } };
  const config = module.default;
  const rules = await config.headers();
  return Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
}

describe('framing', () => {
  it('forbids framing by default, with both the modern and the legacy header', async () => {
    const headers = await headersFor(undefined);
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('treats an unquoted `none` (what dotenv delivers) exactly like the quoted keyword', async () => {
    const headers = await headersFor('none');
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('allows same-origin framing only when asked', async () => {
    const headers = await headersFor('self');
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'self'");
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('allows named parents or everyone, and then sends no contradictory X-Frame-Options', async () => {
    const named = await headersFor('https://portal.example.com https://other.example.org');
    expect(named['Content-Security-Policy']).toBe('frame-ancestors https://portal.example.com https://other.example.org');
    expect(named['X-Frame-Options']).toBeUndefined();
    const anyone = await headersFor('*');
    expect(anyone['Content-Security-Policy']).toBe('frame-ancestors *');
    expect(anyone['X-Frame-Options']).toBeUndefined();
  });

  it('refuses a value that could break out of the header, falling back to the strict default', async () => {
    for (const hostile of ["*; script-src 'unsafe-inline'", 'self\nSet-Cookie: x=1', "https://a.example.com; default-src *"]) {
      const headers = await headersFor(hostile);
      expect(headers['Content-Security-Policy'], hostile).toBe("frame-ancestors 'none'");
      expect(headers['X-Frame-Options']).toBe('DENY');
    }
  });
});

describe('cookie scope', () => {
  it('is Lax, HttpOnly for the session, and Secure in production by default', () => {
    vi.stubEnv('COOKIE_SAMESITE', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookieOptions(7)).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, partitioned: false, maxAge: 7 * 86_400 });
    expect(csrfCookieOptions()).toMatchObject({ httpOnly: false, sameSite: 'lax', secure: true });
  });

  it('is not Secure over plain http in development, so local sign-in works', () => {
    vi.stubEnv('COOKIE_SAMESITE', '');
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookieOptions(1).secure).toBe(false);
  });

  it('switches to None + Secure + Partitioned only when explicitly asked, for embedded use', () => {
    vi.stubEnv('COOKIE_SAMESITE', 'none');
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookieOptions(1)).toMatchObject({ httpOnly: true, sameSite: 'none', secure: true, partitioned: true });
    expect(csrfCookieOptions()).toMatchObject({ httpOnly: false, sameSite: 'none', secure: true, partitioned: true });
  });

  it('treats any other value as the strict default', () => {
    for (const value of ['strict', 'NONE ', 'yes', 'true']) {
      vi.stubEnv('COOKIE_SAMESITE', value);
      const expected = value.trim().toLowerCase() === 'none' ? 'none' : 'lax';
      expect(sessionCookieOptions(1).sameSite, value).toBe(expected);
    }
  });

  it('keeps the session cookie HttpOnly in every mode', () => {
    for (const value of ['', 'none']) {
      vi.stubEnv('COOKIE_SAMESITE', value);
      expect(sessionCookieOptions(1).httpOnly).toBe(true);
    }
  });
});
