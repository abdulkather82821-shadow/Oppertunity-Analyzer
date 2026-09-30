import { db, insertRow, jsonDecode, jsonList, nowIso, uid } from '@/lib/db';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import { generateQueries } from '@/lib/opportunity/query-generator';
import { runSearch } from '@/lib/search';
import { normaliseHit, canonicalKeyFor, classifySourceType, type NormalizedOpportunity } from '@/lib/opportunity/normalizer';
import { composeExplanation } from '@/lib/opportunity/explainer';
import { groupDuplicates, type DedupeCandidate } from '@/lib/opportunity/dedupe';
import { verifyFromSources, type SourceClaim } from '@/lib/opportunity/verification';
import { assessTrust, hostnameOf, isOfficialDomain, tierForUrl } from '@/lib/opportunity/trust';
import { matchOpportunity, type MatchableRecord } from '@/lib/opportunity/matcher';
import { rankOpportunity } from '@/lib/opportunity/ranker';
import { deriveStatus, describeDeadline, nextVerificationDate } from '@/lib/opportunity/deadline';
import { feedbackAdjustFor, loadFeedbackCounts } from '@/lib/opportunity/personal';

/**
 * The autonomous research pipeline:
 *
 *   Resume Parser → Candidate Profiler → Opportunity Query Generator → Web Search Agent
 *   → Source Extractor → Opportunity Normalizer → Eligibility Engine → Match Scoring
 *   → Deadline Engine → Duplicate Detection → Verification Engine → AI Ranking → Dashboard
 *
 * Every step records an honest status in `search_jobs.steps`. A step that did not run is
 * reported as `skipped` or `failed` — the UI never claims a step completed when it did not.
 */

/** A source URL together with what *that* source asserted, so disagreements stay detectable. */
export interface PersistedSource extends SourceClaim {
  title: string;
  snippet: string;
}

export type PipelineStage =
  | 'queued'
  | 'profiling'
  | 'generating_queries'
  | 'searching'
  | 'extracting'
  | 'normalising'
  | 'eligibility'
  | 'matching'
  | 'deadlines'
  | 'deduplicating'
  | 'verifying'
  | 'ranking'
  | 'persisting'
  | 'completed'
  | 'failed';

export type { StepRecord } from './steps';
export { STEP_LABELS, STEP_KEYS, initialSteps } from './steps';
import { initialSteps } from './steps';
import type { StepRecord } from './steps';

export interface PipelineOptions {
  userId: string;
  profileId: string;
  profile: CandidateProfileData;
  locations: string[];
  weights?: unknown;
  salaryMin?: number | null;
  salaryMax?: number | null;
  maxQueries?: number;
  /** Mark earlier pipeline steps (upload/parse) as already complete. */
  completedSteps?: string[];
  /** A job row created up front with `createSearchJob`, so a caller can hand back its id early. */
  searchJobId?: string;
}

export interface PipelineResult {
  searchJobId: string;
  found: number;
  stored: number;
  matched: number;
  duplicates: number;
  conflicts: number;
  providers: string[];
  queries: string[];
}

function stepsWithCompleted(completedSteps: string[] = []): StepRecord[] {
  const steps = initialSteps();
  for (const key of completedSteps) {
    const step = steps.find((s) => s.key === key);
    if (step) step.status = 'done';
  }
  return steps;
}

/** Creates the `search_jobs` row for a run, so its id can be returned before the run finishes. */
export async function createSearchJob(userId: string, profileId: string, completedSteps: string[] = []): Promise<string> {
  const id = uid();
  const now = nowIso();
  await db.run(
    `INSERT INTO search_jobs (id, user_id, profile_id, status, stage, progress, steps, created_at, started_at)
     VALUES (?, ?, ?, 'running', 'profiling', 0, ?, ?, ?)`,
    [id, userId, profileId, JSON.stringify(stepsWithCompleted(completedSteps)), now, now],
  );
  return id;
}

