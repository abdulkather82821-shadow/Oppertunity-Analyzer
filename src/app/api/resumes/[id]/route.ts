import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission, requireOwnership, notFound } from '@/lib/auth/rbac';
import { deleteResume } from '@/lib/services/profile-service';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

export const DELETE = route(async (request, { params, meta }) => {
  const { user } = await requirePermission(request, 'resume.delete');
  const row = await db.one<{ user_id: string }>('SELECT user_id FROM resumes WHERE id = ?', [params.id]);
  if (!row) throw notFound('Resume not found.');
  await requireOwnership(user, row.user_id);
  const removed = await deleteResume(params.id, user.id);
  await audit({ userId: user.id, action: 'resume.delete', resourceType: 'resume', resourceId: params.id, ip: meta.ip });
  return json({ deleted: removed });
});
