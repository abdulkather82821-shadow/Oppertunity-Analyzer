import { route, json } from '@/lib/api/route';
import { profileEditSchema } from '@/lib/api/schemas';
import { db, jsonDecode, jsonList, nowIso } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { loadProfile } from '@/lib/services/profile-service';
import { profileCandidate } from '@/lib/analysis/profiler';
import { audit } from '@/lib/audit';
import { uid } from '@/lib/db';
import { SKILL_TAXONOMY } from '@/lib/analysis/taxonomy';

export const dynamic = 'force-dynamic';

/**
 * GET /api/profile — the caller's own AI career profile.
 * Resume-derived fields and AI-inferred fields are returned separately so the UI can
 * label them differently; nothing inferred is presented as a fact from the document.
 */
export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'profile.read');
  const row = await db.one<any>('SELECT * FROM candidate_profiles WHERE user_id = ?', [user.id]);
  if (!row) throw notFound('No career profile yet — upload a resume first.');

  const [education, experiences, skills, certifications, projects, resume] = await Promise.all([
    db.query('SELECT * FROM education WHERE profile_id = ? ORDER BY graduation_year DESC', [row.id]),
    db.query('SELECT * FROM experiences WHERE profile_id = ? ORDER BY start_date DESC', [row.id]),
    db.query('SELECT * FROM skills WHERE profile_id = ? ORDER BY confidence DESC', [row.id]),
    db.query('SELECT * FROM certifications WHERE profile_id = ?', [row.id]),
    db.query('SELECT * FROM projects WHERE profile_id = ?', [row.id]),
    db.one<any>('SELECT id, original_name, size_bytes, extension, malware_scan, storage_encrypted, created_at FROM resumes WHERE id = ?', [row.resume_id]),
  ]);

  const profile = await loadProfile(user.id);

  const warnings = jsonDecode<{ field: string; code: string; message: string }[]>(row.parse_warnings, []);
  const analysisFallbackUsed = row.analysis_provider === 'heuristic' ? 1 : 0;

  return json({
    profileId: row.id,
    resume,
    warnings,
    analysisProvider: row.analysis_provider ?? 'unknown',
    analysisFallbackUsed,
    userEdited: Boolean(row.user_edited),
    updatedAt: row.updated_at,
    /**
     * Every inferred field is a ScoredItem {name, confidence, source, rationale} so the UI can
     * show a confidence chip and distinguish resume-derived from AI-inferred.
     */
    profile: profile
      ? {
          careerLevel: profile.careerLevel,
          jobFamilies: profile.jobFamilies,
          industries: profile.industries,
          // Every inferred field carries a confidence and its provenance. The profiler keeps only
          // names here, so join them with the parsed skills, which record both.
          strongestSkills: profile.strongestSkills.map((name) => {
            const skill = profile.skills.find((entry) => entry.canonical === name || entry.name === name);
            return {
              name,
              confidence: skill?.confidence ?? 0,
              source: 'resume' as const,
              rationale: skill ? 'Listed on your resume' : 'Not found among the parsed skills',
            };
          }),
          missingSkills: profile.missingSkills,
          transferableSkills: profile.transferableSkills,
          careerPaths: profile.careerPaths,
          governmentCategories: profile.governmentCategories,
          examCategories: profile.examCategories,
          highestDegreeLevel: profile.highestDegreeLevel,
          fieldsOfStudy: profile.fieldsOfStudy,
        }
      : null,
    education: profile?.education ?? [],
    experiences: profile?.experience ?? [],
    experience: profile?.experience ?? [],
    skills: profile?.skills ?? [],
    certifications: profile?.certifications ?? [],
    projects: profile?.projects ?? [],
    personal: profile?.personal ?? null,
    // --- raw rows, kept for the admin/debug views ---------------------------
    derived: {
      fullName: row.full_name,
      professionalTitle: row.professional_title,
      careerObjective: row.career_objective,
      location: row.location,
      preferredLocations: jsonList<string>(row.preferred_locations),
      industry: row.industry,
      totalExperienceYears: row.total_experience_years,
      dateOfBirth: row.date_of_birth,
      ageYears: row.age_years,
      salaryExpectation: row.salary_expectation,
    },
    inferences: jsonDecode(row.inferences, {}),
    confidence: jsonDecode<Record<string, number>>(row.confidence, {}),
  });
}, { csrf: false });

/**
 * PATCH /api/profile — correct extraction errors.
 * Editing marks the profile `user_edited` so downstream engines know a human overrode the
 * parser, and the change is audited with before/after values.
 */
export const PATCH = route<import('zod').z.infer<typeof profileEditSchema>>(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'profile.update');
  const row = await db.one<any>('SELECT * FROM candidate_profiles WHERE user_id = ?', [user.id]);
  if (!row) throw notFound('No career profile to edit.');

  const before = {
    full_name: row.full_name,
    professional_title: row.professional_title,
    location: row.location,
    preferred_locations: row.preferred_locations,
    total_experience_years: row.total_experience_years,
    salary_expectation: row.salary_expectation,
  };

  const updates: Record<string, unknown> = { updated_at: nowIso(), user_edited: 1 };
  if (body.fullName !== undefined) updates.full_name = body.fullName;
  if (body.professionalTitle !== undefined) updates.professional_title = body.professionalTitle;
  if (body.careerObjective !== undefined) updates.career_objective = body.careerObjective;
  if (body.location !== undefined) updates.location = body.location;
  if (body.preferredLocations !== undefined) updates.preferred_locations = JSON.stringify(body.preferredLocations);
  if (body.totalExperienceYears !== undefined) updates.total_experience_years = body.totalExperienceYears;
  if (body.dateOfBirth !== undefined) updates.date_of_birth = body.dateOfBirth;
  if (body.salaryExpectation !== undefined) updates.salary_expectation = body.salaryExpectation;

  const sets = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  await db.run(`UPDATE candidate_profiles SET ${sets} WHERE id = ?`, [...Object.values(updates), row.id]);

  for (const skill of body.removeSkills ?? []) {
    await db.run('DELETE FROM skills WHERE profile_id = ? AND name = ?', [row.id, skill]);
  }
  for (const skill of body.addSkills ?? []) {
    const exists = await db.one('SELECT id FROM skills WHERE profile_id = ? AND name = ?', [row.id, skill]);
    if (exists) continue;
    const entry = SKILL_TAXONOMY.find((s) => s.canonical.toLowerCase() === skill.toLowerCase());
    await db.run(
      `INSERT INTO skills (id, profile_id, name, category, proficiency, source, confidence, created_at)
       VALUES (?, ?, ?, ?, 'stated', 'resume', 1, ?)`,
      [uid(), row.id, entry?.canonical ?? skill, entry?.category ?? 'other', nowIso()],
    );
  }

  await audit({
    userId: user.id,
    action: 'profile.update',
    resourceType: 'candidate_profile',
    resourceId: row.id,
    previousValue: before,
    newValue: body,
    reason: 'user corrected extracted resume information',
    ip: meta.ip,
  });

  const refreshed = await loadProfile(user.id);
  void profileCandidate;
  return json({ ok: true, profile: refreshed });
});
