import { db, jsonDecode } from '@/lib/db';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import { checkEligibility, matchOpportunity, type EligibilityResult, type MatchableRecord, type MatchResult } from './matcher';
import { categoryPenalty, feedbackAdjustment, rankOpportunity, type RankingResult } from './ranker';
import { isOfficialDomain } from './trust';

/**
 * Per-user scoring.
 *
 * The `opportunities` table is shared by every user, so a score stored on it can only ever
 * belong to whoever wrote it last. Everything personal — fit, eligibility, the final ranking,
 * the feedback adjustment — is therefore computed here at read time from the viewing user's
 * own profile, settings and feedback. Stored score columns are catalogue baselines only.
 */

export interface FeedbackCounts {
  overall: { relevant: number; notRelevant: number; notEligible: number; wrongInformation: number };
  byCategory: Record<string, { relevant: number; notRelevant: number }>;
}

export interface ScoringContext {
  weights: unknown;
  preferredLocations: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  feedback: FeedbackCounts;
}

export async function loadFeedbackCounts(userId: string): Promise<FeedbackCounts> {
  const rows = await db.query<any>(
    `SELECT f.verdict, o.category, COUNT(*) AS n
       FROM feedback f
       LEFT JOIN opportunities o ON o.id = f.opportunity_id
      WHERE f.user_id = ?
      GROUP BY f.verdict, o.category`,
    [userId],
  );
  const overall = { relevant: 0, notRelevant: 0, notEligible: 0, wrongInformation: 0 };
  const byCategory: Record<string, { relevant: number; notRelevant: number }> = {};
  for (const row of rows) {
    const n = Number(row.n ?? 0);
    if (row.verdict === 'relevant') overall.relevant += n;
    if (row.verdict === 'not_relevant') overall.notRelevant += n;
    if (row.verdict === 'not_eligible') overall.notEligible += n;
    if (row.verdict === 'wrong_information') overall.wrongInformation += n;
    if (row.category) {
      const entry = byCategory[row.category] ?? { relevant: 0, notRelevant: 0 };
      if (row.verdict === 'relevant') entry.relevant += n;
      if (row.verdict === 'not_relevant') entry.notRelevant += n;
      byCategory[row.category] = entry;
    }
  }
  return { overall, byCategory };
}

/** The user's configured weights, locations, salary range and feedback, loaded once per request. */
export async function loadScoringContext(userId: string): Promise<ScoringContext> {
  const [settings, feedback] = await Promise.all([
    db.one<any>('SELECT scoring_weights, preferred_locations, salary_min, salary_max FROM user_settings WHERE user_id = ?', [userId]),
    loadFeedbackCounts(userId),
  ]);
  return {
    weights: settings?.scoring_weights ? jsonDecode<unknown>(settings.scoring_weights, null) : null,
    preferredLocations: jsonDecode<string[]>(settings?.preferred_locations, []),
    salaryMin: settings?.salary_min != null ? Number(settings.salary_min) : null,
    salaryMax: settings?.salary_max != null ? Number(settings.salary_max) : null,
    feedback,
  };
}

export function feedbackAdjustFor(feedback: FeedbackCounts | null | undefined, category: string | null | undefined): number {
  if (!feedback) return 0;
  return feedbackAdjustment(feedback.overall) + categoryPenalty(feedback.byCategory, category ?? '');
}

export interface PersonalScore {
  eligibility: EligibilityResult;
  match: MatchResult;
  ranking: RankingResult;
  finalScore: number;
}

/**
 * Match + eligibility + final ranking for one opportunity row, for one user.
 * `matchable` is the row already converted to the matcher's input shape.
 */
export function scoreForUser(
  row: any,
  matchable: MatchableRecord,
  profile: CandidateProfileData,
  context?: Partial<ScoringContext> | null,
): PersonalScore {
  const eligibility = checkEligibility(profile, matchable);
  const match = matchOpportunity(profile, matchable, {
    weights: context?.weights ?? undefined,
    preferredLocations: context?.preferredLocations,
    salaryMin: context?.salaryMin ?? null,
    salaryMax: context?.salaryMax ?? null,
  });
  const ranking = rankOpportunity({
    id: row.id,
    match,
    trustScore: Number(row.trust_score ?? 0),
    verificationStatus: row.verification_status ?? 'needs_verification',
    qualityScore: Number(row.quality_score ?? 50),
    applicationDeadline: row.application_deadline ?? null,
    applicationStart: row.application_start ?? null,
    status: row.status,
    duplicateCount: Number(row.duplicate_count ?? 1),
    hasOfficialSource: Boolean(row.official_source) || isOfficialDomain(row.application_url || '').official,
    feedbackAdjustment: feedbackAdjustFor(context?.feedback, row.category),
  });
  return { eligibility, match, ranking, finalScore: Math.round(ranking.finalScore) };
}
