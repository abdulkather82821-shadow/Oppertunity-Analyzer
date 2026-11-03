import { route, json } from '@/lib/api/route';
import { requirePermission } from '@/lib/auth/rbac';
import { fetchOpportunities, type OpportunityFilters } from '@/lib/api/opportunity-mapper';
import { dashboardSummary } from '@/lib/api/enrich';
import { loadProfile } from '@/lib/services/profile-service';
import { loadScoringContext } from '@/lib/opportunity/personal';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/opportunities
 * Filterable opportunity list. Filters map 1:1 to the UI's filter panel; every value is bound
 * as a parameter. Match scores and eligibility are recomputed live against the caller's
 * profile when one exists, so the list is personalised rather than generic.
 */
export const GET = route(async (request, { user }) => {
  await requirePermission(request, 'opportunity.read');
  const url = new URL(request.url);
  const get = (key: string) => url.searchParams.get(key) ?? undefined;
  const getNum = (key: string) => {
    const raw = url.searchParams.get(key);
    const value = raw === null ? undefined : Number(raw);
    return value === undefined || !Number.isFinite(value) ? undefined : value;
  };

  const filters: OpportunityFilters = {
    type: get('type'),
    category: get('category'),
    experience: get('experience'),
    workMode: get('mode') ?? get('work_mode'),
    location: get('location'),
    salaryMin: getNum('salaryMin') ?? getNum('salary_min'),
    salaryMax: getNum('salaryMax') ?? getNum('salary_max'),
    deadline: get('deadlineDays') ?? get('deadline'),
    matchScore: get('match_score'),
    status: get('status'),
    verificationStatus: get('verification'),
    band: get('band'),
    includeDemo: get('include_demo') === 'false' ? false : true,
    q: get('q'),
    sort: get('sort'),
    limit: getNum('limit') ?? 30,
    offset: getNum('offset') ?? 0,
  };

  const profile = user?.id ? await loadProfile(user.id) : null;
  // The viewer's own weights, locations, salary range and feedback drive every score below.
  const context = user?.id ? await loadScoringContext(user.id) : null;
  const { rows, total, limit, offset } = await fetchOpportunities(filters, user?.id, profile, context);
  const summary = user?.id ? await dashboardSummary(user.id, profile, context) : null;

  const [facets, categories, closingSoon] = await Promise.all([
    db.query<any>('SELECT type, COUNT(*) AS n FROM opportunities WHERE is_active = 1 GROUP BY type ORDER BY n DESC'),
    db.query<any>("SELECT category, COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND category <> '' GROUP BY category ORDER BY n DESC LIMIT 20"),
    db.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE is_active = 1 AND application_deadline IS NOT NULL
          AND application_deadline > ? AND application_deadline <= ?`,
      [new Date().toISOString(), new Date(Date.now() + 7 * 86_400_000).toISOString()],
    ),
  ]);

  return json({
    opportunities: rows,
    total,
    limit,
    offset,
    summary: summary
      ? { ...summary, total, closingSoon: summary.closingSoon || Number(closingSoon?.n ?? 0) }
      : { total, closingSoon: Number(closingSoon?.n ?? 0) },
    facets: {
      types: facets.map((f) => ({ type: f.type, count: Number(f.n) })),
      categories: categories.map((c) => ({ category: c.category, count: Number(c.n) })),
      closingSoon: Number(closingSoon?.n ?? 0),
    },
  });
}, { csrf: false });
