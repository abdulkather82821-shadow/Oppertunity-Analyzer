import type { MatchResult } from './matcher';
import { daysRemaining } from './deadline';

/**
 * Final ranking pipeline.
 *
 *   Candidate Fit + Eligibility + Career Relevance + Opportunity Quality
 *   + Source Trust + Deadline Relevance + Location Preference = Final Opportunity Score
 *
 * The match engine already folds in fit, eligibility and location; this stage layers on
 * source trust, quality and deadline relevance so a 95% match from an unverifiable blog
 * ranks below an 88% match backed by the official notification.
 */

export interface RankingInput {
  id: string;
  match: MatchResult;
  trustScore: number;
  verificationStatus: string;
  qualityScore: number;
  applicationDeadline?: string | null;
  applicationStart?: string | null;
  status?: string;
  careerRelevance?: number;
  duplicateCount?: number;
  hasOfficialSource?: boolean;
  feedbackAdjustment?: number;
}

export interface RankingResult {
  finalScore: number;
  components: {
    candidateFit: number;
    eligibility: number;
    careerRelevance: number;
    opportunityQuality: number;
    sourceTrust: number;
    deadlineRelevance: number;
    locationPreference: number;
    feedback: number;
  };
  explanation: string;
}

const WEIGHTS = {
  candidateFit: 34,
  eligibility: 16,
  careerRelevance: 12,
  opportunityQuality: 10,
  sourceTrust: 12,
  deadlineRelevance: 8,
  locationPreference: 8,
};

/** Deadline relevance rewards opportunities that are actionable *now* — open and not yet urgent. */
export function deadlineRelevance(deadline: string | null | undefined, start: string | null | undefined, now = new Date()): number {
  const days = daysRemaining(deadline, now);
  const opensIn = daysRemaining(start, now);
  if (opensIn !== null && opensIn > 0) return 55; // not open yet: worth tracking, not applying
  if (days === null) return 45; // no verified deadline
  if (days < 0) return 5; // closed
  if (days === 0) return 92;
  if (days <= 2) return 100;
  if (days <= 7) return 92;
  if (days <= 15) return 82;
  if (days <= 30) return 72;
  return 60;
}

export function rankOpportunity(input: RankingInput): RankingResult {
  const candidateFit = input.match.overall;
  const eligibility = input.match.breakdown.eligibility;
  const careerRelevance = input.careerRelevance ?? input.match.breakdown.role;
  const opportunityQuality = input.qualityScore;
  const sourceTrust = input.trustScore;
  const deadline = deadlineRelevance(input.applicationDeadline, input.applicationStart);
  const location = input.match.breakdown.location;
  const feedback = input.feedbackAdjustment ?? 0;

  const base =
    (candidateFit * WEIGHTS.candidateFit +
      eligibility * WEIGHTS.eligibility +
      careerRelevance * WEIGHTS.careerRelevance +
      opportunityQuality * WEIGHTS.opportunityQuality +
      sourceTrust * WEIGHTS.sourceTrust +
      deadline * WEIGHTS.deadlineRelevance +
      location * WEIGHTS.locationPreference) /
    100;

  let finalScore = Math.round(Math.max(0, Math.min(100, base + feedback)));

  // Hard gates — these override the arithmetic because they are binary facts.
  if (input.match.eligible === 'not_eligible') finalScore = Math.min(finalScore, 22);
  if (input.status === 'applications_closed' || daysRemaining(input.applicationDeadline) !== null && daysRemaining(input.applicationDeadline)! < 0) {
    finalScore = Math.min(finalScore, 18);
  }
  if (input.verificationStatus === 'suspicious') finalScore = Math.min(finalScore, 25);
  if (input.verificationStatus === 'conflicting') finalScore = Math.min(finalScore, 70);

  const components = {
    candidateFit,
    eligibility,
    careerRelevance: Math.round(careerRelevance),
    opportunityQuality: Math.round(opportunityQuality),
    sourceTrust: Math.round(sourceTrust),
    deadlineRelevance: Math.round(deadline),
    locationPreference: Math.round(location),
    feedback: Math.round(feedback),
  };

  const explanation = [
    `Candidate fit ${candidateFit}×${WEIGHTS.candidateFit}%`,
    `Eligibility ${components.eligibility}×${WEIGHTS.eligibility}%`,
    `Career relevance ${components.careerRelevance}×${WEIGHTS.careerRelevance}%`,
    `Opportunity quality ${components.opportunityQuality}×${WEIGHTS.opportunityQuality}%`,
    `Source trust ${components.sourceTrust}×${WEIGHTS.sourceTrust}%`,
    `Deadline relevance ${components.deadlineRelevance}×${WEIGHTS.deadlineRelevance}%`,
    `Location ${components.locationPreference}×${WEIGHTS.locationPreference}%`,
    feedback !== 0 ? `Feedback adjustment ${feedback > 0 ? '+' : ''}${Math.round(feedback)}` : null,
  ]
    .filter(Boolean)
    .join(' + ') as string;

  return { finalScore, components, explanation: `${explanation} = ${finalScore}/100` };
}

/**
 * Learning signal from explicit user feedback.
 * Repeated "not relevant" marks on a job family suppress that family; "relevant" marks
 * lift it. Bounded so feedback can refine ranking but never dominate the match score.
 */
export function feedbackAdjustment(feedbackCounts: { relevant: number; notRelevant: number; notEligible: number; wrongInformation: number }): number {
  const positive = feedbackCounts.relevant * 3;
  const negative = feedbackCounts.notRelevant * 4 + feedbackCounts.notEligible * 5 + feedbackCounts.wrongInformation * 6;
  return Math.max(-18, Math.min(12, positive - negative));
}

/** Category-level suppression: if a user repeatedly rejects a family, down-weight it. */
export function categoryPenalty(feedbackByCategory: Record<string, { relevant: number; notRelevant: number }>, category: string): number {
  const entry = feedbackByCategory[category];
  if (!entry) return 0;
  const total = entry.relevant + entry.notRelevant;
  if (total < 3) return 0; // not enough signal yet
  const rejectionRate = entry.notRelevant / total;
  if (rejectionRate >= 0.8) return -15;
  if (rejectionRate >= 0.6) return -8;
  if (rejectionRate <= 0.2 && entry.relevant >= 2) return 4;
  return 0;
}
