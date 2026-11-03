import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/auth/rbac';
import { aiStatus } from '@/lib/ai';
import { searchStatus } from '@/lib/search';

export const dynamic = 'force-dynamic';

/** GET /api/admin/overview — operational dashboard: counts, failures, freshness, usage. */
export const GET = route(async (request) => {
  await requirePermission(request, 'system.read');
  const now = new Date();

  const [
    userCounts, oppCounts, examCounts, verificationCounts, statusCounts,
    dqOpen, searchFailures, aiUsage, recentSearches, stale, expired, duplicates, securityEvents,
  ] = await Promise.all([
    db.query('SELECT role, status, COUNT(*) AS n FROM users GROUP BY role, status ORDER BY n DESC'),
    db.query('SELECT type, COUNT(*) AS n FROM opportunities WHERE is_active = 1 GROUP BY type ORDER BY n DESC'),
    db.query('SELECT status, COUNT(*) AS n FROM government_exams WHERE is_active = 1 GROUP BY status ORDER BY n DESC'),
    db.query('SELECT verification_status, COUNT(*) AS n FROM opportunities WHERE is_active = 1 GROUP BY verification_status'),
    db.query('SELECT status, COUNT(*) AS n FROM opportunities WHERE is_active = 1 GROUP BY status ORDER BY n DESC'),
    db.query('SELECT kind, severity, COUNT(*) AS n FROM data_quality_issues WHERE resolved = 0 GROUP BY kind, severity ORDER BY n DESC'),
    db.query("SELECT provider, status, COUNT(*) AS n FROM search_logs WHERE status <> 'ok' GROUP BY provider, status ORDER BY n DESC LIMIT 20"),
    db.query("SELECT provider, status, COUNT(*) AS n, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout FROM ai_analysis GROUP BY provider, status ORDER BY n DESC"),
    db.query('SELECT id, status, stage, progress, found, stored, error, created_at FROM search_jobs ORDER BY created_at DESC LIMIT 10'),
    db.query("SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND (last_verified IS NULL OR last_verified < ?)", [new Date(now.getTime() - 72 * 3600_000).toISOString()]),
    db.query('SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND application_deadline IS NOT NULL AND application_deadline < ?', [now.toISOString()]),
    db.query('SELECT duplicate_group, COUNT(*) AS n FROM opportunities WHERE is_active = 1 GROUP BY duplicate_group HAVING COUNT(*) > 1 LIMIT 20'),
    db.query('SELECT event, COUNT(*) AS n FROM security_logs GROUP BY event ORDER BY n DESC LIMIT 15'),
  ]);

  return json({
    users: userCounts.map((r: any) => ({ role: r.role, status: r.status, count: Number(r.n) })),
    opportunities: oppCounts.map((r: any) => ({ type: r.type, count: Number(r.n) })),
    exams: examCounts.map((r: any) => ({ status: r.status, count: Number(r.n) })),
    verification: verificationCounts.map((r: any) => ({ status: r.verification_status, count: Number(r.n) })),
    statuses: statusCounts.map((r: any) => ({ status: r.status, count: Number(r.n) })),
    dataQuality: dqOpen.map((r: any) => ({ kind: r.kind, severity: r.severity, count: Number(r.n) })),
    searchFailures: searchFailures.map((r: any) => ({ provider: r.provider, status: r.status, count: Number(r.n) })),
    aiUsage: aiUsage.map((r: any) => ({ provider: r.provider, status: r.status, calls: Number(r.n), tokensIn: Number(r.tin ?? 0), tokensOut: Number(r.tout ?? 0) })),
    recentSearches,
    freshness: { staleRecords: Number((stale as any[])[0]?.n ?? 0), expiredButActive: Number((expired as any[])[0]?.n ?? 0) },
    duplicateGroups: duplicates.map((r: any) => ({ group: r.duplicate_group, count: Number(r.n) })),
    securityEvents: securityEvents.map((r: any) => ({ event: r.event, count: Number(r.n) })),
    integrations: { ai: aiStatus(), search: searchStatus() },
  });
}, { csrf: false });
