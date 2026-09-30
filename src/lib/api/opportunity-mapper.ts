import { db } from '@/lib/db';
import { describeDeadline } from '@/lib/opportunity/deadline';
import { enrichOpportunity, dashboardSummary, LIVE_SCORING_WINDOW } from '@/lib/api/enrich';
import type { ScoringContext } from '@/lib/opportunity/personal';
import type { CandidateProfileData } from '@/lib/analysis/profiler';

/**
 * Query builders + row enrichment for the opportunity and exam feeds.
 *
 * All parameter binding is positional `?`; the Postgres driver rewrites them to `$n`. The
 * deadline filter uses an ISO-string bound rather than `julianday()` so it works identically
 * on SQLite and PostgreSQL.
 */

export interface OpportunityFilters {
  type?: string;
  category?: string;
  experience?: string;
  workMode?: string;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  deadline?: string;
  matchScore?: string;
  status?: string;
  verificationStatus?: string;
  includeDemo?: boolean;
  q?: string;
  sort?: string;
  band?: string;
  limit?: number;
  offset?: number;
}

export interface QueryWhere {
  clause: string;
  params: unknown[];
}

export function buildOpportunityWhere(filters: OpportunityFilters, _userId?: string): QueryWhere {
  const conditions: string[] = ['o.is_active = 1'];
  const params: unknown[] = [];

  if (filters.type) {
    const types = filters.type.split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length) {
      conditions.push(`o.type IN (${types.map(() => '?').join(', ')})`);
      params.push(...types);
    }
  }
  if (filters.category) {
    conditions.push('LOWER(o.category) = LOWER(?)');
    params.push(filters.category);
  }
  if (filters.status) {
    const statuses = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) {
      conditions.push(`o.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
  }
  if (filters.verificationStatus) {
    conditions.push('o.verification_status = ?');
    params.push(filters.verificationStatus);
  }
  if (filters.workMode) {
    conditions.push('o.work_mode = ?');
    params.push(filters.workMode);
  }
  if (filters.location) {
    conditions.push('(LOWER(o.locations) LIKE LOWER(?) OR o.work_mode = ?)');
    params.push(`%${filters.location}%`, 'remote');
  }
  if (filters.q) {
    conditions.push('(LOWER(o.title) LIKE LOWER(?) OR LOWER(o.organization) LIKE LOWER(?) OR LOWER(o.skills) LIKE LOWER(?))');
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  if (filters.salaryMin != null) {
    conditions.push('(o.salary_max IS NULL OR o.salary_max >= ?)');
    params.push(filters.salaryMin);
  }
  if (filters.salaryMax != null) {
    conditions.push('(o.salary_min IS NULL OR o.salary_min <= ?)');
    params.push(filters.salaryMax);
  }
  if (filters.experience) {
    switch (filters.experience) {
      case 'fresher':
        conditions.push('(o.is_fresher_friendly = 1 OR COALESCE(o.experience_min_years, 0) = 0)');
        break;
      case 'entry':
      case '0-1':
        conditions.push('COALESCE(o.experience_min_years, 0) <= 2');
        break;
      case 'mid':
      case '1-3':
        conditions.push('COALESCE(o.experience_min_years, 0) BETWEEN 0 AND 5');
        break;
      case 'senior':
      case '5+':
        conditions.push('COALESCE(o.experience_min_years, 0) >= 3');
        break;
    }
  }
  if (filters.deadline && filters.deadline !== 'none') {
    const days = Number(filters.deadline);
    if (Number.isFinite(days)) {
      const now = new Date().toISOString();
      const threshold = new Date(Date.now() + (days + 1) * 86_400_000).toISOString();
      conditions.push('o.application_deadline IS NOT NULL');
      conditions.push('o.application_deadline >= ?');
      conditions.push('o.application_deadline <= ?');
      params.push(now, threshold);
    }
  }
  if (filters.matchScore) {
    const min = Number(filters.matchScore);
    if (Number.isFinite(min)) {
      conditions.push('o.final_score >= ?');
      params.push(min);
    }
  }
  if (filters.band) {
    const bands: Record<string, [number, number]> = {
      perfect: [90, 101],
      strong: [80, 90],
      good: [65, 80],
      possible: [45, 65],
      skill_gap: [0, 45],
    };
    const range = bands[filters.band];
    if (range) {
      conditions.push('o.final_score >= ? AND o.final_score < ?');
      params.push(range[0], range[1]);
    } else if (filters.band === 'not_eligible') {
      conditions.push("o.eligibility_status = 'not_eligible'");
    }
  }
  if (filters.includeDemo === false) conditions.push('o.is_demo = 0');

  return { clause: conditions.join(' AND '), params };
}

export const SORTS: Record<string, string> = {
  best_match: 'o.final_score DESC, o.match_score DESC',
  score: 'o.final_score DESC, o.match_score DESC',
  match: 'o.match_score DESC',
  rank: 'o.final_score DESC, o.trust_score DESC',
  deadline: 'CASE WHEN o.application_deadline IS NULL THEN 1 ELSE 0 END, o.application_deadline ASC',
  trust: 'o.trust_score DESC, o.final_score DESC',
  quality: 'o.quality_score DESC, o.final_score DESC',
  recent: 'o.first_discovered DESC',
};

/** Sorts whose order depends on the viewer's profile, so they cannot be done in SQL. */
const PERSONAL_SORTS = new Set(['best_match', 'score', 'match', 'rank']);

export async function fetchOpportunities(
  filters: OpportunityFilters,
  userId?: string,
  profile?: CandidateProfileData | null,
  context?: Partial<ScoringContext> | null,
) {
  const sortKey = filters.sort ?? 'best_match';
  const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
  const offset = Math.max(0, filters.offset ?? 0);

  const savedJoin = userId ? 'LEFT JOIN saved_opportunities s ON s.opportunity_id = o.id AND s.user_id = ?' : '';
  const savedParams = userId ? [userId] : [];
  const savedSelect = userId ? ', MAX(CASE WHEN s.id IS NULL THEN 0 ELSE 1 END) AS is_saved' : ', 0 AS is_saved';

  // Live mode: with a profile, fit/band/ranking are the *viewer's*, so ordering and the
  // band / min-score filters are applied after scoring rather than against stored columns
  // that belong to whichever user last ran a search. Bounded by LIVE_SCORING_WINDOW.
  const live = Boolean(profile) && (PERSONAL_SORTS.has(sortKey) || Boolean(filters.band) || Boolean(filters.matchScore));

  if (live && profile) {
    const { clause, params } = buildOpportunityWhere({ ...filters, band: undefined, matchScore: undefined }, userId);
    const rows = await db.query<any>(
      `SELECT o.* ${savedSelect}
         FROM opportunities o ${savedJoin}
        WHERE ${clause}
        GROUP BY o.id
        ORDER BY ${SORTS.best_match}
        LIMIT ?`,
      [...savedParams, ...params, LIVE_SCORING_WINDOW],
    );

    let views = rows.map((row) => enrichOpportunity(row, profile, context));
    const minScore = filters.matchScore ? Number(filters.matchScore) : null;
    if (minScore !== null && Number.isFinite(minScore)) views = views.filter((view) => view.finalScore >= minScore);
    if (filters.band) views = views.filter((view) => view.band === filters.band);

    views.sort((a, b) =>
      sortKey === 'match'
        ? b.matchScore - a.matchScore || b.finalScore - a.finalScore
        : b.finalScore - a.finalScore || b.matchScore - a.matchScore,
    );
    return { rows: views.slice(offset, offset + limit), total: views.length, limit, offset };
  }

  const { clause, params } = buildOpportunityWhere(filters, userId);
  const order = SORTS[sortKey] ?? SORTS.best_match;
  const rows = await db.query<any>(
    `SELECT o.* ${savedSelect}
       FROM opportunities o ${savedJoin}
      WHERE ${clause}
      GROUP BY o.id
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    [...savedParams, ...params, limit, offset],
  );
  const total = await db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities o WHERE ${clause}`, params);

  return {
    rows: rows.map((row) => enrichOpportunity(row, profile, context)),
    total: Number(total?.n ?? 0),
    limit,
    offset,
  };
}

export async function fetchExams(options: { category?: string; status?: string; q?: string; sort?: string; limit?: number; userId?: string } = {}) {
  const conditions: string[] = ['e.is_active = 1'];
  const params: unknown[] = [];
  if (options.category) {
    conditions.push('LOWER(e.category) = LOWER(?)');
    params.push(options.category);
  }
  if (options.status) {
    const statuses = options.status.split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) {
      conditions.push(`e.status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
  }
  if (options.q) {
    conditions.push('(LOWER(e.exam_name) LIKE LOWER(?) OR LOWER(e.organization) LIKE LOWER(?) OR LOWER(e.post) LIKE LOWER(?))');
    params.push(`%${options.q}%`, `%${options.q}%`, `%${options.q}%`);
  }

  const order =
    options.sort === 'deadline'
      ? 'CASE WHEN e.application_deadline IS NULL THEN 1 ELSE 0 END, e.application_deadline ASC'
      : options.sort === 'recent'
        ? 'e.created_at DESC'
        : "CASE e.status WHEN 'applications_open' THEN 0 WHEN 'deadline_today' THEN 1 WHEN 'closing_soon' THEN 2 WHEN 'notification_expected' THEN 3 WHEN 'exam_upcoming' THEN 4 ELSE 5 END, CASE WHEN e.application_deadline IS NULL THEN 1 ELSE 0 END, e.application_deadline ASC";

  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const savedSelect = options.userId ? ', (SELECT 1 FROM saved_opportunities sv WHERE sv.exam_id = e.id AND sv.user_id = ?) AS is_saved' : ', 0 AS is_saved';
  const savedParams = options.userId ? [options.userId] : [];

  const rows = await db.query<any>(
    `SELECT e.* ${savedSelect} FROM government_exams e WHERE ${conditions.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    [...savedParams, ...params, limit],
  );

  const { enrichExam } = await import('@/lib/api/enrich');
  return rows.map((row) => enrichExam(row));
}

export { describeDeadline, enrichOpportunity, dashboardSummary };
