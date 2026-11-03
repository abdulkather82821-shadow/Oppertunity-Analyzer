import { route, json } from '@/lib/api/route';
import { applicationSchema } from '@/lib/api/schemas';
import { db, insertRow, jsonDecode, nowIso, uid } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit';
import { relativeTime } from '@/lib/opportunity/deadline';

export const dynamic = 'force-dynamic';

const STATUS_FLOW = ['interested', 'to_apply', 'applied', 'test_scheduled', 'interview_scheduled', 'selected', 'rejected', 'withdrawn'] as const;

export interface ApplicationRecord {
  id: string;
  title: string;
  organization: string;
  status: string;
  opportunityId: string | null;
  examId: string | null;
  appliedAt: string | null;
  testAt: string | null;
  interviewAt: string | null;
  interviewInfo: string;
  resultKnown: string | null;
  notes: string;
  history: { status: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

function map(row: any): ApplicationRecord {
  return {
    id: row.id,
    title: row.title,
    organization: row.organization ?? '',
    status: row.status,
    opportunityId: row.opportunity_id,
    examId: row.exam_id,
    appliedAt: row.applied_at,
    testAt: row.test_at,
    interviewAt: row.interview_at,
    interviewInfo: row.interview_info ?? '',
    resultKnown: row.result_known,
    notes: row.notes ?? '',
    history: jsonDecode<{ status: string; at: string }[]>(row.history, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET /api/applications — the caller's application tracker. */
export const GET = route(async (request, { user }) => {
  const { user: authed } = await requirePermission(request, 'application.read');
  const rows = await db.query<any>(
    `SELECT a.*, o.title AS opp_title, o.organization AS opp_org, e.exam_name
       FROM applications a
       LEFT JOIN opportunities o ON o.id = a.opportunity_id
       LEFT JOIN government_exams e ON e.id = a.exam_id
      WHERE a.user_id = ?
      ORDER BY a.updated_at DESC`,
    [authed.id],
  );
  const applications = rows.map((row) => map(row));
  const counts: Record<string, number> = {};
  for (const status of STATUS_FLOW) counts[status] = applications.filter((a) => a.status === status).length;

  return json({
    applications: applications.map((application) => ({ ...application, updatedAtAgo: relativeTime(application.updatedAt) })),
    counts,
    statuses: [...STATUS_FLOW],
    total: applications.length,
  });
}, { csrf: false });

/** POST /api/applications — create or update a tracked application. */
export const POST = route(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'application.create');
  const now = nowIso();

  if (body.id) {
    const existing = await db.one<any>('SELECT * FROM applications WHERE id = ?', [body.id]);
    if (!existing) throw notFound('Application not found.');
    if (existing.user_id !== user.id) throw notFound('Application not found.');

    const history = jsonDecode<{ status: string; at: string }[]>(existing.history, []);
    const nextStatus = body.status ?? existing.status;
    if (nextStatus !== existing.status) history.push({ status: nextStatus, at: now });

    const updates: Record<string, unknown> = {
      title: body.title ?? existing.title,
      organization: body.organization ?? existing.organization,
      status: nextStatus,
      applied_at: body.appliedAt !== undefined ? body.appliedAt : existing.applied_at,
      test_at: body.testAt !== undefined ? body.testAt : existing.test_at,
      interview_at: body.interviewAt !== undefined ? body.interviewAt : existing.interview_at,
      interview_info: body.interviewInfo ?? existing.interview_info,
      result_known: body.resultKnown !== undefined ? body.resultKnown : existing.result_known,
      notes: body.notes ?? existing.notes,
      history: JSON.stringify(history),
      updated_at: now,
    };
    const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
    await db.run(`UPDATE applications SET ${sets} WHERE id = ?`, [...Object.values(updates), body.id]);

    await audit({
      userId: user.id,
      action: 'application.update',
      resourceType: 'application',
      resourceId: body.id,
      previousValue: { status: existing.status },
      newValue: { status: nextStatus },
      ip: meta.ip,
    });
    return json({ application: map(await db.one('SELECT * FROM applications WHERE id = ?', [body.id])) });
  }

  const id = uid();
  await insertRow('applications', {
    id,
    user_id: user.id,
    opportunity_id: body.opportunityId ?? null,
    exam_id: body.examId ?? null,
    title: body.title,
    organization: body.organization ?? '',
    status: body.status ?? 'interested',
    applied_at: body.appliedAt ?? null,
    test_at: body.testAt ?? null,
    interview_at: body.interviewAt ?? null,
    interview_info: body.interviewInfo ?? '',
    result_known: body.resultKnown ?? null,
    notes: body.notes ?? '',
    history: JSON.stringify([{ status: body.status ?? 'interested', at: now }]),
    created_at: now,
    updated_at: now,
  });
  await audit({ userId: user.id, action: 'application.create', resourceType: 'application', resourceId: id, ip: meta.ip });
  return json({ application: map(await db.one('SELECT * FROM applications WHERE id = ?', [id])) }, { status: 201 });
}, { schema: applicationSchema });

/** DELETE /api/applications?id=… */
export const DELETE = route(async (request, { meta }) => {
  const { user } = await requirePermission(request, 'application.delete');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw notFound('Provide the application id.');
  const row = await db.one<{ user_id: string }>('SELECT user_id FROM applications WHERE id = ?', [id]);
  if (!row || row.user_id !== user.id) throw notFound('Application not found.');
  await db.run('DELETE FROM applications WHERE id = ?', [id]);
  await audit({ userId: user.id, action: 'application.delete', resourceType: 'application', resourceId: id, ip: meta.ip });
  return json({ deleted: true });
});
