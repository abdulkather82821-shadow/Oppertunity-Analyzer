import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/auth/rbac';
import { assertRateLimit } from '@/lib/rate-limit';
import { deleteResume, storeResume, UPLOAD_DIR } from '@/lib/services/profile-service';
import { MAX_UPLOAD_BYTES, UploadError } from '@/lib/parsing/extract';
import { ApiError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/** POST /api/resumes — multipart upload of a PDF/DOCX/TXT resume. */
export const POST = route(async (request, { user, body }) => {
  const { user: authed, meta } = await requirePermission(request, 'resume.upload');
  assertRateLimit({ key: `upload:${authed.id}`, limit: 10, windowMs: 60 * 60_000 });

  const form = body as unknown as FormData;
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new ApiError(400, 'No file was received.', 'missing_file');
  if (!(file instanceof File)) throw new ApiError(400, 'The upload field must be a file.', 'invalid_file');
  if (file.size === 0) throw new ApiError(400, 'The uploaded file is empty.', 'empty_file');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, `File exceeds the ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)} MB limit.`, 'file_too_large');
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  try {
    const outcome = await storeResume(authed.id, { name: file.name, type: file.type, bytes: buffer }, meta);
    return json(
      {
        resume: outcome.resume,
        profileId: outcome.profileId,
        warnings: outcome.warnings,
        summary: {
          education: outcome.parsed.education.length,
          experience: outcome.parsed.experience.length,
          skills: outcome.parsed.skills.length,
          certifications: outcome.parsed.certifications.length,
          projects: outcome.parsed.projects.length,
          name: outcome.parsed.personal.name,
          location: outcome.parsed.personal.location,
          totalExperienceYears: outcome.parsed.personal.totalExperienceYears,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof UploadError) throw new ApiError(422, error.message, error.code);
    throw error;
  }
});

/** GET /api/resumes — the signed-in user's own resumes only. */
export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'resume.read');
  const rows = await db.query(
    `SELECT id, original_name, mime_type, extension, size_bytes, sha256, malware_scan, parse_status,
            storage_encrypted, text_length, created_at
       FROM resumes WHERE user_id = ? ORDER BY created_at DESC`,
    [user.id],
  );
  const url = new URL(request.url);
  let history: unknown[] = [];
  if (url.searchParams.get('history') === '1') {
    history = await db.query(
      `SELECT r.id, r.score, r.ats_score, r.result, r.created_at, o.title
         FROM resume_optimizations r LEFT JOIN opportunities o ON o.id = r.opportunity_id
        WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 10`,
      [user.id],
    );
  }

  return json({ resumes: rows, history, uploadDirConfigured: Boolean(UPLOAD_DIR) });
}, { csrf: false });

/**
 * DELETE /api/resumes?all=1 — removes EVERY resume the caller owns, and the profile built from
 * them. Deliberately explicit: deleting one resume is `DELETE /api/resumes/[id]`, and a bulk
 * wipe must never be the silent result of a request that merely forgot to name a resume.
 */
export const DELETE = route(async (request) => {
  const { user, meta } = await requirePermission(request, 'resume.delete');
  if (new URL(request.url).searchParams.get('all') !== '1') {
    throw new ApiError(400, 'To delete one resume use DELETE /api/resumes/{id}. To delete all of them, pass all=1.', 'explicit_all_required');
  }
  const rows = await db.query<{ id: string }>('SELECT id FROM resumes WHERE user_id = ?', [user.id]);
  for (const row of rows) await deleteResume(row.id, user.id);
  // Anything left over (a profile whose resume link was already cleared) goes too.
  await db.run('DELETE FROM candidate_profiles WHERE user_id = ?', [user.id]);
  const { audit } = await import('@/lib/audit');
  await audit({ userId: user.id, action: 'resume.delete', resourceType: 'resume', resourceId: '*', reason: 'user requested deletion of all resumes', ip: meta.ip });
  return json({ deleted: rows.length });
});
