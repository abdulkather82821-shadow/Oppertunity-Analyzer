/**
 * Pipeline step vocabulary.
 *
 * This module deliberately has no imports: the analysis screen is a client component that
 * needs the step keys and labels to render honest progress, and importing them from
 * `research-agent` would drag the database driver (and therefore `pg`, `net` and `tls`) into
 * the browser bundle. Keep it dependency-free.
 */

export interface StepRecord {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** The pipeline stages, in execution order. */
export const STEP_LABELS: { key: string; label: string }[] = [
  { key: 'resume_uploaded', label: 'Resume uploaded' },
  { key: 'extracting_text', label: 'Extracting text' },
  { key: 'understanding_education', label: 'Understanding education' },
  { key: 'identifying_skills', label: 'Identifying skills' },
  { key: 'analysing_experience', label: 'Analysing experience' },
  { key: 'building_profile', label: 'Building career profile' },
  { key: 'job_categories', label: 'Finding suitable job categories' },
  { key: 'generating_queries', label: 'Generating search queries' },
  { key: 'searching', label: 'Searching opportunity sources' },
  { key: 'normalising', label: 'Normalising opportunities' },
  { key: 'eligibility', label: 'Calculating eligibility' },
  { key: 'matching', label: 'Scoring matches' },
  { key: 'deadlines', label: 'Checking deadlines' },
  { key: 'deduplicating', label: 'Merging duplicates' },
  { key: 'verifying', label: 'Verifying against sources' },
  { key: 'ranking', label: 'Ranking opportunities' },
  { key: 'persisting', label: 'Saving to your dashboard' },
];

export const STEP_KEYS = STEP_LABELS.map((step) => step.key);

export function initialSteps(): StepRecord[] {
  return STEP_LABELS.map((step) => ({ ...step, status: 'pending' as const }));
}