export async function runResearchPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const searchJobId = options.searchJobId ?? (await createSearchJob(options.userId, options.profileId, options.completedSteps));
  const steps = stepsWithCompleted(options.completedSteps);

  const updateStep = async (key: string, status: StepRecord['status'], detail?: string) => {
    const step = steps.find((s) => s.key === key);
    if (!step) return;
    step.status = status;
    if (detail) step.detail = detail;
    if (status === 'running' && !step.startedAt) step.startedAt = nowIso();
    if (['done', 'failed', 'skipped'].includes(status)) step.finishedAt = nowIso();
    await persistJob(searchJobId, steps, 'running', steps.filter((s) => s.status !== 'pending').length, null);
  };

  try {
    // --- Query generation ---------------------------------------------------
    await updateStep('job_categories', 'running');
    await updateStep(
      'job_categories',
      'done',
      `${options.profile.jobFamilies.length} job families, ${options.profile.governmentCategories.length} government categories`,
    );

    await updateStep('generating_queries', 'running');
    const { queries, provider: queryProvider, usedFallback } = await generateQueries(
      { profile: options.profile, locations: options.locations, maxQueries: options.maxQueries },
      options.userId,
    );
    await updateStep(
      'generating_queries',
      'done',
      `${queries.length} queries via ${queryProvider}${usedFallback ? ' (local rule engine)' : ''}`,
    );

    // --- Search --------------------------------------------------------------
    await updateStep('searching', 'running');
    const hits: Awaited<ReturnType<typeof runSearch>>['hits'] = [];
    const providers = new Set<string>();
    const failures: string[] = [];

    for (const query of queries) {
      const outcome = await runSearch(query.q, {
        limit: 10,
        intent: query.intent,
        searchJobId,
        userId: options.userId,
      });
      providers.add(outcome.provider);
      if (outcome.status !== 'ok') failures.push(`${outcome.provider}: ${outcome.status}`);
      for (const hit of outcome.hits) hits.push({ ...hit, query: query.q } as typeof hit);
    }
    await updateStep(
      'searching',
      hits.length > 0 ? 'done' : 'failed',
      hits.length > 0
        ? `${hits.length} raw results from ${[...providers].join(', ')}`
        : `No results returned${failures.length ? ` — ${failures.slice(0, 3).join('; ')}` : ''}`,
    );

    // --- Normalise -----------------------------------------------------------
    await updateStep('normalising', 'running');
    const normalized: NormalizedOpportunity[] = [];
    const seenKeys = new Set<string>();
    for (const hit of hits) {
      const record = normaliseHit(hit, {});
      if (!record) continue;
      if (seenKeys.has(record.canonicalKey)) {
        const existing = normalized.find((n) => n.canonicalKey === record.canonicalKey);
        if (existing && !existing.sourceUrls.includes(hit.url)) existing.sourceUrls.push(hit.url);
        continue;
      }
      seenKeys.add(record.canonicalKey);
      normalized.push(record);
    }
    await updateStep('normalising', normalized.length ? 'done' : 'skipped', `${normalized.length} unique opportunities parsed`);

    // --- Deduplicate ---------------------------------------------------------
    await updateStep('deduplicating', 'running');
    const dedupeCandidates: DedupeCandidate[] = normalized.map((record) => ({
      id: record.canonicalKey,
      title: record.title,
      organization: record.organization,
      category: record.category,
      location: record.locations[0],
      applicationDeadline: record.applicationDeadline,
      examDate: record.examDate,
      officialSource: record.officialSource,
      sourceUrls: record.sourceUrls,
      sourceTier: record.tier,
      isGovernment: record.isGovernment,
    }));
    const groups = groupDuplicates(dedupeCandidates);
    const duplicatesMerged = normalized.length - groups.length;
    await updateStep('deduplicating', 'done', `${groups.length} distinct opportunities (${duplicatesMerged} duplicates merged)`);

    // --- Per-group: verify, trust, match, rank, persist ------------------------
    await updateStep('eligibility', 'running');
    let inserted = 0;
    let merged = 0;
    let matched = 0;
    let conflicts = 0;

    const feedbackCounts = await loadFeedbackCounts(options.userId);

    for (const group of groups) {
      const memberRecords = group.members
        .map((member) => normalized.find((n) => n.canonicalKey === member.id))
        .filter((r): r is NormalizedOpportunity => Boolean(r));
      const record = memberRecords.find((r) => r.canonicalKey === group.representative.id) ?? memberRecords[0];
      if (!record) continue;

      // Every member of the group contributes its own URLs *and its own claims*. Handing each
      // source a copy of the representative's claims would make a disagreement between two
      // sources impossible to detect, which defeats multi-source verification.
      const sourceMap = new Map<string, PersistedSource>();
      for (const member of memberRecords) {
        for (const url of member.sourceUrls) {
          if (sourceMap.has(url)) continue;
          sourceMap.set(url, {
            url,
            tier: tierForUrl(url),
            isOfficial: isOfficialDomain(url).official,
            sourceDate: member.sourceDate,
            claims: member.claims,
            title: member.title,
            snippet: member.description,
          });
        }
      }
      const sources = [...sourceMap.values()];
      const verification = verifyFromSources(sources);
      if (verification.conflicts.length) conflicts += 1;

      const trust = assessTrust({
        title: record.title,
        organization: record.organization,
        officialSource: record.officialSource,
        applicationUrl: record.applicationUrl,
        sourceUrls: sources.map((source) => source.url),
        description: record.description,
        salary: record.salary,
        salaryMax: record.salaryMax,
        isGovernment: record.isGovernment,
        duplicateCount: sources.length,
      });

      const matchable: MatchableRecord = {
        id: record.canonicalKey,
        title: record.title,
        organization: record.organization,
        type: record.type,
        category: record.category,
        locations: record.locations,
        workMode: record.workMode,
        qualification: record.qualification,
        degreeLevels: record.degreeLevels,
        fieldsOfStudy: record.fieldsOfStudy,
        skills: record.skills,
        experienceMinYears: record.experienceMinYears,
        salaryMin: record.salaryMin,
        salaryMax: record.salaryMax,
        ageMin: record.ageMin,
        ageMax: record.ageMax,
        experienceRequired: record.experienceRequired,
        applicationDeadline: record.applicationDeadline,
        isGovernment: record.isGovernment,
      };
      const match = matchOpportunity(options.profile, matchable, {
        weights: options.weights,
        preferredLocations: options.locations,
        salaryMin: options.salaryMin ?? null,
        salaryMax: options.salaryMax ?? null,
      });

      const status = deriveStatus({
        applicationStart: record.applicationStart,
        applicationDeadline: record.applicationDeadline,
        examDate: record.examDate,
        conflicts: verification.conflicts.map((c) => c.field),
      });

      const ranking = rankOpportunity({
        id: record.canonicalKey,
        match,
        trustScore: trust.score,
        verificationStatus: verification.outcome,
        qualityScore: qualityScoreFor(record, trust.tier),
        applicationDeadline: record.applicationDeadline,
        applicationStart: record.applicationStart,
        status,
        duplicateCount: sources.length,
        hasOfficialSource: Boolean(record.officialSource),
        feedbackAdjustment: feedbackAdjustFor(feedbackCounts, record.category),
      });

      const outcome = await upsertOpportunity({
        userId: options.userId,
        searchJobId,
        record,
        profile: options.profile,
        matchable,
        sources,
        groupKey: group.key,
        ownIds: memberRecords.flatMap((member) => member.sourceOpportunityIds),
        // A hit that is one of our own catalogue rows is not new evidence about the world.
        hasExternalEvidence: memberRecords.some((member) => member.sourceOpportunityIds.length === 0),
        match,
        trust,
        verification,
        ranking,
        status,
        nextVerification: nextVerificationDate(record.applicationDeadline, null),
      });
      if (outcome.action === 'inserted') inserted += 1;
      else if (outcome.action === 'merged') merged += 1;
      else matched += 1;
    }
    const stored = inserted + merged;

    await updateStep('eligibility', 'done', `Eligibility checked for ${groups.length} ${groups.length === 1 ? 'opportunity' : 'opportunities'}`);
    await updateStep('matching', 'done', `${groups.length} ${groups.length === 1 ? 'opportunity' : 'opportunities'} scored for your profile`);
    await updateStep('deadlines', 'done', "Deadlines and status derived from each record's published dates");
    await updateStep(
      'verifying',
      'done',
      conflicts
        ? `${conflicts} ${conflicts === 1 ? 'record has' : 'records have'} conflicting source data`
        : inserted + merged === 0
          ? 'Nothing new to verify — every result was already in the catalogue'
          : 'No source conflicts detected',
    );
    await updateStep('ranking', 'done', 'Ranked by fit, eligibility, trust and deadline for your profile');
    await updateStep('persisting', 'running');
    await updateStep(
      'persisting',
      'done',
      `${inserted} new, ${merged} updated with additional sources, ${matched} already in the catalogue (left unchanged)`,
    );

    await persistJob(searchJobId, steps, groups.length > 0 ? 'completed' : 'partial', 100, null, {
      found: hits.length,
      stored,
      matched,
      duplicates: duplicatesMerged,
      conflicts,
      providers: [...providers],
      queries: queries.map((q) => q.q),
    });

    return {
      searchJobId,
      found: hits.length,
      stored,
      matched,
      duplicates: duplicatesMerged,
      conflicts,
      providers: [...providers],
      queries: queries.map((q) => q.q),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const runningStep = steps.find((s) => s.status === 'running');
    if (runningStep) {
      runningStep.status = 'failed';
      runningStep.detail = message.slice(0, 300);
      runningStep.finishedAt = nowIso();
    }
    await persistJob(searchJobId, steps, 'failed', steps.filter((s) => s.status !== 'pending').length, message, {
      found: 0,
      stored: 0,
      duplicates: 0,
      conflicts: 0,
      providers: [],
      queries: [],
    });
    throw error;
  }
}

