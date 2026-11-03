/**
 * Browser-side API client.
 * Every state-changing request carries the CSRF token from the readable cookie, which is
 * the client half of the double-submit defence enforced by `assertCsrf` on the server.
 */

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)oaa_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Returns a usable CSRF token, minting one via GET /api/csrf when the browser does not have
 * one yet. Without this the very first state-changing request (login) would deadlock: the
 * token is normally issued by the login response, which itself requires a token.
 */
async function ensureCsrf(): Promise<string | null> {
  const existing = csrfToken();
  if (existing) return existing;
  try {
    const response = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return null;
    return csrfToken();
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (method !== 'GET' && method !== 'HEAD') {
    const token = await ensureCsrf();
    if (token) headers.set('x-csrf-token', token);
    if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  }

  const response = await fetch(path, { ...options, method, headers, credentials: 'same-origin', cache: 'no-store' });

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const body = payload as { error?: string; code?: string; details?: unknown };
    throw new ApiClientError(body?.error ?? `Request failed (${response.status})`, response.status, body?.code, body?.details);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roleLabel: string;
  permissions: string[];
  mfaRequired: boolean;
}

export interface MeResponse {
  user: SessionUser;
  csrfToken: string | null;
  settings: Record<string, unknown> | null;
  hasProfile: boolean;
  profile: { id: string; careerLevel: string; name: string | null } | null;
  hasResume: boolean;
  resume: { id: string; original_name: string; size_bytes: number; parse_status: string; created_at: string } | null;
  unreadNotifications: number;
  integrations: {
    ai: { configured: boolean; provider: string | null; model: string | null };
    search: { mode: string[]; live: boolean };
  };
  features?: { browserNotifications: boolean; resumeOptimizer: boolean; maintenance: boolean };
}

export const fmtBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const fmtDate = (value: string | null | undefined): string => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const pct = (value: number | null | undefined): string => (value == null ? 'Unknown' : `${Math.round(value * 100)}%`);
