import { db, bool, jsonDecode, jsonList, num } from '@/lib/db';
import { describeDeadline, deriveStatus, STATUS_META, URGENCY_META, type ExamStatus } from '@/lib/opportunity/deadline';
import { bandFor, BAND_META, ELIGIBILITY_META, type MatchableRecord } from '@/lib/opportunity/matcher';
import { scoreForUser, type ScoringContext } from '@/lib/opportunity/personal';
import { composeExplanation } from '@/lib/opportunity/explainer';
import { tierForUrl, isOfficialDomain } from '@/lib/opportunity/trust';
import type { CandidateProfileData } from '@/lib/analysis/profiler';

/**
 * Turns raw database rows into the exact view-model the UI renders.
 *
 * Everything the pages show — match score, eligibility verdict, deadline wording, source
 * trust, the nine-stage exam timeline — is computed here, once, from the same functions the
 * pipeline uses. Nothing is invented: unknown values stay `null` and render as "Unknown".
 */

const STAGE_DEFS: { stage: string; label: string; hint: string }[] = [
  { stage: 'notification', label: 'Notification', hint: 'notification' },
  { stage: 'application_start', label: 'Application Opens', hint: 'applicationStart' },
  { stage: 'application_deadline', label: 'Application Closes', hint: 'applicationDeadline' },
  { stage: 'admit_card', label: 'Admit Card', hint: 'admitCardDate' },
  { stage: 'exam', label: 'Examination', hint: 'examDate' },
  { stage: 'answer_key', label: 'Answer Key', hint: 'answerKeyDate' },
  { stage: 'result', label: 'Result', hint: 'resultDate' },
  { stage: 'interview', label: 'Interview / DV', hint: 'interviewDate' },
  { stage: 'final_result', label: 'Final Selection', hint: 'finalResultDate' },
];

export interface TimelineStage {
  stage: string;
  label: string;
  date: string | null;
  state: 'completed' | 'current' | 'upcoming' | 'unknown';
}

/**
 * Nine-stage exam timeline. Stages with no published date are reported as `unknown` rather
 * than guessed, and only the first future stage is marked `current`.
 */
export function buildExamTimeline(dates: Record<string, string | null | undefined>): { timeline: TimelineStage[]; currentStage: number; stageLabel: string } {
  const now = Date.now();
  let seenFuture = false;
  const timeline: TimelineStage[] = STAGE_DEFS.map((definition) => {
    const raw = dates[definition.hint] ?? null;
    if (!raw) return { stage: definition.stage, label: definition.label, date: null, state: 'unknown' as const };
    const time = new Date(raw).getTime();
    if (Number.isNaN(time)) return { stage: definition.stage, label: definition.label, date: null, state: 'unknown' as const };
    if (time < now) return { stage: definition.stage, label: definition.label, date: raw, state: 'completed' as const };
    if (!seenFuture) {
      seenFuture = true;
      return { stage: definition.stage, label: definition.label, date: raw, state: 'current' as const };
    }
    return { stage: definition.stage, label: definition.label, date: raw, state: 'upcoming' as const };
  });
  const currentIndex = timeline.findIndex((entry) => entry.state === 'current');
  const resolved = currentIndex >= 0 ? currentIndex : timeline.filter((entry) => entry.state === 'completed').length;
  const currentStage = Math.min(9, Math.max(1, resolved + (currentIndex >= 0 ? 1 : 0)));
  return { timeline, currentStage, stageLabel: timeline[currentStage - 1]?.label ?? 'Unknown' };
}

export function toMatchable(row: any): MatchableRecord {
  return {
    id: row.id,
    title: row.title,
    organization: row.organization,
    type: row.type,
    category: row.category,
    jobFamily: row.job_family,
    locations: jsonList<string>(row.locations),
    workMode: row.work_mode,
    qualification: jsonList<string>(row.qualification),
    degreeLevels: jsonList<string>(row.degree_levels),
    fieldsOfStudy: jsonList<string>(row.fields_of_study),
    skills: jsonList<string>(row.skills),
    experienceMinYears: row.experience_min_years,
    experienceMaxYears: row.experience_max_years,
    isFresherFriendly: Boolean(row.is_fresher_friendly),
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    ageMin: row.age_min,
    ageMax: row.age_max,
    experienceRequired: row.experience_required,
    nationality: row.nationality,
    applicationDeadline: row.application_deadline,
    status: row.status,
    isGovernment: ['government_job', 'exam'].includes(row.type),
  };
}

const SOURCE_KINDS = ['official', 'secondary', 'aggregator', 'social'] as const;

