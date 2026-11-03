import { route, json } from '@/lib/api/route';
import { savedSchema } from '@/lib/api/schemas';
import { db, insertRow, nowIso, uid } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { enrichOpportunity, enrichExam } from '@/lib/api/enrich';
import { audit } from '@/lib/audit';
import { loadProfile } from '@/lib/services/profile-service';
import { loadScoringContext } from '@/lib/opportunity/personal';
import { parseIstDate } from '@/lib/opportunity/deadline';

export const dynamic = 'force-dynamic';

/** GET /api/saved — the caller's saved opportunities and exams. */
export const GET = route(async (request, { user }) => {
  const { user: authed } = await requirePermission(request, 'saved.manage');
  const profile = await loadProfile(authed.id);
  const context = profile ? await loadScoringContext(authed.id) : null;
  const rows = await db.query<any>(
    `SELECT s.id AS saved_id, s.note, s.reminder_at, s.created_at AS saved_at,
            s.opportunity_id, s.exam_id, o.*, e.exam_name
       FROM saved_opportunities s
       LEFT JOIN opportunities o ON o.id = s.opportunity_id
       LEFT JOIN government_exams e ON e.id = s.exam_id
      WHERE s.user_id = ?
      ORDER BY s.created_at DESC`,
    [authed.id],
  );

  const opportunities = rows
    .filter((row) => row.opportunity_id && row.id)
    .map((row) => ({
      ...enrichOpportunity(row, profile, context),
      savedAt: row.saved_at,
      note: row.note,
      reminderAt: row.reminder_at,
      savedId: row.saved_id,
    }));
  const examIds = rows.filter((row) => row.exam_id).map((row) => row.exam_id);
  const exams = examIds.length
    ? (await db.query<any>(
        `SELECT * FROM government_exams WHERE id IN (${examIds.map(() => '?').join(', ')})`,
        examIds,
      )).map((row) => enrichExam(row))
    : [];

  return json({ saved: opportunities, exams, total: rows.length });
}, { csrf: false });

/** POST /api/saved — save an opportunity or exam, optionally with a note and reminder. */
export const POST = route(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'saved.manage');
  if (!body.opportunityId && !body.examId) throw notFound('Provide an opportunity or exam id.');

  if (body.opportunityId) {
    const exists = await db.one('SELECT id FROM opportunities WHERE id = ?', [body.opportunityId]);
    if (!exists) throw notFound('Opportunity not found.');
  }
  if (body.examId) {
    const exists = await db.one('SELECT id FROM government_exams WHERE id = ?', [body.examId]);
    if (!exists) throw notFound('Examination not found.');
  }

  const existing = await db.one<{ id: string }>(
    'SELECT id FROM saved_opportunities WHERE user_id = ? AND COALESCE(opportunity_id, ?) = ? AND COALESCE(exam_id, ?) = ?',
    [user.id, body.opportunityId ?? '', body.opportunityId ?? '', body.examId ?? '', body.examId ?? ''],
  );

  if (existing) {
    await db.run('UPDATE saved_opportunities SET note = ?, reminder_at = ? WHERE id = ?', [
      body.note ?? '',
      body.reminderAt ?? null,
      existing.id,
    ]);
    return json({ id: existing.id, updated: true });
  }

  const id = uid();
  await insertRow('saved_opportunities', {
    id,
    user_id: user.id,
    opportunity_id: body.opportunityId ?? null,
    exam_id: body.examId ?? null,
    note: body.note ?? '',
    reminder_at: body.reminderAt ?? null,
    created_at: nowIso(),
  });

  // Personal reminder becomes a deadline row so the notification sweep picks it up.
  if (body.reminderAt) {
    const parsed = parseIstDate(body.reminderAt);
    await insertRow('deadlines', {
      id: uid(),
      user_id: user.id,
      opportunity_id: body.opportunityId ?? null,
      exam_id: body.examId ?? null,
      kind: 'custom',
      due_at: parsed ? parsed.toISOString() : body.reminderAt,
      remind_before_days: 0,
      status: 'upcoming',
      created_at: nowIso(),
    });
  }

  await audit({ userId: user.id, action: 'saved.create', resourceType: 'opportunity', resourceId: body.opportunityId ?? body.examId ?? '', ip: meta.ip });
  return json({ id, created: true }, { status: 201 });
}, { schema: savedSchema });

/** DELETE /api/saved?id=… — remove a saved entry. */
export const DELETE = route(async (request, { meta }) => {
  const { user } = await requirePermission(request, 'saved.manage');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw notFound('Provide the saved-entry id.');
  const row = await db.one<{ user_id: string }>('SELECT user_id FROM saved_opportunities WHERE id = ?', [id]);
  if (!row) throw notFound('Saved entry not found.');
  if (row.user_id !== user.id) throw notFound('Saved entry not found.');
  await db.run('DELETE FROM saved_opportunities WHERE id = ?', [id]);
  await audit({ userId: user.id, action: 'saved.delete', resourceType: 'saved_opportunity', resourceId: id, ip: meta.ip });
  return json({ deleted: true });
});
