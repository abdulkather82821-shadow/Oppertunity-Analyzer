import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { aiStatus } from '@/lib/ai';
import { searchStatus } from '@/lib/search';
import { MAX_UPLOAD_BYTES } from '@/lib/parsing/extract';
import { hasPermission } from '@/lib/auth/permissions';
import { mfaRequiredFor } from '@/lib/auth/mfa-policy';

export const dynamic = 'force-dynamic';

export const GET = route(async (_request, { user }) => {
  const started = Date.now();
  let database: 'ok' | 'error' = 'ok';
  let dialect = 'unknown';
  let counts: Record<string, number> = {};
  try {
    dialect = db.dialect;
    const opps = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM opportunities');
    const exams = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM government_exams');
    const users = await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM users');
    counts = { opportunities: Number(opps?.n ?? 0), exams: Number(exams?.n ?? 0), users: Number(users?.n ?? 0) };
  } catch {
    database = 'error';
  }

  // Anonymous probes (load balancers, uptime monitors) get liveness and nothing else. The user
  // count, which providers are configured and warnings such as "SESSION_SECRET is not set" are
  // reconnaissance gold, so they are only shown to an operator with `system.read`.
  const operator = Boolean(user && hasPermission(user.role, 'system.read') && (!mfaRequiredFor(user.role) || user.mfaVerified));
  if (!operator) return json({ status: database === 'ok' ? 'ok' : 'degraded' });

  const warnings: string[] = [];
  if (!process.env.SESSION_SECRET) warnings.push('SESSION_SECRET is not set — sessions use an insecure development secret.');
  if (!process.env.ENCRYPTION_KEY) warnings.push('ENCRYPTION_KEY is not set — uploaded resumes are stored unencrypted.');
  else if (process.env.ENCRYPTION_KEY.length < 32) warnings.push('ENCRYPTION_KEY is shorter than 32 characters. It is hashed rather than stretched, so use a long random value (openssl rand -hex 32).');
  if (process.env.NODE_ENV === 'production' && !process.env.TRUST_PROXY_HOPS) warnings.push('TRUST_PROXY_HOPS is not set — client IPs (rate limits, audit log) are read from a header a client can forge. Set it to the number of reverse proxies in front of the app.');
  if (!process.env.CLAMD_HOST) warnings.push('No antivirus scanner (CLAMD_HOST) is configured — uploads are validated by type but not malware-scanned.');
  if (!aiStatus().configured) warnings.push('No AI provider configured — the deterministic local engine is in use.');
  if (!searchStatus().live) warnings.push('No search API configured — the local catalogue provider is in use.');

  return json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    dialect,
    counts,
    ai: aiStatus(),
    search: searchStatus(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    latencyMs: Date.now() - started,
    warnings,
  });
}, { csrf: false });