async function persistJob(
  searchJobId: string,
  steps: StepRecord[],
  status: string,
  progress: number,
  error: string | null,
  counters?: { found: number; stored: number; matched?: number; duplicates: number; conflicts: number; providers: string[]; queries: string[] },
): Promise<void> {
  const done = steps.filter((s) => ['done', 'failed', 'skipped'].includes(s.status)).length;
  const current = steps.find((s) => s.status === 'running');
  await db.run(
    `UPDATE search_jobs
        SET status = ?, stage = ?, progress = ?, steps = ?, error = ?,
            found = ?, stored = ?, matched = ?, duplicates = ?, conflicts = ?, providers = ?, queries = ?,
            finished_at = CASE WHEN ? IN ('completed','failed','partial') THEN ? ELSE finished_at END
      WHERE id = ?`,
    [
      status,
      current?.key ?? (status === 'completed' ? 'completed' : 'failed'),
      Math.round((done / Math.max(1, steps.length)) * 100),
      JSON.stringify(steps),
      error,
      counters?.found ?? 0,
      counters?.stored ?? 0,
      counters?.matched ?? 0,
      counters?.duplicates ?? 0,
      counters?.conflicts ?? 0,
      JSON.stringify(counters?.providers ?? []),
      JSON.stringify(counters?.queries ?? []),
      status,
      nowIso(),
      searchJobId,
    ],
  );
  void progress;
}

