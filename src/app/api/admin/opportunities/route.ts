import { route, json } from '@/lib/api/route';
import { adminOpportunitySchema } from '@/lib/api/schemas';
import { db, nowIso } from '@/lib/db';
import { requirePermission, notFound, forbidden } from '@/lib/auth/rbac';
import { deriveStatus } from '@/lib/opportunity/deadline';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** GET /api/admin/opportunities — full list including inactive and demo records. */
export const GET = route(async (request) => {
  await requirePermission(request, 'opportunity.read_all');
  const url = new URL(request.url);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (url.searchParams.get('q')) {
    conditions.push('(LOWER(title) LIKE LOWER(?) OR LOWER(organization) LIKE LOWER(?))');
    params.push(`%${url.searchParams.get('q')}%`, `%${url.searchParams.get('q')}%`);
  }
  if (url.searchParams.get('verification')) {
    conditions.push('verification_status = ?');
    params.push(url.searchParams.get('verification'));
  }
  if (url.searchParams.get('active') === 'false') conditions.push('is_active = 0');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.query(
    `SELECT id, title, organization, type, category, status, verification_status, trust_score, final_score,
            application_deadline, official_source, duplicate_group, duplicate_count, is_demo, is_active, last_verified
       FROM opportunities ${where} ORDER BY updated_at DESC LIMIT 200`,
    params,
  );
  return json({ opportunities: rows, total: rows.length });
}, { csrf: false });

/** PATCH /api/admin/opportunities — analyst/admin correction of a record. */
export const PATCH = route(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'opportunity.update');
  const row = await db.one<any>('SELECT * FROM opportunities WHERE id = ?', [body.id]);
  if (!row) throw notFound('Opportunity not found.');

  // Recruiters may only touch their own organisation's listings.
  if (user.role === 'recruiter') {
    const org = await db.one<any>(
      'SELECT organization_id FROM user_settings WHERE user_id = ?', [user.id],
    );
    if (!org?.organization_id) throw forbidden('Your recruiter account is not linked to a verified organisation.');
    const owned = await db.one('SELECT id FROM opportunities WHERE id = ? AND posted_by_user_id = ?', [body.id, user.id]);
    if (!owned) throw forbidden('You can only edit listings published by your own organisation.');
  }

  const before = {
    title: row.title, organization: row.organization, status: row.status,
    application_start: row.application_start, application_deadline: row.application_deadline,
    exam_date: row.exam_date, verification_status: row.verification_status, is_active: row.is_active,
  };

  const updates: Record<string, unknown> = { updated_at: nowIso() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.organization !== undefined) updates.organization = body.organization;
  if (body.applicationStart !== undefined) updates.application_start = body.applicationStart;
  if (body.applicationDeadline !== undefined) updates.application_deadline = body.applicationDeadline;
  if (body.examDate !== undefined) updates.exam_date = body.examDate;
  if (body.verificationStatus !== undefined) updates.verification_status = body.verificationStatus;
  if (body.isActive !== undefined) updates.is_active = body.isActive ? 1 : 0;
  if (body.officialSource !== undefined) updates.official_source = body.officialSource;
  if (body.applicationUrl !== undefined) updates.application_url = body.applicationUrl;
  if (body.status !== undefined) updates.status = body.status;

  // Re-derive status from the corrected dates unless the analyst set one explicitly.
  if (body.status === undefined && (body.applicationDeadline !== undefined || body.applicationStart !== undefined || body.examDate !== undefined)) {
    updates.status = deriveStatus({
      applicationStart: (updates.application_start as string) ?? row.application_start,
      applicationDeadline: (updates.application_deadline as string) ?? row.application_deadline,
      examDate: (updates.exam_date as string) ?? row.exam_date,
    });
  }
  // A manual correction is a verification event.
  if (body.verificationStatus) {
    updates.last_verified = nowIso();
    await db.run(
      `INSERT INTO verification_runs (id, opportunity_id, checked_fields, agreements, conflicts, outcome, checked_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, '[]', '[]', ?, ?)`,
      [body.id, JSON.stringify(Object.keys(body)), body.verificationStatus, nowIso()],
    );
  }

  const keys = Object.keys(updates);
  const sets = keys.map((key) => `${key} = ?`).join(', ');
  await db.run(`UPDATE opportunities SET ${sets} WHERE id = ?`, [...keys.map((key) => updates[key]), body.id]);

  await audit({
    userId: user.id, actorEmail: user.email, actorRole: user.role,
    action: 'opportunity.update', resourceType: 'opportunity', resourceId: body.id,
    previousValue: before, newValue: body, reason: body.reason ?? '', ip: meta.ip,
  });
  return json({ ok: true });
}, { schema: adminOpportunitySchema });

/** DELETE /api/admin/opportunities?id=… — archive (soft delete) rather than destroy. */
export const DELETE = route(async (request, { meta }) => {
  const { user } = await requirePermission(request, 'opportunity.archive');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) throw notFound('Provide the opportunity id.');
  const row = await db.one<{ id: string; is_active: number }>('SELECT id, is_active FROM opportunities WHERE id = ?', [id]);
  if (!row) throw notFound('Opportunity not found.');
  await db.run('UPDATE opportunities SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
  await audit({ userId: user.id, actorEmail: user.email, actorRole: user.role, action: 'opportunity.archive', resourceType: 'opportunity', resourceId: id, previousValue: { is_active: row.is_active }, newValue: { is_active: 0 }, reason: new URL(request.url).searchParams.get('reason') ?? '', ip: meta.ip });
  return json({ archived: true });
});
