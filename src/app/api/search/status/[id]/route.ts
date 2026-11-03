import { route, json } from '@/lib/api/route';
import { db, nowIso } from '@/lib/db';
import { requirePermission, notFound, requireOwnership } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search/status/[id]
 * Honest progress feed. Each step reports its own status — `pending`, `running`, `done`,
 * `skipped` or `failed` — so the UI can never claim a stage finished when it did not.
 */
export const GET = route(async (request, { params, user }) => {
  const { user: authed } = await requirePermission(request, 'search.run');
  const job = await db.one<any>(
    `SELECT id, user_id, status, stage, progress, steps, queries, providers, found, stored, matched,
            duplicates, conflicts, error, started_at, finished_at, created_at
       FROM search_jobs WHERE id = ?`,
    [params.id],
  );
  if (!job) throw notFound('Search job not found.');
  await requireOwnership(user ?? authed, job.user_id, 'search.read_logs');

  // A run that has been "running" for far longer than any real run takes was orphaned — the
  // server restarted, or the process died mid-run. Reporting it as still running would leave the
  // progress screen spinning forever, so it is closed out as failed, with the reason.
  if (job.status === 'running' && job.started_at && Date.now() - new Date(job.started_at).getTime() > 10 * 60_000) {
    job.status = 'failed';
    job.error = 'This run was interrupted before it finished (the server restarted or it exceeded the time limit). Start a new search.';
    await db.run(`UPDATE search_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'running'`, [job.error, nowIso(), job.id]);
  }

  const logs = await db.query(
    `SELECT provider, query, results, status, latency_ms, error, created_at
       FROM search_logs WHERE search_job_id = ? ORDER BY created_at ASC LIMIT 60`,
    [params.id],
  );

  let steps: unknown[] = [];
  try {
    steps = JSON.parse(job.steps ?? '[]');
  } catch {
    steps = [];
  }
  let queries: unknown[] = [];
  try {
    queries = JSON.parse(job.queries ?? '[]');
  } catch {
    queries = [];
  }
  let providers: unknown[] = [];
  try {
    providers = JSON.parse(job.providers ?? '[]');
  } catch {
    providers = [];
  }

  return json({
    id: job.id,
    searchJobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: Number(job.progress),
    steps,
    queries,
    providers,
    found: Number(job.found ?? 0),
    stored: Number(job.stored ?? 0),
    matched: Number(job.matched ?? 0),
    duplicates: Number(job.duplicates ?? 0),
    conflicts: Number(job.conflicts ?? 0),
    error: job.error,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    logs,
  });
}, { csrf: false });
