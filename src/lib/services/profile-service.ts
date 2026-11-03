import fs from 'node:fs/promises';
import path from 'node:path';
import { db, insertRow, jsonDecode, jsonList, nowIso, num, bool, uid } from '@/lib/db';
import { encryptAtRest, decryptAtRest, extractResumeText, scanForMalware, validateUpload, type AllowedExtension, UploadError } from '@/lib/parsing/extract';
import { parseResume, type ParsedResume } from '@/lib/analysis/resume-parser';
import { profileCandidate, type CandidateProfileData, type ScoredItem } from '@/lib/analysis/profiler';
import { resolveLocations } from '@/lib/analysis/profiler';
import { audit } from '@/lib/audit';

/**
 * Resume + candidate-profile persistence.
 *
 * Uploaded files are written outside the web root under `data/uploads/`, encrypted at rest
 * when ENCRYPTION_KEY is set, and are only ever readable by their owner. The extracted
 * text is normalised (control characters stripped) before storage.
 */

/**
 * Where resume files live. Override with UPLOAD_DIR (absolute, or relative to the working
 * directory) to put them on a mounted volume; the default keeps them out of the web root under
 * ./data/uploads. Nothing in this directory is ever served directly: every download goes
 * through an authenticated, owner-checked route.
 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.cwd(), process.env.UPLOAD_DIR)
  : path.join(process.cwd(), 'data', 'uploads');

export interface StoredResume {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  malwareScan: string;
  parseStatus: string;
  warnings: string[];
  createdAt: string;
}

export interface UploadOutcome {
  resume: StoredResume;
  parsed: ParsedResume;
  profileId: string;
  warnings: string[];
}

export async function storeResume(
  userId: string,
  file: { name: string; type: string | null; bytes: Uint8Array },
  meta: { ip?: string; sessionId?: string } = {},
): Promise<UploadOutcome> {
  const extension: AllowedExtension = validateUpload(file.bytes, file.name, file.type);
  const malwareScan = await scanForMalware(file.bytes);
  if (malwareScan === 'infected') {
    throw new UploadError('This file was flagged by malware scanning and was not stored.', 'malware_detected');
  }

  const { text, mimeType, sha256, sizeBytes, warnings } = await extractResumeText(file.bytes, extension, file.type);
  const { encrypted, data } = encryptAtRest(file.bytes);

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const resumeId = uid();
  const filename = `${resumeId}.${extension}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(data));

  const now = nowIso();
  await insertRow('resumes', {
    id: resumeId,
    user_id: userId,
    original_name: file.name.slice(0, 255),
    mime_type: mimeType,
    extension,
    size_bytes: sizeBytes,
    sha256,
    storage_path: filename,
    storage_encrypted: encrypted ? 1 : 0,
    text_length: text.length,
    malware_scan: malwareScan,
    parse_status: 'parsed',
    is_active: 1,
    created_at: now,
    updated_at: now,
  });

  await db.run('UPDATE resumes SET is_active = 0 WHERE user_id = ? AND id <> ?', [userId, resumeId]);

  const parsed = parseResume(text);
  const profileId = await persistProfile(userId, resumeId, parsed);

  await audit({
    userId,
    action: 'resume.upload',
    resourceType: 'resume',
    resourceId: resumeId,
    newValue: { name: file.name, sizeBytes, extension, sha256, malwareScan },
    ip: meta.ip,
    sessionId: meta.sessionId,
  });

  return {
    resume: {
      id: resumeId,
      userId,
      originalName: file.name,
      mimeType,
      extension,
      sizeBytes,
      sha256,
      malwareScan,
      parseStatus: 'parsed',
      warnings,
      createdAt: now,
    },
    parsed,
    profileId,
    warnings: [...warnings, ...parsed.warnings],
  };
}

export async function persistProfile(userId: string, resumeId: string, parsed: ParsedResume): Promise<string> {
  const profile = profileCandidate(parsed);
  const now = nowIso();

  const existing = await db.one<{ id: string }>('SELECT id FROM candidate_profiles WHERE user_id = ?', [userId]);
  const profileId = existing?.id ?? uid();

  const inferences: Record<string, { value: unknown; confidence: number; source: 'resume' | 'inferred' }> = {
    careerLevel: { value: profile.careerLevel.name, confidence: profile.careerLevel.confidence, source: 'inferred' },
    jobFamilies: { value: profile.jobFamilies.map((f) => f.name), confidence: profile.jobFamilies[0]?.confidence ?? 0, source: 'inferred' },
    industries: { value: profile.industries.map((i) => i.name), confidence: profile.industries[0]?.confidence ?? 0, source: 'inferred' },
    governmentCategories: { value: profile.governmentCategories.map((g) => g.name), confidence: profile.governmentCategories[0]?.confidence ?? 0, source: 'inferred' },
    examCategories: { value: profile.examCategories.map((e) => e.name), confidence: profile.examCategories[0]?.confidence ?? 0, source: 'inferred' },
    totalExperienceYears: { value: profile.personal.totalExperienceYears, confidence: parsed.personal.totalExperienceYears !== null ? 0.95 : 0.7, source: parsed.personal.totalExperienceYears !== null ? 'resume' : 'inferred' },
    location: { value: profile.personal.location, confidence: profile.personal.location ? 0.9 : 0, source: 'resume' },
  };
  const confidence: Record<string, number> = {};
  for (const [key, value] of Object.entries(inferences)) confidence[key] = value.confidence;

  const row: Record<string, unknown> = {
    id: profileId,
    user_id: userId,
    resume_id: resumeId,
    full_name: profile.personal.name,
    professional_title: profile.personal.professionalTitle,
    career_objective: profile.personal.careerObjective,
    total_experience_years: profile.personal.totalExperienceYears,
    location: profile.personal.location,
    preferred_locations: JSON.stringify(resolveLocations(parsed)),
    industry: profile.personal.industry,
    date_of_birth: profile.personal.dateOfBirth,
    age_years: profile.personal.ageYears,
    salary_expectation: profile.personal.salaryExpectation,
    contact_redacted: 1,
    raw_sections: JSON.stringify(parsed.sections ?? {}),
    career_level: profile.careerLevel.name,
    job_families: JSON.stringify(profile.jobFamilies),
    strongest_skills: JSON.stringify(profile.strongestSkills),
    missing_skills: JSON.stringify(profile.missingSkills),
    transferable_skills: JSON.stringify(profile.transferableSkills),
    career_paths: JSON.stringify(profile.careerPaths),
    industries: JSON.stringify(profile.industries),
    government_categories: JSON.stringify(profile.governmentCategories),
    exam_categories: JSON.stringify(profile.examCategories),
    inferences: JSON.stringify(inferences),
    confidence: JSON.stringify(confidence),
    analysis_provider: 'heuristic-local',
    parse_warnings: JSON.stringify(
      (parsed.warnings ?? []).map((message) => ({
        field: message.includes('education') ? 'education'
          : message.includes('experience') ? 'experience'
          : message.includes('skills') ? 'skills'
          : message.includes('name') ? 'name'
          : 'general',
        code: 'not_detected',
        message,
      })),
    ),
    status: 'ready',
    updated_at: now,
  };

  if (existing) {
    const sets = Object.keys(row).filter((k) => k !== 'id').map((k) => `${k} = ?`).join(', ');
    const values = Object.keys(row).filter((k) => k !== 'id').map((k) => row[k] ?? null);
    await db.run(`UPDATE candidate_profiles SET ${sets} WHERE id = ?`, [...values, profileId]);
  } else {
    row.created_at = now;
    await insertRow('candidate_profiles', row);
  }

  for (const table of ['education', 'experiences', 'skills', 'certifications', 'projects']) {
    await db.run(`DELETE FROM ${table} WHERE profile_id = ?`, [profileId]);
  }

  for (const edu of profile.education) {
    await insertRow('education', {
      id: uid(), profile_id: profileId, degree: edu.degree, degree_level: edu.degreeLevel,
      specialization: edu.specialization, institution: edu.institution, graduation_year: edu.graduationYear,
      score: edu.score, score_type: edu.scoreType, verified_in_text: 1, created_at: now,
    });
  }
  for (const exp of profile.experience) {
    await insertRow('experiences', {
      id: uid(), profile_id: profileId, job_title: exp.jobTitle, company: exp.company,
      start_date: exp.startDate, end_date: exp.endDate, is_current: exp.isCurrent ? 1 : 0,
      duration_months: exp.durationMonths, responsibilities: exp.responsibilities,
      achievements: exp.achievements, domain: exp.domain, tools: JSON.stringify(exp.tools), created_at: now,
    });
  }
  for (const skill of profile.skills) {
    await insertRow('skills', {
      id: uid(), profile_id: profileId, name: skill.canonical, category: skill.category,
      proficiency: 'stated', source: 'resume', confidence: skill.confidence, created_at: now,
    });
  }
  for (const cert of profile.certifications) {
    await insertRow('certifications', {
      id: uid(), profile_id: profileId, name: cert.name, issuer: cert.issuer, year: cert.year,
      skills: JSON.stringify(cert.skills), created_at: now,
    });
  }
  for (const project of profile.projects) {
    await insertRow('projects', {
      id: uid(), profile_id: profileId, title: project.title, technologies: JSON.stringify(project.technologies),
      domain: project.domain, role: project.role, description: project.description,
      skills: JSON.stringify(project.skills), created_at: now,
    });
  }

  return profileId;
}

/** Reads the stored profile back into the in-memory shape the engines expect. */
export async function loadProfile(userId: string): Promise<CandidateProfileData | null> {
  const row = await db.one<any>('SELECT * FROM candidate_profiles WHERE user_id = ?', [userId]);
  if (!row) return null;

  const [education, experiences, skills, certifications, projects] = await Promise.all([
    db.query<any>('SELECT * FROM education WHERE profile_id = ? ORDER BY graduation_year DESC', [row.id]),
    db.query<any>('SELECT * FROM experiences WHERE profile_id = ? ORDER BY start_date DESC', [row.id]),
    db.query<any>('SELECT * FROM skills WHERE profile_id = ? ORDER BY confidence DESC', [row.id]),
    db.query<any>('SELECT * FROM certifications WHERE profile_id = ?', [row.id]),
    db.query<any>('SELECT * FROM projects WHERE profile_id = ?', [row.id]),
  ]);

  const asScored = (value: unknown): ScoredItem[] =>
    jsonList<any>(value).map((item) =>
      typeof item === 'string'
        ? { name: item, confidence: 0.5, source: 'inferred' as const }
        : { name: item.name, confidence: Number(item.confidence ?? 0.5), source: (item.source ?? 'inferred') as 'resume' | 'inferred', rationale: item.rationale },
    );

  return {
    personal: {
      name: row.full_name,
      professionalTitle: row.professional_title,
      careerObjective: row.career_objective,
      location: row.location,
      preferredLocations: jsonList<string>(row.preferred_locations),
      industry: row.industry,
      totalExperienceYears: num(row.total_experience_years),
      dateOfBirth: row.date_of_birth,
      ageYears: num(row.age_years),
      salaryExpectation: row.salary_expectation,
      contactFound: { email: false, phone: false },
    },
    education: education.map((e) => ({
      degree: e.degree,
      degreeLevel: e.degree_level,
      specialization: e.specialization ?? '',
      institution: e.institution ?? '',
      graduationYear: num(e.graduation_year),
      score: e.score,
      scoreType: e.score_type,
      raw: '',
    })),
    experience: experiences.map((e) => ({
      jobTitle: e.job_title,
      company: e.company ?? '',
      startDate: e.start_date,
      endDate: e.end_date,
      isCurrent: bool(e.is_current),
      durationMonths: num(e.duration_months),
      responsibilities: e.responsibilities ?? '',
      achievements: e.achievements ?? '',
      domain: e.domain ?? '',
      tools: jsonList<string>(e.tools),
      raw: '',
    })),
    skills: skills.map((s) => ({
      name: s.name,
      canonical: s.name,
      category: s.category,
      jobFamilies: [],
      confidence: Number(s.confidence ?? 0.8),
      source: 'resume' as const,
    })),
    certifications: certifications.map((c) => ({
      name: c.name,
      issuer: c.issuer ?? '',
      year: num(c.year),
      skills: jsonList<string>(c.skills),
    })),
    projects: projects.map((p) => ({
      title: p.title,
      technologies: jsonList<string>(p.technologies),
      domain: p.domain ?? '',
      role: p.role ?? '',
      description: p.description ?? '',
      skills: jsonList<string>(p.skills),
    })),
    careerLevel: { name: row.career_level ?? 'fresher', confidence: Number(jsonDecode<any>(row.confidence, {})?.careerLevel ?? 0.7), source: 'inferred' },
    jobFamilies: asScored(row.job_families),
    industries: asScored(row.industries),
    strongestSkills: jsonList<string>(row.strongest_skills),
    missingSkills: asScored(row.missing_skills),
    transferableSkills: asScored(row.transferable_skills),
    careerPaths: jsonList<any>(row.career_paths),
    governmentCategories: asScored(row.government_categories),
    examCategories: asScored(row.exam_categories),
    highestDegreeLevel: (education.map((e) => e.degree_level).filter(Boolean).sort((a, b) => rankOf(b) - rankOf(a))[0] ?? '') as CandidateProfileData['highestDegreeLevel'],
    fieldsOfStudy: [...new Set(education.map((e) => (e.specialization ?? '').toLowerCase()).filter(Boolean))],
    warnings: [],
  };
}

