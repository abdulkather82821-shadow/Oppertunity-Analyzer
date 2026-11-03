import { getDriver, db, insertRow, nowIso, uid, resetDriver } from '../src/lib/db';
import { runMigrations } from '../src/lib/db/migrate';
import { hashPassword } from '../src/lib/auth/password';
import { canonicalKeyFor } from '../src/lib/opportunity/normalizer';
import { deriveStatus, describeDeadline, nextVerificationDate } from '../src/lib/opportunity/deadline';
import { assessTrust, tierForUrl, isOfficialDomain } from '../src/lib/opportunity/trust';
import { matchOpportunity, type MatchableRecord } from '../src/lib/opportunity/matcher';
import { verifyFromSources, type SourceClaim } from '../src/lib/opportunity/verification';
import { rankOpportunity } from '../src/lib/opportunity/ranker';
import { buildTimeline } from '../src/lib/pipeline/research-agent';
import {
  SEED_EXAMS,
  SEED_FEATURE_FLAGS,
  SEED_OPPORTUNITIES,
  SEED_PLATFORM_CONFIG,
  SEED_USERS,
  SEED_VERIFIED_AT,
  demoOpportunities,
  stableId,
  type SeedExam,
  type SeedOpportunity,
} from '../src/lib/db/seed-data';

const args = process.argv.slice(2);
const includeDemo = !args.includes('--no-demo');
const reset = args.includes('--reset');

/** A neutral commerce-graduate profile, used only to give seeded records a baseline score. */
function baselineProfile(): any {
  return {
    personal: {
      name: null, professionalTitle: null, careerObjective: null, location: null, preferredLocations: [],
      industry: null, totalExperienceYears: 0, dateOfBirth: null, ageYears: null, salaryExpectation: null,
      contactFound: { email: false, phone: false },
    },
    education: [{ degree: "Bachelor's Degree", degreeLevel: 'bachelor', specialization: 'Commerce', institution: '', graduationYear: null, score: null, scoreType: null, raw: '' }],
    experience: [], skills: [], certifications: [], projects: [],
    careerLevel: { name: 'fresher', confidence: 0.5, source: 'inferred' },
    jobFamilies: [], industries: [], strongestSkills: [], missingSkills: [], transferableSkills: [],
    careerPaths: [], governmentCategories: [], examCategories: [],
    highestDegreeLevel: 'bachelor', fieldsOfStudy: ['commerce', 'accounting', 'finance'], warnings: [],
    rawText: '', sections: {},
  };
}