function sourceKindFor(row: any): string {
  if (row.source_type && (SOURCE_KINDS as readonly string[]).includes(row.source_type)) return row.source_type;
  const url = row.official_source || row.application_url || '';
  const official = isOfficialDomain(url);
  if (official.official) return 'official';
  const tier = tierForUrl(url);
  return tier === 1 ? 'official' : tier === 2 ? 'secondary' : 'aggregator';
}

/** Conflict flags are stored as JSON; normalise them to the shape the banner renders. */
export function normaliseConflicts(input: unknown): { field: string; value: string; url: string; isOfficial: boolean }[] {
  const list = typeof input === 'string' ? jsonDecode<any[]>(input, []) : Array.isArray(input) ? input : [];
  const out: { field: string; value: string; url: string; isOfficial: boolean }[] = [];
  for (const entry of list) {
    if (!entry) continue;
    const values = Array.isArray(entry.values) ? entry.values : [entry];
    for (const value of values) {
      const url = String(value.url ?? value.source ?? entry.url ?? '');
      out.push({
        field: String(value.field ?? entry.field ?? 'field'),
        value: String(value.value ?? 'Unknown'),
        url,
        isOfficial: url ? isOfficialDomain(url).official : false,
      });
    }
  }
  return out;
}

/**
 * Full opportunity view-model. When a profile is supplied the score, eligibility verdict and
 * "why this job" explanation are recomputed live for that user; without one the stored
 * aggregate values are used so anonymous browsing still works.
 */