/**
 * Opportunity quality: how complete and how well-sourced the record is. A listing missing
 * its deadline, organisation and qualification is a poor opportunity even at a high match.
 */
export function qualityScoreFor(record: NormalizedOpportunity, tier: number): number {
  let score = 40;
  if (record.organization) score += 12;
  if (record.applicationDeadline) score += 14;
  if (record.qualification.length) score += 8;
  if (record.locations.length) score += 6;
  if (record.description.length > 200) score += 8;
  if (record.vacancies != null) score += 4;
  if (record.salary) score += 4;
  if (tier === 1) score += 16;
  else if (tier === 2) score += 10;
  else if (tier === 3) score += 4;
  return Math.min(100, score);
}

// ---------------------------------------------------------------------------------------
// Persistence
//
// The governing rule: re-discovery may ADD knowledge to a record but must never ERASE it.
// A search snippet is a lossy view of a notification — it may omit the deadline, vacancies or
// qualification that we already hold from a better source — so a snippet can fill a blank,
// contribute a source and raise a conflict, but it cannot overwrite a value we already have.
// ---------------------------------------------------------------------------------------

export type UpsertAction = 'inserted' | 'merged' | 'unchanged';

/** Columns a newly found source may *fill in* on an existing opportunity, never overwrite. */
const OPPORTUNITY_FILL_FIELDS = [
  'organization', 'category', 'locations', 'work_mode', 'employment_type', 'description',
  'qualification', 'degree_levels', 'fields_of_study', 'skills', 'experience_required',
  'experience_min_years', 'salary', 'salary_min', 'salary_max', 'vacancies', 'age_min', 'age_max',
  'application_start', 'application_deadline', 'exam_date', 'official_source', 'application_url',
] as const;

