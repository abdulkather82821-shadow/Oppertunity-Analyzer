import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { enrichExam, enrichOpportunity, sourcesFor, verificationHistoryFor } from '@/lib/api/enrich';
import { loadProfile } from '@/lib/services/profile-service';
import { loadScoringContext } from '@/lib/opportunity/personal';

export const dynamic = 'force-dynamic';

/** GET /api/exam/[id] — examination detail with nine-stage timeline and verification history. */
export const GET = route(async (request, { params, user }) => {
  await requirePermission(request, 'exam.read');
  const row = await db.one<any>(
    `SELECT e.*, (SELECT 1 FROM saved_opportunities s WHERE s.exam_id = e.id AND s.user_id = ?) AS is_saved
       FROM government_exams e WHERE e.id = ?`,
    [user?.id ?? null, params.id],
  );
  if (!row) throw notFound('This examination no longer exists.');

  const profile = user?.id ? await loadProfile(user.id) : null;
  const context = user?.id ? await loadScoringContext(user.id) : null;
  const opportunityRow = row.opportunity_id
    ? await db.one<any>(
        `SELECT o.*, (SELECT 1 FROM saved_opportunities s WHERE s.opportunity_id = o.id AND s.user_id = ?) AS is_saved
           FROM opportunities o WHERE o.id = ?`,
        [user?.id ?? null, row.opportunity_id],
      )
    : null;

  const [sources, verification] = await Promise.all([
    row.opportunity_id ? sourcesFor(row.opportunity_id) : Promise.resolve([]),
    verificationHistoryFor(row.opportunity_id ?? '', row.id),
  ]);

  return json({
    exam: enrichExam(row, opportunityRow),
    opportunity: opportunityRow ? enrichOpportunity(opportunityRow, profile, context) : null,
    sources,
    verification,
  });
}, { csrf: false });