async function main() {
  const driver = getDriver();
  await runMigrations(driver);
  console.log(`[seed] dialect=${driver.dialect}`);

  if (reset) {
    for (const table of [
      'analytics_events', 'audit_logs', 'security_logs', 'verification_runs', 'search_logs', 'search_jobs',
      'feedback', 'notifications', 'deadlines', 'applications', 'saved_opportunities', 'resume_optimizations',
      'opportunity_sources', 'government_exams', 'opportunities', 'sources', 'companies', 'organizations',
      'skills', 'projects', 'certifications', 'experiences', 'education', 'candidate_profiles', 'ai_analysis',
      'resumes', 'user_settings', 'sessions', 'users', 'platform_config', 'feature_flags', 'skill_taxonomy',
      'data_quality_issues',
    ]) {
      await db.run(`DELETE FROM ${table}`);
    }
    console.log('[seed] reset: existing data cleared');
  }

  const now = nowIso();
  const profile = baselineProfile();

  // --- users -----------------------------------------------------------------
  for (const seed of SEED_USERS) {
    const existing = await db.one<{ id: string }>('SELECT id FROM users WHERE email = ?', [seed.email]);
    const id = existing?.id ?? uid();
    const passwordHash = await hashPassword(seed.password);
    if (existing) {
      await db.run('UPDATE users SET role = ?, name = ?, updated_at = ? WHERE id = ?', [seed.role, seed.name, now, id]);
    } else {
      await insertRow('users', {
        id,
        email: seed.email,
        password_hash: passwordHash,
        name: seed.name,
        role: seed.role,
        status: 'active',
        email_verified: 1,
        auth_provider: 'password',
        mfa_required_for_role: ['admin', 'super_admin'].includes(seed.role) ? 1 : 0,
        created_at: now,
        updated_at: now,
      });
    }
    const settings = await db.one('SELECT user_id FROM user_settings WHERE user_id = ?', [id]);
    if (!settings) {
      await insertRow('user_settings', {
        user_id: id,
        preferred_locations: JSON.stringify(['Chennai', 'Tamil Nadu', 'India']),
        timezone: 'Asia/Kolkata',
        date_format: 'indian',
        updated_at: now,
      });
    }
    console.log(`[seed] user ${seed.email} (${seed.role})`);
  }

  // --- feature flags + platform config ---------------------------------------
  for (const flag of SEED_FEATURE_FLAGS) {
    const enabled = flag.key === 'demo_data' ? (includeDemo ? 1 : 0) : flag.enabled;
    const existing = await db.one('SELECT key FROM feature_flags WHERE key = ?', [flag.key]);
    if (existing) await db.run('UPDATE feature_flags SET enabled = ?, description = ?, updated_at = ? WHERE key = ?', [enabled, flag.description, now, flag.key]);
    else await insertRow('feature_flags', { key: flag.key, enabled, description: flag.description, updated_at: now });
  }
  for (const entry of SEED_PLATFORM_CONFIG) {
    const existing = await db.one('SELECT key FROM platform_config WHERE key = ?', [entry.key]);
    if (!existing) {
      await insertRow('platform_config', {
        key: entry.key, value: entry.value, category: entry.category, description: entry.description, updated_at: now,
      });
    }
  }

  // --- sources ---------------------------------------------------------------
  const sourceUrls = new Set<string>();
  for (const exam of SEED_EXAMS) for (const url of exam.sourceUrls) sourceUrls.add(url);
  for (const opp of SEED_OPPORTUNITIES) for (const url of opp.sourceUrls) sourceUrls.add(url);
  for (const url of sourceUrls) await upsertSource(url, SEED_VERIFIED_AT);
  console.log(`[seed] ${sourceUrls.size} sources registered`);

  // --- government exams ------------------------------------------------------
  for (const exam of SEED_EXAMS) await seedExam(exam, profile);
  console.log(`[seed] ${SEED_EXAMS.length} government exams`);

  // --- opportunities ----------------------------------------------------------
  let oppCount = 0;
  for (const opp of SEED_OPPORTUNITIES) {
    await seedOpportunity(opp, profile);
    oppCount += 1;
  }
  if (includeDemo) {
    for (const opp of demoOpportunities()) {
      await seedOpportunity(opp, profile);
      oppCount += 1;
    }
    console.log(`[seed] ${oppCount} opportunities (including demonstration listings)`);
  } else {
    console.log(`[seed] ${oppCount} opportunities (demonstration listings skipped)`);
  }

  // --- data-quality backlog for the analyst role -------------------------------
  const conflicting = await db.query('SELECT id, title FROM opportunities WHERE verification_status = ? LIMIT 20', ['conflicting']);
  for (const row of conflicting as any[]) {
    const existing = await db.one(
      'SELECT id FROM data_quality_issues WHERE opportunity_id = ? AND kind = ? AND resolved = 0',
      [row.id, 'conflict'],
    );
    if (!existing) {
      await insertRow('data_quality_issues', {
        id: uid(),
        kind: 'conflict',
        opportunity_id: row.id,
        detail: `Conflicting source data for "${row.title}" — reconcile against the official notification.`,
        severity: 'warning',
        resolved: 0,
        created_at: now,
      });
    }
  }
  console.log(`[seed] ${conflicting.length} conflict records queued for the analyst panel`);

  console.log('\n[seed] done. Sign-in accounts:');
  for (const user of SEED_USERS) console.log(`  ${user.email}  /  ${user.password}`);
  console.log('\nChange these passwords before deploying anywhere public.\n');

  await resetDriver();
}

async function upsertSource(url: string, checkedAt: string): Promise<void> {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return;
  }
  const official = isOfficialDomain(host);
  const tier = tierForUrl(url);
  const trust = official.official ? 92 : tier === 2 ? 70 : tier === 3 ? 55 : 38;
  const existing = await db.one('SELECT id FROM sources WHERE url = ?', [url]);
  if (existing) return;
  await insertRow('sources', {
    id: uid(),
    url,
    domain: host,
    name: official.name ?? host,
    tier,
    source_type: official.official ? 'official' : tier <= 3 ? 'secondary' : 'aggregator',
    is_government: official.official ? 1 : 0,
    trust_score: trust,
    robots_checked: 0,
    robots_allows: 1,
    last_checked: checkedAt,
    created_at: checkedAt,
    updated_at: checkedAt,
  });
}

