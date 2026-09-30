import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { enrichOpportunity, enrichExam, sourcesFor, duplicatesFor, verificationHistoryFor } from '@/lib/api/enrich';
import { loadProfile } from '@/lib/services/profile-service';
import { explainScore, toMatchableRecord } from '@/lib/api/enrich-bridge';
import { loadScoringContext, scoreForUser } from '@/lib/opportunity/personal';

export const dynamic = 'force-dynamic';

/** GET /api/opportunity/[id] — full detail card, live match, sources, duplicates, conflicts. */
export const GET = route(async (request, { params, user }) => {
  await requirePermission(request, 'opportunity.read');
  const row = await db.one<any>(
    `SELECT o.*, (SELECT 1 FROM saved_opportunities s WHERE s.opportunity_id = o.id AND s.user_id = ?) AS is_saved
       FROM opportunities o WHERE o.id = ?`,
    [user?.id ?? null, params.id],
  );
  if (!row) throw notFound('This opportunity no longer exists.');

  const profile = user?.id ? await loadProfile(user.id) : null;
  const context = user?.id ? await loadScoringContext(user.id) : null;
  const [sources, duplicates, examRow] = await Promise.all([
    sourcesFor(row.id),
    duplicatesFor(row),
    db.one<any>('SELECT * FROM government_exams WHERE opportunity_id = ?', [row.id]),
  ]);

  const opportunity = enrichOpportunity(row, profile, context);
  const matchable = toMatchableRecord(row);
  const match = profile ? scoreForUser(row, matchable, profile, context).match : null;
  const verification = await verificationHistoryFor(row.id, examRow?.id ?? null);

  return json({
    opportunity,
    match: match
      ? {
          overall: match.overall,
          band: match.band,
          label: match.label,
          breakdown: match.breakdown,
          weights: match.weights,
          matchedSkills: match.matchedSkills,
          missingSkills: match.missingSkills,
          model: match.model,
          calculation: explainScore(match),
        }
      : null,
    sources,
    duplicates,
    verification,
    exam: examRow ? enrichExam(examRow, row) : null,
  });
}, { csrf: false });