function rankOf(level: string): number {
  const order: Record<string, number> = { school: 1, diploma: 2, bachelor: 3, professional: 4, master: 5, doctorate: 6 };
  return order[level] ?? 0;
}

export async function readResumeFile(resumeId: string, userId: string): Promise<Buffer | null> {
  const row = await db.one<any>('SELECT storage_path, storage_encrypted FROM resumes WHERE id = ? AND user_id = ?', [resumeId, userId]);
  if (!row) return null;
  try {
    const buffer = await fs.readFile(path.join(UPLOAD_DIR, row.storage_path));
    return Buffer.from(decryptAtRest(new Uint8Array(buffer), bool(row.storage_encrypted)));
  } catch (error) {
    // Returning null makes the caller answer "not found", which would hide an operational fault
    // (a removed ENCRYPTION_KEY, a corrupted file) from everyone. Say so in the server log.
    console.error(`[resume] could not read stored file for resume ${resumeId}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Owner-only hard delete. Removes the file, the row, and everything that was DERIVED from that
 * resume — the profile built from it (education, experience, skills… cascade from it) and any
 * optimiser results — so no personal data outlives the document it came from.
 */
export async function deleteResume(resumeId: string, userId: string): Promise<boolean> {
  const row = await db.one<any>('SELECT storage_path FROM resumes WHERE id = ? AND user_id = ?', [resumeId, userId]);
  if (!row) return false;
  try {
    await fs.unlink(path.join(UPLOAD_DIR, row.storage_path));
  } catch {
    /* file may already be gone */
  }
  await db.run('DELETE FROM candidate_profiles WHERE resume_id = ? AND user_id = ?', [resumeId, userId]);
  await db.run('DELETE FROM resume_optimizations WHERE resume_id = ? AND user_id = ?', [resumeId, userId]);
  await db.run('DELETE FROM resumes WHERE id = ? AND user_id = ?', [resumeId, userId]);
  return true;
}

export { validateUpload };