export function enrichOpportunity(row: any, profile?: CandidateProfileData | null, context?: Partial<ScoringContext> | null) {
  const deadline = describeDeadline(row.application_deadline, row.application_start);
  const isGovernment = ['government_job', 'exam'].includes(row.type);
  const statusKey = (row.status ?? 'needs_verification') as ExamStatus;
  const official = isOfficialDomain(row.official_source || row.application_url || '');
  const kind = sourceKindFor(row);
  const conflicts = normaliseConflicts(row.conflict_flags);

  let matchScore = Math.round(Number(row.match_score ?? 0));
  let finalScore = Math.round(Number(row.final_score ?? matchScore));
  let eligibilityStatus = row.eligibility_status ?? 'unknown';
  let eligibilityReason = row.eligibility_reason ?? '';
  let explanation = row.explanation ?? '';
  let strengths: string[] = jsonList<string>(row.match_strengths);
  let gaps: string[] = jsonList<string>(row.match_gaps);
  let scoreBreakdown: { key: string; label: string; score: number; contribution: number; evidence: string }[] = [];

  if (profile) {
    const matchable = toMatchable(row);
    // Everything personal is computed here from the viewer's own profile, weights, locations
    // and feedback. The stored score columns on the shared row belong to whoever wrote them
    // last, so they are deliberately not used once a profile is available.
    const personal = scoreForUser(row, matchable, profile, context);
    const { eligibility, match } = personal;
    const composed = composeExplanation(profile, matchable, match);
    matchScore = Math.round(match.overall);
    finalScore = personal.finalScore;
    eligibilityStatus = eligibility.verdict;
    eligibilityReason = eligibility.blockers.length
      ? eligibility.blockers.join('; ')
      : eligibility.assumptions.length
        ? eligibility.assumptions.join('; ')
        : eligibility.reasons.join('; ');
    explanation = composed.summary;
    strengths = composed.strengths;
    gaps = composed.gaps;
    // Breakdown components are already 0-100. Weight keys do not match breakdown keys
    // one-to-one (the education dimension is weighted by `qualification`), and the
    // government model uses its own fixed weights, so map explicitly.
    const weights = (match.weights ?? {}) as Record<string, number>;
    const GOV_WEIGHTS: Record<string, number> = {
      education: 28, experience: 18, skill: 17, location: 9, role: 16, industry: 6, careerGrowth: 6,
    };
    const WEIGHT_KEY: Record<string, string> = { education: 'qualification' };
    const LABELS: Record<string, string> = {
      education: 'Education', skill: 'Skill match', experience: 'Experience', location: 'Location',
      role: 'Role relevance', industry: 'Industry', eligibility: 'Eligibility',
      salary: 'Salary', careerGrowth: 'Career growth',
    };
    scoreBreakdown = Object.entries(match.breakdown ?? {}).map(([key, value]) => {
      const score = Math.round(Number(value));
      const weight =
        match.model === 'government'
          ? (GOV_WEIGHTS[key] ?? 0)
          : Number(weights[WEIGHT_KEY[key] ?? key] ?? 0);
      return {
        key,
        label: LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
        score,
        contribution: Number(((score * weight) / 100).toFixed(1)),
        evidence: match.model === 'government'
          ? `${score}% of the ${weight}pt ${key} weight (government eligibility model)`
          : `${score}% of the ${weight}pt ${key} weight`,
      };
    });
    void bandFor;
  }

  const bandKey = bandForScore(finalScore, eligibilityStatus);
  const band = BAND_META[(bandKey === 'skill_gap' ? 'gap' : bandKey) as keyof typeof BAND_META] ?? BAND_META.possible;
  const examStatus = row.exam_status ?? (isGovernment ? deriveStatus({
    applicationStart: row.application_start,
    applicationDeadline: row.application_deadline,
    examDate: row.exam_date,
    admitCardDate: row.admit_card_date,
    resultStatus: row.result_status,
  }) : null);

  return {
    id: row.id,
    title: row.title,
    organization: row.organization ?? '',
    type: row.type,
    category: row.category ?? '',
    jobFamily: row.job_family ?? null,
    description: row.description ?? '',
    locations: jsonList<string>(row.locations),
    locationSummary: jsonList<string>(row.locations).join(', ') || 'Unknown',
    workMode: row.work_mode,
    status: row.status,
    statusLabel: STATUS_META[statusKey]?.label ?? row.status,

    matchScore,
    finalScore,
    /** False when no profile was available, in which case scores are catalogue baselines. */
    personalised: Boolean(profile),
    band: bandKey,
    bandLabel: band.label,
    scoreBreakdown,

    eligibilityStatus,
    eligibilityReason,
    explanation,
    strengths,
    gaps,

    deadlineDays: deadline.daysRemaining,
    deadlineLabel: deadline.urgencyLabel,
    deadlineCta: deadline.cta,
    deadlineFormatted: deadline.formatted,
    deadlineUrgency: deadline.urgency,
    deadlineTone: URGENCY_META[deadline.urgency].tone,
    isClosed: deadline.isClosed,

    applicationStart: row.application_start ?? null,
    applicationDeadline: row.application_deadline ?? null,
    examDate: row.exam_date ?? null,
    resultDate: row.result_date ?? null,
    admitCardDate: row.admit_card_date ?? null,

    qualification: jsonList<string>(row.qualification),
    skills: jsonList<string>(row.skills),
    fieldsOfStudy: jsonList<string>(row.fields_of_study),
    experienceLevel: row.experience_required || 'Unknown',
    experienceMinYears: num(row.experience_min_years),
    isFresherFriendly: bool(row.is_fresher_friendly),
    vacancies: num(row.vacancies),
    ageMin: num(row.age_min),
    ageMax: num(row.age_max),
    salaryMin: num(row.salary_min),
    salaryMax: num(row.salary_max),
    salaryPeriod: row.salary_period ?? null,
    salary: row.salary || 'Unknown',
    applicationFee: row.application_fee ?? null,
    selectionProcess: jsonList<string>(row.selection_process),
    nationality: row.nationality ?? null,

    verificationStatus: row.verification_status ?? 'needs_verification',
    trustScore: Math.round(Number(row.trust_score ?? 0)),
    officialSource: row.official_source || null,
    applyUrl: row.application_url || null,
    applicationUrl: row.application_url || null,
    officialNotification: row.official_notification || null,
    sourceKind: kind,
    sourceTier: num(row.source_tier),
    sourceCount: Number(row.duplicate_count ?? 1),
    duplicateCount: Number(row.duplicate_count ?? 1),
    conflicts,

    isGovernment,
    examStatus,
    isDemo: bool(row.is_demo),
    isSaved: bool(row.is_saved),
    saved: bool(row.is_saved),
    lastCheckedAt: row.last_verified ?? null,
    lastVerified: row.last_verified ?? null,
    nextVerification: row.next_verification ?? null,
    firstDiscovered: row.first_discovered ?? null,
    officialDomainName: official.name,
  };
}

export function bandForScore(score: number, eligibility?: string): 'perfect' | 'strong' | 'good' | 'possible' | 'skill_gap' | 'not_eligible' {
  if (eligibility === 'not_eligible') return 'not_eligible';
  if (score >= 90) return 'perfect';
  if (score >= 80) return 'strong';
  if (score >= 65) return 'good';
  if (score >= 45) return 'possible';
  return 'skill_gap';
}

