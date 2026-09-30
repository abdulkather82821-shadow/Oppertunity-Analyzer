import { route } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission, requireOwnership, notFound } from '@/lib/auth/rbac';
import { readResumeFile } from '@/lib/services/profile-service';
import { audit } from '@/lib/audit';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

/**
 * GET /api/resumes/[id]/download
 * Owner-only download of the ORIGINAL uploaded file — the platform never serves a
 * transformed copy, and another user's resume is unreachable at the API level even if the
 * id is known.
 */
export const GET = route(async (request, { params }) => {
  const { user } = await requirePermission(request, 'resume.download');
  const row = await db.one<{ user_id: string; original_name: string; extension: string }>(
    'SELECT user_id, original_name, extension FROM resumes WHERE id = ?',
    [params.id],
  );
  if (!row) throw notFound('Resume not found.');
  await requireOwnership(user, row.user_id, 'resume.read_any');

  const buffer = await readResumeFile(params.id, user.id);
  if (!buffer) throw notFound('Resume file is no longer available on disk.');
  await audit({ userId: user.id, action: 'resume.download', resourceType: 'resume', resourceId: params.id });

  const safeName = row.original_name.replace(/["\\\r\n]/g, '').slice(0, 200);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': MIME[row.extension] ?? 'application/octet-stream',
      'content-disposition': `attachment; filename="${safeName}"`,
      'content-length': String(buffer.length),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}, { csrf: false });