const EXAM_FILL_FIELDS = [
  'organization', 'category', 'qualification', 'degree_levels', 'fields_of_study', 'age_min', 'age_max',
  'experience_required', 'experience_min_years', 'vacancies', 'application_start', 'application_deadline',
  'exam_date', 'official_notification', 'official_application', 'official_website',
] as const;

/** "Nothing known". Zero is a real value (0 years of experience), so numbers are never blank. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return false;
  const text = String(value).trim();
  return text === '' || text === '[]' || text === '{}' || text.toLowerCase() === 'unknown';
}

/** Values from `incoming` for every field that is blank on `existing` and known on `incoming`. */
function fillBlanks(existing: Record<string, unknown>, incoming: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const fills: Record<string, unknown> = {};
  for (const field of fields) {
    if (isBlank(existing[field]) && !isBlank(incoming[field])) fills[field] = incoming[field];
  }
  return fills;
}

function opportunityContent(record: NormalizedOpportunity): Record<string, unknown> {
  return {
    organization: record.organization,
    category: record.category,
    locations: JSON.stringify(record.locations),
    work_mode: record.workMode,
    employment_type: record.employmentType,
    description: record.description,
    qualification: JSON.stringify(record.qualification),
    degree_levels: JSON.stringify(record.degreeLevels),
    fields_of_study: JSON.stringify(record.fieldsOfStudy),
    skills: JSON.stringify(record.skills),
    experience_required: record.experienceRequired,
    experience_min_years: record.experienceMinYears,
    salary: record.salary,
    salary_min: record.salaryMin,
    salary_max: record.salaryMax,
    vacancies: record.vacancies,
    age_min: record.ageMin,
    age_max: record.ageMax,
    application_start: record.applicationStart,
    application_deadline: record.applicationDeadline,
    exam_date: record.examDate,
    official_source: record.officialSource,
    application_url: record.applicationUrl,
  };
}

function examContent(record: NormalizedOpportunity): Record<string, unknown> {
  let officialOrigin = '';
  try {
    officialOrigin = record.officialSource ? new URL(record.officialSource).origin : '';
  } catch {
    officialOrigin = '';
  }
  return {
    organization: record.organization,
    category: record.category,
    qualification: JSON.stringify(record.qualification),
    degree_levels: JSON.stringify(record.degreeLevels),
    fields_of_study: JSON.stringify(record.fieldsOfStudy),
    age_min: record.ageMin,
    age_max: record.ageMax,
    experience_required: record.experienceRequired,
    experience_min_years: record.experienceMinYears,
    vacancies: record.vacancies,
    application_start: record.applicationStart,
    application_deadline: record.applicationDeadline,
    exam_date: record.examDate,
    official_notification: record.officialSource || record.applicationUrl,
    official_application: record.applicationUrl,
    official_website: officialOrigin,
  };
}

/** Finds (or registers) the row in the source registry for a URL's domain. */
async function ensureSourceId(url: string, tier: number): Promise<string | null> {
  const host = hostnameOf(url);
  if (!host) return null;
  const known = await db.one<{ id: string }>('SELECT id FROM sources WHERE domain = ? OR domain = ?', [host, `www.${host}`]);
  if (known) return known.id;
  try {
    const official = isOfficialDomain(url);
    const now = nowIso();
    const id = uid();
    await insertRow('sources', {
      id,
      url: `https://${host}/`,
      domain: host,
      name: official.name ?? host,
      tier,
      source_type: classifySourceType(url, tier),
      is_government: official.official ? 1 : 0,
      trust_score: official.official ? 92 : tier === 2 ? 70 : tier === 3 ? 55 : 38,
      robots_checked: 0,
      robots_allows: 1,
      last_checked: now,
      created_at: now,
      updated_at: now,
    });
    return id;
  } catch {
    // Another request registered the same domain first; use theirs.
    const again = await db.one<{ id: string }>('SELECT id FROM sources WHERE domain = ? OR url = ?', [host, `https://${host}/`]);
    return again?.id ?? null;
  }
}

