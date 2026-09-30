import { route, json } from '@/lib/api/route';
import { feedbackSchema } from '@/lib/api/schemas';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { trackEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * POST /api/feedback
 * Explicit relevance feedback. It feeds `feedbackAdjustment` and `categoryPenalty` in the
 * ranker, so repeatedly rejecting a category genuinely lowers it in future rankings.
 */
export const POST = route(async (request, { body }) => {
  const { user } = await requirePermission(request, 'feedback.create');
  if (body.opportunityId) {
    const exists = await db.one('SELECT id FROM opportunities WHERE id = ?', [body.opportunityId]);
    if (!exists) throw notFound('Opportunity not found.');
  }
  if (body.examId) {
    const exists = await db.one('SELECT id FROM government_exams WHERE id = ?', [body.examId]);
    if (!exists) throw notFound('Examination not found.');
  }

  const existing = await db.one<{ id: string }>(
    'SELECT id FROM feedback WHERE user_id = ? AND COALESCE(opportunity_id, ?) = ? AND COALESCE(exam_id, ?) = ?',
    [user.id, body.opportunityId ?? '', body.opportunityId ?? '', body.examId ?? '', body.examId ?? ''],
  );
  if (existing) {
    await db.run('UPDATE feedback SET verdict = ?, comment = ?, created_at = ? WHERE id = ?', [body.verdict, body.comment ?? '', nowIso(), existing.id]);
  } else {
    await insertRow('feedback', {
      id: uid(),
      user_id: user.id,
      opportunity_id: body.opportunityId ?? null,
      exam_id: body.examId ?? null,
      verdict: body.verdict,
      comment: body.comment ?? '',
      created_at: nowIso(),
    });
  }

  await trackEvent(user.id, 'feedback.submit', { verdict: body.verdict, opportunityId: body.opportunityId, examId: body.examId });
  return json({ ok: true, verdict: body.verdict });
}, { schema: feedbackSchema });

/** GET /api/feedback — the caller's feedback history and the adjustments it produced. */
export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'feedback.create');
  const rows = await db.query(
    `SELECT f.id, f.verdict, f.comment, f.created_at, o.title, o.category, e.exam_name
       FROM feedback f LEFT JOIN opportunities o ON o.id = f.opportunity_id
       LEFT JOIN government_exams e ON e.id = f.exam_id
      WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 50`,
    [user.id],
  );
  const totals = await db.query('SELECT verdict, COUNT(*) AS n FROM feedback WHERE user_id = ? GROUP BY verdict', [user.id]);
  return json({ feedback: rows, totals: totals.map((t: any) => ({ verdict: t.verdict, count: Number(t.n) })) });
}, { csrf: false });
