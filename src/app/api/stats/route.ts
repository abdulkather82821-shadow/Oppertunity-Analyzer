import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stats — public catalogue totals for the landing page and the analysis screen.
 *
 * Deliberately limited to facts that are already public on every listing page: how many
 * opportunities, examinations and sources the catalogue tracks. It exposes nothing about users,
 * configuration or infrastructure — that is what the authenticated /api/health is for.
 */
export const GET = route(async () => {
  const [opportunities, exams, sources] = await Promise.all([
    db.one<{ n: number }>('SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1'),
    db.one<{ n: number }>('SELECT COUNT(*) AS n FROM government_exams WHERE is_active = 1'),
    db.one<{ n: number }>('SELECT COUNT(*) AS n FROM sources'),
  ]);
  return json({
    opportunities: Number(opportunities?.n ?? 0),
    exams: Number(exams?.n ?? 0),
    sources: Number(sources?.n ?? 0),
  });
}, { csrf: false });