/** Adds new sources and merges the claims of known ones. Existing sources are never removed. */
async function writeSources(opportunityId: string, sources: PersistedSource[], now: string): Promise<void> {
  const existing = await db.query<any>('SELECT id, url, claims FROM opportunity_sources WHERE opportunity_id = ?', [opportunityId]);
  const byUrl = new Map<string, any>(existing.map((row) => [row.url, row]));
  for (const source of sources) {
    const sourceId = await ensureSourceId(source.url, source.tier);
    const prior = byUrl.get(source.url);
    if (prior) {
      const claims = { ...jsonDecode<Record<string, string>>(prior.claims, {}), ...source.claims };
      await db.run(
        'UPDATE opportunity_sources SET claims = ?, retrieved_at = ?, source_date = COALESCE(?, source_date), source_id = COALESCE(source_id, ?) WHERE id = ?',
        [JSON.stringify(claims), now, source.sourceDate, sourceId, prior.id],
      );
    } else {
      await insertRow('opportunity_sources', {
        id: uid(),
        opportunity_id: opportunityId,
        source_id: sourceId,
        url: source.url,
        title: source.title.slice(0, 300),
        snippet: source.snippet.slice(0, 400),
        tier: source.tier,
        claims: JSON.stringify(source.claims),
        retrieved_at: now,
        source_date: source.sourceDate,
      });
    }
  }
}

