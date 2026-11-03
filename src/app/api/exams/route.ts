import { route, json } from '@/lib/api/route';
import { requirePermission } from '@/lib/auth/rbac';
import { fetchExams } from '@/lib/api/opportunity-mapper';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/exams — government examination tracker feed. */
export const GET = route(async (request, { user }) => {
  await requirePermission(request, 'exam.read');
  const url = new URL(request.url);
  const exams = await fetchExams({
    category: url.searchParams.get('category') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    sort: url.searchParams.get('sort') ?? undefined,
    limit: Number(url.searchParams.get('limit') ?? 50),
    userId: user?.id,
  });

  const byStatus = await db.query(
    'SELECT status, COUNT(*) AS n FROM government_exams WHERE is_active = 1 GROUP BY status ORDER BY n DESC',
  );
  const byCategory = await db.query(
    'SELECT category, COUNT(*) AS n FROM government_exams WHERE is_active = 1 GROUP BY category ORDER BY n DESC',
  );

  return json({
    exams,
    total: exams.length,
    facets: {
      statuses: byStatus.map((row: any) => ({ status: row.status, count: Number(row.n) })),
      categories: byCategory.map((row: any) => ({ category: row.category, count: Number(row.n) })),
    },
  });
}, { csrf: false });
