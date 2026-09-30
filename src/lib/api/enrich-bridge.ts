import { toMatchable } from '@/lib/api/enrich';

export { matchOpportunity, checkEligibility, explainScore, bandFor } from '@/lib/opportunity/matcher';
export { composeExplanation } from '@/lib/opportunity/explainer';

/** Re-exported so route handlers import one module for both enrichment and scoring. */
export const toMatchableRecord = toMatchable;