export async function upsertOpportunity(input: {
  userId: string;
  searchJobId: string;
  record: NormalizedOpportunity;
  profile: CandidateProfileData;
  matchable: MatchableRecord;
  sources: PersistedSource[];
  groupKey: string;
  /** Ids of our own catalogue rows among the hits (set by the offline local-catalogue provider). */
  ownIds: string[];
  /** True when at least one hit came from outside our own catalogue. */
  hasExternalEvidence: boolean;
  match: ReturnType<typeof matchOpportunity>;
  trust: ReturnType<typeof assessTrust>;
  verification: ReturnType<typeof verifyFromSources>;
  ranking: ReturnType<typeof rankOpportunity>;
  status: string;
  nextVerification: string;
}): Promise<{ id: string; action: UpsertAction }> {
  const { record, profile, matchable, match, trust, ranking } = input;
  const now = nowIso();

  // Which row does this evidence belong to? Our own id wins; otherwise the canonical key.
  let existing: any = null;
  for (const knownId of input.ownIds) {
    existing = await db.one<any>('SELECT * FROM opportunities WHERE id = ?', [knownId]);
    if (existing) break;
  }
  if (!existing) existing = await db.one<any>('SELECT * FROM opportunities WHERE canonical_key = ?', [record.canonicalKey]);

  // Reading our own catalogue back tells us nothing new about the world. Writing anything here
  // would re-derive fields from a lossy snippet, collapse the source list and stamp the row
  // "verified just now" although nothing was checked — so nothing is written at all.
  if (!input.hasExternalEvidence) return { id: existing?.id ?? '', action: 'unchanged' };

  // ---------------------------------------------------------------- new opportunity
  if (!existing) {
    const id = uid();
    await insertRow('opportunities', {
      id,
      canonical_key: record.canonicalKey,
      title: record.title,
      type: record.type,
      ...opportunityContent(record),
      currency: 'INR',
      status: input.status,
      // Baseline scores from the discovering user's profile. They are NOT what other users
      // see — every read recomputes fit and ranking for the viewer (see opportunity/personal).
      match_score: match.overall,
      trust_score: trust.score,
      quality_score: qualityScoreFor(record, trust.tier),
      final_score: ranking.finalScore,
      source_urls: JSON.stringify(input.sources.map((source) => source.url)),
      duplicate_group: input.groupKey,
      duplicate_count: input.sources.length,
      conflict_flags: JSON.stringify(input.verification.conflicts.map((c) => ({ field: c.field, values: c.values }))),
      verification_status: input.verification.outcome,
      source_type: record.sourceType,
      source_tier: trust.tier,
      eligibility_status: match.eligible,
      eligibility_reason: match.reasons.join('; ').slice(0, 1000),
      match_strengths: JSON.stringify(match.matchedSkills.slice(0, 12)),
      match_gaps: JSON.stringify(match.missingSkills.slice(0, 12)),
      explanation: composeExplanation(profile, matchable, match).summary,
      first_discovered: now,
      last_verified: now,
      next_verification: input.nextVerification,
      source_updated: record.sourceDate,
      is_demo: 0,
      created_at: now,
      updated_at: now,
    });
    await writeSources(id, input.sources, now);

    if (record.isGovernment) {
      const timeline = buildTimeline(record);
      await insertRow('government_exams', {
        id: uid(),
        opportunity_id: id,
        exam_name: examNameFor(record),
        exam_code: '',
        organization_type: organisationTypeFor(record),
        post: record.title,
        ...examContent(record),
        status: input.status,
        timeline: JSON.stringify(timeline),
        verification_status: input.verification.outcome,
        trust_score: trust.score,
        last_verified: now,
        next_verification: input.nextVerification,
        conflict_flags: JSON.stringify(input.verification.conflicts.map((c) => ({ field: c.field, values: c.values }))),
        created_at: now,
        updated_at: now,
      });
    }
    return { id, action: 'inserted' };
  }

  // ---------------------------------------------------------- existing: merge only
  await writeSources(existing.id, input.sources, now);

  // Verification runs over EVERY source we now hold for the record — prior ones included —
  // because that is the only way a new source's disagreement with an old one can surface.
  const held = await db.query<any>('SELECT url, tier, claims, source_date FROM opportunity_sources WHERE opportunity_id = ?', [existing.id]);
  const union: SourceClaim[] = held.map((row) => ({
    url: row.url,
    tier: Number(row.tier ?? 4),
    isOfficial: isOfficialDomain(row.url).official,
    sourceDate: row.source_date ?? null,
    claims: jsonDecode<Record<string, string>>(row.claims, {}),
  }));
  const verification = verifyFromSources(union);
  const conflictFlags = JSON.stringify(verification.conflicts.map((c) => ({ field: c.field, values: c.values })));

  const fills = fillBlanks(existing, opportunityContent(record), OPPORTUNITY_FILL_FIELDS);
  const after = { ...existing, ...fills };
  const urls = union.map((source) => source.url);
  const mergedTrust = assessTrust({
    title: existing.title,
    organization: after.organization ?? '',
    officialSource: after.official_source,
    applicationUrl: after.application_url,
    sourceUrls: urls,
    description: after.description ?? '',
    salary: after.salary,
    isGovernment: ['government_job', 'exam'].includes(existing.type),
    duplicateCount: urls.length,
  });

  const datesFilled = ['application_start', 'application_deadline', 'exam_date'].some((field) => field in fills);
  let status: string = existing.status;
  if (verification.conflicts.length) status = 'needs_verification';
  else if (datesFilled || existing.verification_status === 'conflicting') {
    status = deriveStatus({
      applicationStart: after.application_start,
      applicationDeadline: after.application_deadline,
      examDate: after.exam_date,
    });
  }

  const update: Record<string, unknown> = {
    ...fills,
    status,
    trust_score: mergedTrust.score,
    source_type: union.some((source) => source.isOfficial) ? 'official' : existing.source_type,
    source_tier: Math.min(Number(existing.source_tier ?? 4), mergedTrust.tier),
    source_urls: JSON.stringify(urls),
    duplicate_count: urls.length,
    conflict_flags: conflictFlags,
    verification_status: verification.outcome,
    last_verified: now,
    next_verification: nextVerificationDate(after.application_deadline ?? null, null),
    source_updated: record.sourceDate ?? existing.source_updated,
    updated_at: now,
  };
  const sets = Object.keys(update).map((key) => `${key} = ?`).join(', ');
  await db.run(`UPDATE opportunities SET ${sets} WHERE id = ?`, [...Object.values(update).map((v) => v ?? null), existing.id]);

  if (['government_job', 'exam'].includes(existing.type) || record.isGovernment) {
    const exam = await db.one<any>('SELECT * FROM government_exams WHERE opportunity_id = ?', [existing.id]);
    if (exam) {
      const examFills = fillBlanks(exam, examContent(record), EXAM_FILL_FIELDS);
      const examAfter = { ...exam, ...examFills };
      const examDatesFilled = ['application_start', 'application_deadline', 'exam_date'].some((field) => field in examFills);
      let examStatus: string = exam.status;
      if (verification.conflicts.length) examStatus = 'needs_verification';
      else if (examDatesFilled || exam.verification_status === 'conflicting') {
        examStatus = deriveStatus({
          applicationStart: examAfter.application_start,
          applicationDeadline: examAfter.application_deadline,
          examDate: examAfter.exam_date,
          admitCardDate: examAfter.admit_card_date,
        });
      }
      const examUpdate: Record<string, unknown> = {
        ...examFills,
        status: examStatus,
        verification_status: verification.outcome,
        trust_score: mergedTrust.score,
        conflict_flags: conflictFlags,
        last_verified: now,
        next_verification: nextVerificationDate(examAfter.application_deadline ?? null, null),
        updated_at: now,
      };
      const examSets = Object.keys(examUpdate).map((key) => `${key} = ?`).join(', ');
      await db.run(`UPDATE government_exams SET ${examSets} WHERE id = ?`, [...Object.values(examUpdate).map((v) => v ?? null), exam.id]);
    } else if (record.isGovernment) {
      await insertRow('government_exams', {
        id: uid(),
        opportunity_id: existing.id,
        exam_name: examNameFor(record),
        exam_code: '',
        organization_type: organisationTypeFor(record),
        post: existing.title,
        ...examContent(record),
        status,
        timeline: JSON.stringify(buildTimeline(record)),
        verification_status: verification.outcome,
        trust_score: mergedTrust.score,
        last_verified: now,
        next_verification: update.next_verification,
        conflict_flags: conflictFlags,
        created_at: now,
        updated_at: now,
      });
    }
  }
  return { id: existing.id, action: 'merged' };
}