async function seedExam(exam: SeedExam, profile: any): Promise<void> {
  const id = stableId('exam', exam.key);
  const canonicalKey = canonicalKeyFor({
    title: exam.examName,
    organization: exam.organization,
    category: 'exam',
    deadline: exam.applicationDeadline,
  });

  const status = deriveStatus({
    applicationStart: exam.applicationStart,
    applicationDeadline: exam.applicationDeadline,
    examDate: exam.examDate,
    admitCardDate: exam.admitCardDate,
    notificationDate: exam.notificationDate,
    resultStatus: exam.resultStatus,
    conflicts: exam.conflictFlags.map((c) => c.field),
  });

  const matchable: MatchableRecord = {
    id,
    title: exam.examName,
    organization: exam.organization,
    type: 'exam',
    category: exam.category,
    locations: ['Pan India'],
    qualification: exam.qualification,
    degreeLevels: exam.degreeLevels,
    fieldsOfStudy: exam.fieldsOfStudy,
    skills: [],
    experienceMinYears: exam.experienceMinYears,
    ageMin: exam.ageMin,
    ageMax: exam.ageMax,
    experienceRequired: exam.experienceRequired,
    applicationDeadline: exam.applicationDeadline,
    status,
    isGovernment: true,
  };
  const match = matchOpportunity(profile, matchable, {});
  const trust = assessTrust({
    title: exam.examName,
    organization: exam.organization,
    officialSource: exam.officialNotification,
    applicationUrl: exam.officialApplication,
    sourceUrls: exam.sourceUrls,
    description: exam.notes,
    isGovernment: true,
    duplicateCount: exam.sourceUrls.length,
  });

  const claims: SourceClaim[] = exam.sourceUrls.map((url) => ({
    url,
    tier: tierForUrl(url),
    isOfficial: isOfficialDomain(url).official,
    sourceDate: SEED_VERIFIED_AT,
    claims: {
      'application deadline': exam.applicationDeadline ? exam.applicationDeadline.slice(0, 10) : '',
      'application start': exam.applicationStart ? exam.applicationStart.slice(0, 10) : '',
      'exam date': exam.examDate ? exam.examDate.slice(0, 10) : '',
      vacancies: exam.vacancies != null ? String(exam.vacancies) : '',
      'age limit': exam.ageMin != null || exam.ageMax != null ? `${exam.ageMin ?? '—'}-${exam.ageMax ?? '—'}` : '',
    },
  }));

  // Attach the disagreement each secondary source actually reported. These values were
  // collected from those pages, so the verification engine is comparing real assertions
  // rather than a copy of the canonical record.
  for (const conflict of exam.conflictFlags) {
    for (const value of conflict.values) {
      const target = claims.find((claim) => claim.url === value.url);
      if (!target) continue;
      target.claims[conflict.field] = value.value;
    }
  }
  const verification = verifyFromSources(claims);
  const conflictFlags = JSON.stringify(verification.conflicts.map((c) => ({ field: c.field, values: c.values })));
  const nextVerification = nextVerificationDate(exam.applicationDeadline, SEED_VERIFIED_AT);

  const existingOpp = await db.one<{ id: string }>('SELECT id FROM opportunities WHERE canonical_key = ?', [canonicalKey]);
  const opportunityId = existingOpp?.id ?? uid();
  const deadlineInfo = describeDeadline(exam.applicationDeadline, exam.applicationStart);

  // Score with the same ranker the live pipeline uses, so a seeded record and a searched
  // record are comparable. `Math.max(match, trust)` would let a fully-trusted official
  // source mask a poor fit and display as a "Perfect Match".
  const examRanking = rankOpportunity({
    id: opportunityId,
    match,
    trustScore: trust.score,
    verificationStatus: verification.outcome,
    qualityScore: 78,
    applicationDeadline: exam.applicationDeadline,
    applicationStart: exam.applicationStart,
    status,
    duplicateCount: exam.sourceUrls.length,
    hasOfficialSource: Boolean(trust.officialDomain),
  });

  await db.run('DELETE FROM opportunities WHERE canonical_key = ?', [canonicalKey]);
  await insertRow('opportunities', {
    id: opportunityId,
    canonical_key: canonicalKey,
    title: exam.examName,
    organization: exam.organization,
    type: 'exam',
    category: exam.category,
    locations: JSON.stringify(['Pan India']),
    work_mode: 'onsite',
    employment_type: 'full_time',
    description: `${exam.post}\n\n${exam.notes}`,
    qualification: JSON.stringify(exam.qualification),
    degree_levels: JSON.stringify(exam.degreeLevels),
    fields_of_study: JSON.stringify(exam.fieldsOfStudy),
    skills: JSON.stringify([]),
    experience_required: exam.experienceRequired,
    experience_min_years: exam.experienceMinYears,
    is_fresher_friendly: (exam.experienceMinYears ?? 0) === 0 ? 1 : 0,
    salary: '',
    vacancies: exam.vacancies,
    age_min: exam.ageMin,
    age_max: exam.ageMax,
    nationality: 'Indian citizens unless the notification states otherwise',
    eligibility: exam.eligibility,
    application_start: exam.applicationStart,
    application_deadline: exam.applicationDeadline,
    exam_date: exam.examDate,
    status,
    match_score: match.overall,
    trust_score: trust.score,
    quality_score: 78,
    final_score: examRanking.finalScore,
    official_source: exam.officialNotification,
    application_url: exam.officialApplication,
    source_urls: JSON.stringify(exam.sourceUrls),
    duplicate_group: canonicalKey,
    duplicate_count: exam.sourceUrls.length,
    conflict_flags: conflictFlags,
    verification_status: verification.outcome,
    source_type: trust.officialDomain ? 'official' : trust.tier <= 2 ? 'secondary' : 'aggregator',
    source_tier: trust.tier,
    last_verified: SEED_VERIFIED_AT,
    next_verification: nextVerification,
    first_discovered: SEED_VERIFIED_AT,
    is_demo: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  await db.run('DELETE FROM opportunity_sources WHERE opportunity_id = ?', [opportunityId]);
  for (const claim of claims) {
    await insertRow('opportunity_sources', {
      id: uid(),
      opportunity_id: opportunityId,
      url: claim.url,
      title: exam.examName,
      snippet: exam.notes.slice(0, 400),
      tier: claim.tier,
      claims: JSON.stringify(claim.claims),
      retrieved_at: SEED_VERIFIED_AT,
      source_date: SEED_VERIFIED_AT,
    });
  }

  const timeline = buildTimeline({
    title: exam.examName,
    applicationStart: exam.applicationStart,
    applicationDeadline: exam.applicationDeadline,
    examDate: exam.examDate,
    sourceDate: exam.notificationDate,
  } as any);

  await db.run('DELETE FROM government_exams WHERE id = ?', [id]);
  await insertRow('government_exams', {
    id,
    opportunity_id: opportunityId,
    exam_name: exam.examName,
    exam_code: exam.notificationNumber,
    organization: exam.organization,
    organization_type: exam.organizationType,
    category: exam.category,
    post: exam.post,
    qualification: JSON.stringify(exam.qualification),
    degree_levels: JSON.stringify(exam.degreeLevels),
    fields_of_study: JSON.stringify(exam.fieldsOfStudy),
    age_min: exam.ageMin,
    age_max: exam.ageMax,
    age_relaxation: exam.ageRelaxation,
    experience_required: exam.experienceRequired,
    experience_min_years: exam.experienceMinYears,
    nationality: 'Indian citizens unless the notification states otherwise',
    vacancies: exam.vacancies,
    application_fee: exam.applicationFee,
    notification_number: exam.notificationNumber,
    notification_date: exam.notificationDate,
    application_start: exam.applicationStart,
    application_deadline: exam.applicationDeadline,
    fee_deadline: exam.feeDeadline,
    correction_start: exam.correctionStart,
    correction_end: exam.correctionEnd,
    admit_card_date: exam.admitCardDate,
    exam_date: exam.examDate,
    exam_end_date: exam.examEndDate,
    answer_key_status: exam.answerKeyStatus,
    result_status: exam.resultStatus,
    interview_status: 'not_started',
    final_result_status: 'not_declared',
    status,
    timeline: JSON.stringify(timeline),
    eligibility: exam.eligibility,
    eligibility_rules: JSON.stringify({}),
    official_notification: exam.officialNotification,
    official_application: exam.officialApplication,
    official_website: exam.officialWebsite,
    conflict_flags: conflictFlags,
    verification_status: verification.outcome,
    trust_score: trust.score,
    last_verified: SEED_VERIFIED_AT,
    next_verification: nextVerification,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  console.log(
    `[seed]   exam ${exam.examName.slice(0, 58).padEnd(58)} ${status.padEnd(22)}` +
      `${deadlineInfo.daysRemaining !== null ? `${deadlineInfo.daysRemaining}d` : '—'}`,
  );
}

async function seedOpportunity(opp: SeedOpportunity, profile: any): Promise<void> {
  const canonicalKey = canonicalKeyFor({
    title: opp.title,
    organization: opp.organization,
    category: opp.type,
    deadline: opp.applicationDeadline,
  });
  const status = deriveStatus({
    applicationStart: opp.applicationStart,
    applicationDeadline: opp.applicationDeadline,
  });
  const matchable: MatchableRecord = {
    id: canonicalKey,
    title: opp.title,
    organization: opp.organization,
    type: opp.type,
    category: opp.category,
    jobFamily: opp.jobFamily,
    locations: opp.locations,
    workMode: opp.workMode,
    qualification: opp.qualification,
    degreeLevels: opp.degreeLevels,
    fieldsOfStudy: opp.fieldsOfStudy,
    skills: opp.skills,
    experienceMinYears: opp.experienceMinYears,
    applicationDeadline: opp.applicationDeadline,
    status,
    isGovernment: opp.isGovernment,
  };
  const match = matchOpportunity(profile, matchable, {});
  const trust = assessTrust({
    title: opp.title,
    organization: opp.organization,
    officialSource: opp.officialSource,
    applicationUrl: opp.applicationUrl,
    sourceUrls: opp.sourceUrls,
    description: opp.description,
    salary: opp.salary,
    isGovernment: opp.isGovernment,
  });
  const verificationStatus = opp.verificationStatus === 'suspicious' ? 'suspicious' : trust.label === 'verified' ? 'verified' : 'needs_verification';

  const existing = await db.one<{ id: string }>('SELECT id FROM opportunities WHERE canonical_key = ?', [canonicalKey]);
  const id = existing?.id ?? uid();
  const now = nowIso();

  const oppRanking = rankOpportunity({
    id,
    match,
    trustScore: trust.score,
    verificationStatus,
    qualityScore: 70,
    applicationDeadline: opp.applicationDeadline,
    applicationStart: opp.applicationStart,
    status,
    duplicateCount: opp.sourceUrls.length,
    hasOfficialSource: Boolean(trust.officialDomain),
  });

  await db.run('DELETE FROM opportunities WHERE canonical_key = ?', [canonicalKey]);
  await insertRow('opportunities', {
    id,
    canonical_key: canonicalKey,
    title: opp.title,
    organization: opp.organization,
    type: opp.type,
    category: opp.category,
    job_family: opp.jobFamily,
    locations: JSON.stringify(opp.locations),
    work_mode: opp.workMode,
    employment_type: opp.employmentType,
    description: `${opp.description}\n\n${opp.notes}`,
    qualification: JSON.stringify(opp.qualification),
    degree_levels: JSON.stringify(opp.degreeLevels),
    fields_of_study: JSON.stringify(opp.fieldsOfStudy),
    skills: JSON.stringify(opp.skills),
    experience_required: opp.experienceRequired,
    experience_min_years: opp.experienceMinYears,
    is_fresher_friendly: (opp.experienceMinYears ?? 0) === 0 ? 1 : 0,
    salary: opp.salary,
    vacancies: opp.vacancies,
    application_start: opp.applicationStart,
    application_deadline: opp.applicationDeadline,
    status,
    match_score: match.overall,
    trust_score: trust.score,
    quality_score: opp.isDemo ? 20 : 62,
    final_score: oppRanking.finalScore,
    official_source: opp.officialSource,
    application_url: opp.applicationUrl,
    source_urls: JSON.stringify(opp.sourceUrls),
    duplicate_group: canonicalKey,
    duplicate_count: Math.max(1, opp.sourceUrls.length),
    verification_status: verificationStatus,
    source_type: trust.officialDomain ? 'official' : trust.tier <= 2 ? 'secondary' : 'aggregator',
    source_tier: trust.tier,
    last_verified: SEED_VERIFIED_AT,
    next_verification: nextVerificationDate(opp.applicationDeadline, SEED_VERIFIED_AT),
    first_discovered: SEED_VERIFIED_AT,
    is_demo: opp.isDemo ? 1 : 0,
    created_at: now,
    updated_at: now,
  });

  await db.run('DELETE FROM opportunity_sources WHERE opportunity_id = ?', [id]);
  for (const url of opp.sourceUrls) {
    await insertRow('opportunity_sources', {
      id: uid(),
      opportunity_id: id,
      url,
      title: opp.title,
      snippet: opp.description.slice(0, 400),
      tier: tierForUrl(url),
      claims: JSON.stringify({ 'application deadline': opp.applicationDeadline ? opp.applicationDeadline.slice(0, 10) : '' }),
      retrieved_at: SEED_VERIFIED_AT,
      source_date: SEED_VERIFIED_AT,
    });
  }
  console.log(`[seed]   opp  ${opp.title.slice(0, 58).padEnd(58)} ${status.padEnd(22)}${opp.isDemo ? '[demo]' : ''}`);
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