const BAND_LABELS: Record<string, string> = {
  perfect: '🏆 Perfect',
  strong: '🔥 Strong',
  good: '👍 Good',
  possible: '📌 Possible',
  skill_gap: '⚠️ Skill Gap',
  not_eligible: '❌ Not Eligible',
};

export function bandLabel(key: string): string {
  return BAND_LABELS[key] ?? key;
}

/** Full examination view-model, including the nine-stage timeline. */
export function enrichExam(row: any, opportunity?: any) {
  const deadline = describeDeadline(row.application_deadline, row.application_start);
  const { timeline, currentStage, stageLabel } = buildExamTimeline({
    notification: row.notification_date,
    applicationStart: row.application_start,
    applicationDeadline: row.application_deadline,
    admitCardDate: row.admit_card_date,
    examDate: row.exam_date,
    answerKeyDate: row.answer_key_date,
    resultDate: row.result_date,
    interviewDate: row.interview_date,
    finalResultDate: row.final_result_date,
  });
  const statusKey = (row.status ?? 'needs_verification') as ExamStatus;

  return {
    id: row.id,
    opportunityId: row.opportunity_id,
    name: row.exam_name,
    examName: row.exam_name,
    examCode: row.exam_code ?? null,
    organization: row.organization ?? '',
    organizationType: row.organization_type ?? null,
    category: row.category ?? '',
    post: row.post ?? null,
    posts: jsonList<string>(row.posts),
    status: row.status,
    statusLabel: STATUS_META[statusKey]?.label ?? row.status,

    qualification: jsonList<string>(row.qualification),
    degreeLevels: jsonList<string>(row.degree_levels),
    fieldsOfStudy: jsonList<string>(row.fields_of_study),
    ageMin: num(row.age_min),
    ageMax: num(row.age_max),
    ageRelaxation: row.age_relaxation ?? null,
    experienceRequired: row.experience_required ?? 'Unknown',
    nationality: row.nationality ?? 'Unknown',
    vacancies: num(row.vacancies),
    fee: row.application_fee ?? null,
    applicationFee: row.application_fee ?? null,
    payScale: row.pay_scale ?? null,
    examMode: row.exam_mode ?? null,
    eligibilityDetails: row.eligibility_details ?? null,
    eligibilityRules: jsonDecode(row.eligibility_rules, {}),
    syllabus: row.syllabus ?? null,

    notificationNumber: row.notification_number ?? null,
    notificationDate: row.notification_date ?? null,
    applicationStart: row.application_start ?? null,
    applicationDeadline: row.application_deadline ?? null,
    feeDeadline: row.fee_deadline ?? null,
    correctionWindow: row.correction_start && row.correction_end ? `${new Date(row.correction_start).toLocaleDateString('en-IN')} – ${new Date(row.correction_end).toLocaleDateString('en-IN')}` : null,
    admitCardDate: row.admit_card_date ?? null,
    examDate: row.exam_date ?? null,
    examEndDate: row.exam_end_date ?? null,
    answerKeyStatus: row.answer_key_status ?? null,
    resultDate: row.result_date ?? null,
    resultStatus: row.result_status ?? null,
    interviewStatus: row.interview_status ?? null,
    finalResultStatus: row.final_result_status ?? null,

    daysRemaining: deadline.daysRemaining,
    deadlineLabel: deadline.urgencyLabel,
    deadlineCta: deadline.cta,
    deadlineFormatted: deadline.formatted,
    deadlineUrgency: deadline.urgency,

    officialNotification: row.official_notification ?? null,
    officialApplication: row.official_application ?? null,
    officialWebsite: row.official_website ?? null,
    verificationStatus: row.verification_status ?? 'needs_verification',
    trustScore: Math.round(Number(row.trust_score ?? 0)),
    conflicts: normaliseConflicts(row.conflict_flags),

    currentStage,
    stageLabel,
    timeline,
    lastCheckedAt: row.last_verified ?? null,
    nextVerification: row.next_verification ?? null,
    isSaved: bool(row.is_saved),
    eligibilityStatus: opportunity?.eligibility_status ?? null,
    eligibilityReason: opportunity?.eligibility_reason ?? null,
  };
}

/** Upper bound on rows scored live per request; keeps personal ranking predictable in cost. */
export const LIVE_SCORING_WINDOW = 400;

/**
 * Aggregate counts for the dashboard summary strip.
 *
 * "Perfect matches" is personal, so it is counted from live per-user scores over the active
 * catalogue rather than from a stored column that another user's search could have written.
 * Everything else is a catalogue-wide fact and stays a plain SQL count.
 */