function examNameFor(record: NormalizedOpportunity): string {
  return record.title.replace(/\s*(recruitment|notification|apply online|vacancy|vacancies)\s*/gi, ' ').trim().slice(0, 140);
}

function organisationTypeFor(record: NormalizedOpportunity): string {
  const text = `${record.organization} ${record.category}`.toLowerCase();
  if (/bank|ibps|sbi|rbi/.test(text)) return 'banking';
  if (/rrb|railway/.test(text)) return 'railway';
  if (/psc|state/.test(text)) return 'state';
  if (/sebi|nabard|irdai/.test(text)) return 'regulatory';
  if (/university|college|iit|iim/.test(text)) return 'university';
  if (/csir|icmr|isro|drdo|research/.test(text)) return 'research';
  if (/bhel|ongc|ntpc|iocl|psu/.test(text)) return 'psu';
  return 'central';
}

export function buildTimeline(record: NormalizedOpportunity): { stage: string; date: string | null; status: 'done' | 'current' | 'upcoming' | 'unknown' }[] {
  const now = Date.now();
  const entries: { stage: string; date: string | null }[] = [
    { stage: 'Notification', date: record.sourceDate ?? null },
    { stage: 'Application Opens', date: record.applicationStart },
    { stage: 'Application Closes', date: record.applicationDeadline },
    { stage: 'Admit Card', date: null },
    { stage: 'Exam', date: record.examDate },
    { stage: 'Answer Key', date: null },
    { stage: 'Result', date: null },
    { stage: 'Interview', date: null },
    { stage: 'Final Selection', date: null },
  ];
  let seenFuture = false;
  return entries.map((entry) => {
    if (!entry.date) return { ...entry, status: 'unknown' as const };
    const time = new Date(entry.date).getTime();
    if (Number.isNaN(time)) return { ...entry, status: 'unknown' as const };
    if (time < now) return { ...entry, status: 'done' as const };
    if (!seenFuture) {
      seenFuture = true;
      return { ...entry, status: 'current' as const };
    }
    return { ...entry, status: 'upcoming' as const };
  });
}

export { jsonList, canonicalKeyFor };
