import fs from 'node:fs/promises';
import path from 'node:path';
import { route, json } from '@/lib/api/route';
import { optimizerSchema } from '@/lib/api/schemas';
import { db, insertRow, jsonList, nowIso, uid } from '@/lib/db';
import { ApiError, requirePermission, notFound, badRequest } from '@/lib/auth/rbac';
import { flagEnabled } from '@/lib/config';
import { loadProfile } from '@/lib/services/profile-service';
import { optimiseResume } from '@/lib/ai/chat';
import { decryptAtRest } from '@/lib/parsing/extract';
import { parseResume } from '@/lib/analysis/resume-parser';
import { UPLOAD_DIR } from '@/lib/services/profile-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/resume-optimizer
 * Compares the caller's own resume against a job (either a stored opportunity or a pasted
 * description). It never invents experience — it reports missing keywords and suggests how
 * to rephrase what is already there.
 */
export const POST = route(async (request, { body, user }) => {
  const { user: authed } = await requirePermission(request, 'resume.read');
  if (!flagEnabled('resume_optimizer')) throw new ApiError(403, 'The resume optimiser has been turned off by an administrator.', 'feature_disabled');
  const profile = await loadProfile(authed.id);
  if (!profile) throw notFound('Upload a resume first.');

  const resumeRow = await db.one<any>('SELECT id, storage_path, storage_encrypted FROM resumes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [authed.id]);
  if (!resumeRow) throw notFound('No resume on file.');

  let job = { title: '', description: '', skills: [] as string[], qualification: [] as string[], experienceRequired: '' };
  if (body.opportunityId) {
    const opportunity = await db.one<any>('SELECT title, description, skills, qualification, experience_required FROM opportunities WHERE id = ?', [body.opportunityId]);
    if (!opportunity) throw notFound('Opportunity not found.');
    job = {
      title: opportunity.title,
      description: opportunity.description,
      skills: jsonList<string>(opportunity.skills),
      qualification: jsonList<string>(opportunity.qualification),
      experienceRequired: opportunity.experience_required ?? '',
    };
  } else if (body.jobDescription) {
    job = { title: 'Pasted job description', description: body.jobDescription, skills: [], qualification: [], experienceRequired: '' };
  } else {
    throw badRequest('Provide either opportunityId or jobDescription.');
  }

  const buffer = await fs.readFile(path.join(UPLOAD_DIR, resumeRow.storage_path));
  const raw = decryptAtRest(new Uint8Array(buffer), Boolean(resumeRow.storage_encrypted));
  const parsed = parseResume(Buffer.from(raw).toString('utf8'));

  const result = await optimiseResume(authed.id, profile, parsed.rawText, job);
  await insertRow('resume_optimizations', {
    id: uid(),
    user_id: authed.id,
    resume_id: resumeRow.id,
    opportunity_id: body.opportunityId ?? null,
    score: result.score,
    ats_score: result.atsScore,
    result: JSON.stringify(result),
    created_at: nowIso(),
  });

  return json({ ...result, jobTitle: job.title, resumeId: resumeRow.id });
}, { schema: optimizerSchema });