export async function dashboardSummary(userId: string, profile?: CandidateProfileData | null, context?: Partial<ScoringContext> | null) {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const [government, exams, closingSoon, saved, suspicious, conflicting, total] = await Promise.all([
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND type IN ('government_job','exam')`),
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM government_exams WHERE is_active = 1`),
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND application_deadline IS NOT NULL AND application_deadline >= ? AND application_deadline <= ?`, [now.toISOString(), soon]),
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM saved_opportunities WHERE user_id = ?`, [userId]),
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND verification_status = 'suspicious'`),
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1 AND verification_status = 'conflicting'`),
    db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities WHERE is_active = 1`),
  ]);

  // Without a profile there is no "match" to count, so the honest value is zero.
  let perfect = 0;
  if (profile) {
    const rows = await db.query<any>(
      `SELECT * FROM opportunities WHERE is_active = 1 ORDER BY final_score DESC LIMIT ?`,
      [LIVE_SCORING_WINDOW],
    );
    for (const row of rows) {
      const view = enrichOpportunity(row, profile, context);
      if (view.band === 'perfect' && !view.isClosed) perfect += 1;
    }
  }

  return {
    perfect,
    government: Number(government?.n ?? 0),
    exams: Number(exams?.n ?? 0),
    closingSoon: Number(closingSoon?.n ?? 0),
    saved: Number(saved?.n ?? 0),
    suspicious: Number(suspicious?.n ?? 0),
    conflicting: Number(conflicting?.n ?? 0),
    total: Number(total?.n ?? 0),
  };
}

/** Source records for an opportunity, normalised for the transparency panel. */
export async function sourcesFor(opportunityId: string) {
  const rows = await db.query<any>(
    `SELECT os.url, os.title, os.snippet, os.claims, os.retrieved_at, os.source_date,
            s.tier, s.source_type, s.name, s.is_government
       FROM opportunity_sources os LEFT JOIN sources s ON s.id = os.source_id
      WHERE os.opportunity_id = ? ORDER BY os.retrieved_at DESC`,
    [opportunityId],
  );
  return rows.map((row: any) => {
    const claims = typeof row.claims === 'string' ? jsonDecode<Record<string, unknown>>(row.claims, {}) : (row.claims ?? {});
    const official = isOfficialDomain(row.url);
    let hostname = row.url;
    try {
      hostname = new URL(row.url).hostname;
    } catch {
      /* keep the raw value */
    }
    return {
      id: row.url,
      url: row.url,
      title: row.title ?? hostname,
      snippet: row.snippet ?? '',
      hostname,
      tier: num(row.tier),
      sourceKind: row.source_type ?? (official.official ? 'official' : 'secondary'),
      sourceName: row.name ?? hostname,
      isGovernmentSource: bool(row.is_government),
      isOfficial: row.source_type === 'official' || official.official,
      officialName: official.name,
      claims: Object.entries(claims).map(([field, value]) => `${field}: ${value}`),
      claimsRaw: claims,
      retrievedAt: row.retrieved_at,
      sourceDate: row.source_date,
    };
  });
}

export async function duplicatesFor(row: any) {
  if (!row?.duplicate_group) return [];
  const rows = await db.query<any>(
    `SELECT id, title, organization, trust_score, verification_status, official_source, is_active
       FROM opportunities WHERE duplicate_group = ? ORDER BY trust_score DESC`,
    [row.duplicate_group],
  );
  return rows.map((item: any) => ({
    id: item.id,
    title: item.title,
    organization: item.organization,
    trustScore: Math.round(Number(item.trust_score ?? 0)),
    verificationStatus: item.verification_status,
    officialSource: item.official_source ?? null,
    isRepresentative: item.id === row.id,
    isActive: bool(item.is_active),
  }));
}

export async function verificationHistoryFor(opportunityId: string, examId?: string | null) {
  const rows = await db.query<any>(
    `SELECT id, checked_fields, agreements, conflicts, outcome, checked_at
       FROM verification_runs WHERE opportunity_id = ? OR exam_id = ?
      ORDER BY checked_at DESC LIMIT 8`,
    [opportunityId, examId ?? ''],
  );
  return rows.map((run: any) => ({
    id: run.id,
    outcome: run.outcome,
    checkedFields: jsonDecode<string[]>(run.checked_fields, []),
    agreements: jsonDecode<any[]>(run.agreements, []),
    conflicts: jsonDecode<any[]>(run.conflicts, []),
    checkedAt: run.checked_at,
    checked_at: run.checked_at,
  }));
}
