import { route, json } from '@/lib/api/route';
import { searchRunSchema } from '@/lib/api/schemas';
import { db } from '@/lib/db';
import { requirePermission, notFound, ApiError } from '@/lib/auth/rbac';
import { assertRateLimit } from '@/lib/rate-limit';
import { loadProfile } from '@/lib/services/profile-service';
import { createSearchJob, runResearchPipeline } from '@/lib/pipeline/research-agent';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Steps that are genuinely finished before a search starts: the resume was uploaded and parsed. */
const PRE_SEARCH_STEPS = ['resume_uploaded', 'extracting_text', 'understanding_education', 'identifying_skills', 'analysing_experience', 'building_profile'];

/** A run older than this is presumed orphaned (e.g. the server restarted mid-run). */
const STALE_RUN_MS = 10 * 60_000;

/**
 * POST /api/search/run
 * Launches the full research pipeline for the caller's profile.
 *
 *   default            runs to completion and returns the per-step log (simple API clients, and
 *                      screens that reload their list straight afterwards);
 *   { background: true }  returns 202 with the job id immediately and keeps running, so the
 *                      analysis screen can poll /api/search/status/[id] and show REAL progress.
 *
 * One run per user at a time: a second request while one is in flight is handed the running
 * job (background) or refused (synchronous) rather than starting a competing run.
 * Background runs live in this server process — fine for a long-running Node server, but they
 * would not survive a serverless deployment (see README).
 */
export const POST = route<import('zod').z.infer<typeof searchRunSchema>>(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'search.run');
  assertRateLimit({ key: `search:${user.id}`, limit: Number(process.env.SEARCH_RATE_LIMIT ?? 12), windowMs: 60 * 60_000 });

  const profile = await loadProfile(user.id);
  if (!profile) throw notFound('No career profile found — upload a resume first.');

  const inFlight = await db.one<{ id: string }>(
    `SELECT id FROM search_jobs WHERE user_id = ? AND status = 'running' AND started_at > ? ORDER BY started_at DESC`,
    [user.id, new Date(Date.now() - STALE_RUN_MS).toISOString()],
  );
  if (inFlight) {
    if (body.background) return json({ searchJobId: inFlight.id, status: 'running', resumed: true }, { status: 202 });
    throw new ApiError(409, 'A search is already running for your account. Wait for it to finish, then try again.', 'search_in_progress');
  }

  const profileRow = await db.one<{ id: string; preferred_locations: string }>(
    'SELECT id, preferred_locations FROM candidate_profiles WHERE user_id = ?',
    [user.id],
  );
  const settings = await db.one<any>(
    'SELECT preferred_locations, salary_min, salary_max, scoring_weights FROM user_settings WHERE user_id = ?',
    [user.id],
  );

  let locations: string[] = [];
  try {
    locations = JSON.parse(profileRow?.preferred_locations ?? '[]');
  } catch {
    locations = [];
  }
  if (settings?.preferred_locations) {
    try {
      const parsed = JSON.parse(settings.preferred_locations);
      if (Array.isArray(parsed) && parsed.length) locations = parsed;
    } catch {
      /* keep profile-derived locations */
    }
  }
  if (!locations.length) locations = ['India'];

  const searchJobId = await createSearchJob(user.id, profileRow!.id, PRE_SEARCH_STEPS);
  const pipeline = runResearchPipeline({
    userId: user.id,
    profileId: profileRow!.id,
    profile,
    locations,
    weights: settings?.scoring_weights,
    salaryMin: settings?.salary_min ?? null,
    salaryMax: settings?.salary_max ?? null,
    maxQueries: body.maxQueries,
    completedSteps: PRE_SEARCH_STEPS,
    searchJobId,
  });

  if (body.background) {
    // The pipeline records its own failure on the job row before it rethrows, so the only thing
    // left to do with the rejection is make sure it is not silently unhandled.
    pipeline.catch((error) => console.error(`[search] background run ${searchJobId} failed:`, error));
    await audit({ userId: user.id, action: 'search.run', resourceType: 'search_job', resourceId: searchJobId, newValue: { mode: 'background' }, ip: meta.ip });
    return json({ searchJobId, status: 'running' }, { status: 202 });
  }

  const result = await pipeline;
  await audit({
    userId: user.id,
    action: 'search.run',
    resourceType: 'search_job',
    resourceId: result.searchJobId,
    newValue: { found: result.found, stored: result.stored, matched: result.matched, duplicates: result.duplicates, providers: result.providers },
    ip: meta.ip,
  });

  const job = await db.one<any>('SELECT status, stage, progress, steps, found, stored, matched, duplicates, conflicts, providers, queries, error FROM search_jobs WHERE id = ?', [result.searchJobId]);

  return json({
    searchJobId: result.searchJobId,
    status: job?.status ?? 'completed',
    stage: job?.stage,
    progress: Number(job?.progress ?? 100),
    steps: JSON.parse(job?.steps ?? '[]'),
    found: result.found,
    stored: result.stored,
    matched: result.matched,
    duplicates: result.duplicates,
    conflicts: result.conflicts,
    providers: result.providers,
    queries: result.queries,
    error: job?.error ?? null,
  });
});
