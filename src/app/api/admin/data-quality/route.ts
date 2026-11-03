import { route, json } from '@/lib/api/route';
import { db, nowIso } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { groupDuplicates } from '@/lib/opportunity/dedupe';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/** GET /api/admin/data-quality — open issues, duplicate groups, stale and expired records. */
export const GET = route(async (request) => {
  await requirePermission(request, 'opportunity.read_all');
  const [issues, stale, expired, unverified] = await Promise.all([
    db.query(
      `SELECT d.id, d.kind, d.severity, d.detail, d.created_at, o.title, o.id AS opportunity_id, e.exam_name
         FROM data_quality_issues d
         LEFT JOIN opportunities o ON o.id = d.opportunity_id
         LEFT JOIN government_exams e ON e.id = d.exam_id
        WHERE d.resolved = 0 ORDER BY d.created_at DESC LIMIT 100`,
    ),
    db.query(
      `SELECT id, title, last_verified, next_verification FROM opportunities
        WHERE is_active = 1 AND application_deadline IS NOT NULL AND application_deadline > ?
          AND (next_verification IS NULL OR next_verification < ?)
        ORDER BY application_deadline ASC LIMIT 30`,
      [nowIso(), nowIso()],
    ),
    db.query(
      `SELECT id, title, application_deadline, status FROM opportunities
        WHERE is_active = 1 AND application_deadline IS NOT NULL AND application_deadline < ?
        ORDER BY application_deadline DESC LIMIT 30`,
      [nowIso()],
    ),
    db.query(
      `SELECT id, title, organization, verification_status, official_source FROM opportunities
        WHERE is_active = 1 AND (official_source IS NULL OR official_source = '')
        ORDER BY trust_score ASC LIMIT 30`,
    ),
  ]);

  // Live duplicate detection across the active catalogue.
  const rows = await db.query<any>(
    `SELECT id, title, organization, category, application_deadline, exam_date, official_source, source_urls, trust_score
       FROM opportunities WHERE is_active = 1`,
  );
  const groups = groupDuplicates(
    rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      organization: row.organization ?? '',
      category: row.category ?? '',
      applicationDeadline: row.application_deadline,
      examDate: row.exam_date,
      officialSource: row.official_source,
      sourceUrls: (() => { try { return JSON.parse(row.source_urls || '[]'); } catch { return []; } })(),
      trustScore: Number(row.trust_score ?? 50),
    })),
  ).filter((group) => group.members.length > 1);

  return json({
    issues,
    stale,
    expired,
    missingOfficialSource: unverified,
    duplicateGroups: groups.map((group) => ({
      key: group.key,
      sourceCount: group.sourceCount,
      representative: group.representative,
      members: group.members,
      conflicts: group.conflicts,
    })),
  });
}, { csrf: false });

/** POST /api/admin/data-quality — resolve an issue or merge a duplicate group. */
export const POST = route(async (request, { meta }) => {
  const { user } = await requirePermission(request, 'opportunity.merge_duplicates');
  const body = (await request.json()) as { issueId?: string; mergeInto?: string; mergeFrom?: string[]; reason?: string };

  if (body.issueId) {
    const row = await db.one('SELECT id FROM data_quality_issues WHERE id = ?', [body.issueId]);
    if (!row) throw notFound('Issue not found.');
    await db.run('UPDATE data_quality_issues SET resolved = 1, resolved_by = ?, resolved_at = ? WHERE id = ?', [user.id, nowIso(), body.issueId]);
    await audit({ userId: user.id, actorEmail: user.email, actorRole: user.role, action: 'data_quality.resolve', resourceType: 'data_quality_issue', resourceId: body.issueId, reason: body.reason ?? '', ip: meta.ip });
    return json({ resolved: true });
  }

  if (body.mergeInto && body.mergeFrom?.length) {
    const target = await db.one<{ id: string; duplicate_group: string; duplicate_count: number }>(
      'SELECT id, duplicate_group, duplicate_count FROM opportunities WHERE id = ?', [body.mergeInto],
    );
    if (!target) throw notFound('Target opportunity not found.');
    const group = target.duplicate_group ?? target.id;
    for (const id of body.mergeFrom) {
      if (id === body.mergeInto) continue;
      await db.run('UPDATE opportunities SET duplicate_group = ?, is_active = 0, updated_at = ? WHERE id = ?', [group, nowIso(), id]);
      await db.run('UPDATE saved_opportunities SET opportunity_id = ? WHERE opportunity_id = ?', [body.mergeInto, id]);
    }
    await db.run('UPDATE opportunities SET duplicate_group = ?, duplicate_count = duplicate_count + ?, updated_at = ? WHERE id = ?', [
      group, body.mergeFrom.length, nowIso(), body.mergeInto,
    ]);
    await audit({
      userId: user.id, actorEmail: user.email, actorRole: user.role, action: 'opportunity.merge_duplicates',
      resourceType: 'opportunity', resourceId: body.mergeInto,
      newValue: { mergedFrom: body.mergeFrom }, reason: body.reason ?? '', ip: meta.ip,
    });
    return json({ merged: body.mergeFrom.length, into: body.mergeInto });
  }

  throw notFound('Provide issueId or mergeInto/mergeFrom.');
});
