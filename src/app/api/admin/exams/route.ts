import { route, json } from '@/lib/api/route';
import { adminExamSchema } from '@/lib/api/schemas';
import { db, nowIso } from '@/lib/db';
import { requirePermission, notFound, forbidden } from '@/lib/auth/rbac';
import { deriveStatus } from '@/lib/opportunity/deadline';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const GET = route(async (request) => {
  await requirePermission(request, 'exam.read');
  const rows = await db.query(
    `SELECT id, exam_name, organization, category, status, verification_status, application_start,
            application_deadline, exam_date, admit_card_date, result_status, vacancies, trust_score, last_verified
       FROM government_exams ORDER BY updated_at DESC LIMIT 200`,
  );
  return json({ exams: rows, total: rows.length });
}, { csrf: false });

/** PATCH /api/admin/exams — analyst/admin update of examination data. */
export const PATCH = route(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'exam.update');
  if (user.role === 'recruiter') throw forbidden('Recruiters cannot modify government examination data.');

  const row = await db.one<any>('SELECT * FROM government_exams WHERE id = ?', [body.id]);
  if (!row) throw notFound('Examination not found.');

  const before = {
    application_start: row.application_start, application_deadline: row.application_deadline,
    exam_date: row.exam_date, admit_card_date: row.admit_card_date, result_status: row.result_status,
    status: row.status, vacancies: row.vacancies,
  };

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  for (const field of ['applicationStart', 'applicationDeadline', 'examDate', 'admitCardDate'] as const) {
    if (body[field] !== undefined) {
      updates[field.replace(/([A-Z])/g, '_$1').toLowerCase()] = body[field];
    }
  }
  for (const field of ['resultStatus', 'answerKeyStatus', 'interviewStatus', 'finalResultStatus', 'status'] as const) {
    if (body[field] !== undefined) updates[field.replace(/([A-Z])/g, '_$1').toLowerCase()] = body[field];
  }
  if (body.vacancies !== undefined) updates.vacancies = body.vacancies;
  if (body.officialNotification !== undefined) updates.official_notification = body.officialNotification;
  if (body.officialApplication !== undefined) updates.official_application = body.officialApplication;

  if (body.status === undefined) {
    updates.status = deriveStatus({
      applicationStart: (updates.application_start as string) ?? row.application_start,
      applicationDeadline: (updates.application_deadline as string) ?? row.application_deadline,
      examDate: (updates.exam_date as string) ?? row.exam_date,
      admitCardDate: (updates.admit_card_date as string) ?? row.admit_card_date,
      resultStatus: (updates.result_status as string) ?? row.result_status,
    });
  }
  updates.last_verified = nowIso();

  const keys = Object.keys(updates);
  const sets = keys.map((key) => `${key} = ?`).join(', ');
  await db.run(`UPDATE government_exams SET ${sets} WHERE id = ?`, [...keys.map((key) => updates[key]), body.id]);

  // Keep the linked opportunity row consistent.
  if (row.opportunity_id) {
    await db.run(
      `UPDATE opportunities SET status = ?, application_start = ?, application_deadline = ?, exam_date = ?,
              last_verified = ?, updated_at = ? WHERE id = ?`,
      [
        updates.status, updates.application_start ?? row.application_start,
        updates.application_deadline ?? row.application_deadline, updates.exam_date ?? row.exam_date,
        nowIso(), nowIso(), row.opportunity_id,
      ],
    );
  }

  await db.run(
    `INSERT INTO verification_runs (id, exam_id, checked_fields, agreements, conflicts, outcome, checked_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, '[]', '[]', 'verified', ?)`,
    [body.id, JSON.stringify(Object.keys(body)), nowIso()],
  );

  await audit({
    userId: user.id, actorEmail: user.email, actorRole: user.role,
    action: 'exam.update', resourceType: 'government_exam', resourceId: body.id,
    previousValue: before, newValue: body, reason: body.reason ?? '', ip: meta.ip,
  });
  return json({ ok: true, status: updates.status });
}, { schema: adminExamSchema });
