import { db, nowIso, uid } from '@/lib/db';
import { logSecurity } from '@/lib/audit';
import { ApiError } from '@/lib/auth/rbac';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process fixed-window limiter. State lives in this process's memory: it resets when the
 * server restarts and is NOT shared between instances, so with several instances behind a load
 * balancer each enforces its own limit (run one instance, or front it with a shared limiter).
 * Durable per-account protection is separate and lives in the database (`users.locked_until`).
 */
const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key: string;
}

export function checkRateLimit(options: RateLimitOptions): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(options.key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(options.key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, remaining: options.limit - 1, resetAt: now + options.windowMs };
  }
  bucket.count += 1;
  if (bucket.count > options.limit) {
    return { ok: false, remaining: 0, resetAt: bucket.resetAt };
  }
  return { ok: true, remaining: options.limit - bucket.count, resetAt: bucket.resetAt };
}

export function assertRateLimit(options: RateLimitOptions): void {
  const result = checkRateLimit(options);
  if (!result.ok) {
    void logSecurity({
      event: 'rate_limited',
      detail: `${options.key} exceeded ${options.limit}/${options.windowMs}ms`,
    });
    const retrySeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    throw new ApiError(429, `Rate limit exceeded. Try again in ${retrySeconds} seconds.`, 'rate_limited', {
      retryAfter: retrySeconds,
    });
  }
}

/**
 * Failure counting, for limits that should only be charged when something went WRONG (a failed
 * sign-in), so that successful use never eats the allowance and an attacker cannot exhaust a
 * victim's allowance just by making valid requests.
 */
export function isOverLimit(options: RateLimitOptions): boolean {
  const bucket = buckets.get(options.key);
  return Boolean(bucket && bucket.resetAt > Date.now() && bucket.count >= options.limit);
}

export function recordFailure(options: RateLimitOptions): void {
  const now = Date.now();
  const bucket = buckets.get(options.key);
  if (!bucket || bucket.resetAt <= now) buckets.set(options.key, { count: 1, resetAt: now + options.windowMs });
  else bucket.count += 1;
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

/** Persisted usage counter, surfaced in the admin data-quality/API-usage panel. */
export async function recordUsage(kind: string, detail: string, meta: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.run(
      `INSERT INTO analytics_events (id, user_id, event, props, created_at) VALUES (?, ?, ?, ?, ?)`,
      [uid(), (meta.userId as string) ?? null, `usage.${kind}`, JSON.stringify({ detail, ...meta }), nowIso()],
    );
  } catch {
    /* non-critical */
  }
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}
