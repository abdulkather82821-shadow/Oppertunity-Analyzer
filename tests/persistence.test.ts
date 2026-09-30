import { describe, expect, it } from 'vitest';
import { useTempDb } from './helpers/db';
import { db, jsonDecode } from '@/lib/db';
import { upsertOpportunity, type PersistedSource } from '@/lib/pipeline/research-agent';
import { normaliseHit, type NormalizedOpportunity } from '@/lib/opportunity/normalizer';
import { assessTrust } from '@/lib/opportunity/trust';
import { matchOpportunity, type MatchableRecord } from '@/lib/opportunity/matcher';
import { rankOpportunity } from '@/lib/opportunity/ranker';
import { verifyFromSources } from '@/lib/opportunity/verification';
import { profileCandidate } from '@/lib/analysis/profiler';
import { parseResume } from '@/lib/analysis/resume-parser';

useTempDb();

/**
 * Persistence of discovered opportunities.
 *
 * Governing rule: re-discovery may ADD knowledge to a record but must never ERASE it. A search
 * snippet is a lossy view of a notification, so it may fill a blank, contribute a source or
 * raise a conflict — it may not overwrite a value we already hold, and re-reading our own
 * catalogue must not write anything at all. (A regression here once wiped the deadlines of
 * eleven of twenty catalogue rows after a single search.)
 */

const PROFILE = profileCandidate(
  parseResume('PRIYA RAMESH\nChennai\nEDUCATION\nBachelor of Commerce (B.Com)\nUniversity of Madras - 2025\nSKILLS\nTally ERP 9, MS Excel, GST Filing\n'),
);

function makeRecord(over: Partial<NormalizedOpportunity> = {}): NormalizedOpportunity {
  const base = normaliseHit(
    {
      title: 'SSC Combined Graduate Level Examination 2026',
      url: 'https://ssc.gov.in/cgl-2026',
      snippet: 'Staff Selection Commission invites applications for Combined Graduate Level posts.',
      provider: 'test',
      tier: 1,
    },
    {},
  );
  if (!base) throw new Error('fixture failed to normalise');
  return {
    ...base,
    type: 'exam',
    isGovernment: true,
    organization: 'Staff Selection Commission',
    category: 'ssc',
    applicationDeadline: '2026-11-06T18:29:00.000Z',
    applicationStart: '2026-10-01T00:00:00.000Z',
    examDate: null,
    vacancies: 12256,
    qualification: ["Bachelor's degree"],
    degreeLevels: ['bachelor'],
    officialSource: 'https://ssc.gov.in/cgl-2026',
    applicationUrl: 'https://ssc.gov.in/apply',
    ...over,
  };
}

const source = (url: string, tier: number, claims: Record<string, string>, extra: Partial<PersistedSource> = {}): PersistedSource => ({
  url,
  tier,
  isOfficial: tier === 1,
  sourceDate: null,
  claims,
  title: 'SSC CGL 2026',
  snippet: 'snippet',
  ...extra,
});

function buildInput(record: NormalizedOpportunity, sources: PersistedSource[], opts: { ownIds?: string[]; external?: boolean } = {}) {
  const matchable: MatchableRecord = {
    id: record.canonicalKey,
    title: record.title,
    organization: record.organization,
    type: record.type,
    isGovernment: record.isGovernment,
    degreeLevels: record.degreeLevels,
    qualification: record.qualification,
  };
  const match = matchOpportunity(PROFILE, matchable, {});
  const verification = verifyFromSources(sources);
  const trust = assessTrust({
    title: record.title,
    organization: record.organization,
    officialSource: record.officialSource,
    applicationUrl: record.applicationUrl,
    sourceUrls: sources.map((s) => s.url),
    description: record.description,
    isGovernment: record.isGovernment,
    duplicateCount: sources.length,
  });
  const ranking = rankOpportunity({
    id: record.canonicalKey,
    match,
    trustScore: trust.score,
    verificationStatus: verification.outcome,
    qualityScore: 70,
    applicationDeadline: record.applicationDeadline,
    status: 'applications_open',
  });
  return {
    userId: 'u1',
    searchJobId: 'job1',
    record,
    profile: PROFILE,
    matchable,
    sources,
    groupKey: record.canonicalKey,
    ownIds: opts.ownIds ?? [],
    hasExternalEvidence: opts.external ?? true,
    match,
    trust,
    verification,
    ranking,
    status: 'applications_open',
    nextVerification: '2026-10-05T00:00:00.000Z',
  };
}

const rowOf = (id: string) => db.one<any>('SELECT * FROM opportunities WHERE id = ?', [id]);
const sourceCount = async (id: string) => Number((await db.one<{ n: number }>('SELECT COUNT(*) AS n FROM opportunity_sources WHERE opportunity_id = ?', [id]))?.n);

describe('upsertOpportunity', () => {
  it('inserts a new opportunity keeping every source with its OWN claims', async () => {
    const record = makeRecord({ canonicalKey: 'key-insert' });
    const result = await upsertOpportunity(
      buildInput(record, [
        source('https://ssc.gov.in/cgl-2026', 1, { 'application deadline': '2026-11-06' }),
        source('https://www.freejobalert.com/ssc-cgl', 4, { 'application deadline': '2026-11-08' }),
      ]),
    );
    expect(result.action).toBe('inserted');

    expect(await sourceCount(result.id)).toBe(2);
    const stored = await db.query<any>('SELECT url, claims FROM opportunity_sources WHERE opportunity_id = ? ORDER BY url', [result.id]);
    // Each source asserted a different deadline; neither may be overwritten with a copy of the other.
    const byUrl = Object.fromEntries(stored.map((r) => [r.url, jsonDecode<Record<string, string>>(r.claims, {})]));
    expect(byUrl['https://ssc.gov.in/cgl-2026']['application deadline']).toBe('2026-11-06');
    expect(byUrl['https://www.freejobalert.com/ssc-cgl']['application deadline']).toBe('2026-11-08');

    const row = await rowOf(result.id);
    expect(row.verification_status).toBe('conflicting');
    expect(jsonDecode<any[]>(row.conflict_flags, []).some((c) => /deadline/i.test(c.field))).toBe(true);
    expect(row.duplicate_count).toBe(2);
    expect(row.source_type).toBe('official');

    // Discovered domains are registered so the admin source panel can manage them.
    const domains = (await db.query<{ domain: string }>('SELECT domain FROM sources')).map((r) => r.domain);
    expect(domains).toEqual(expect.arrayContaining(['ssc.gov.in', 'freejobalert.com']));
  });

  it('also creates the exam-tracker record for a government opportunity', async () => {
    const record = makeRecord({ canonicalKey: 'key-exam', title: 'SSC CHSL 2026 Notification' });
    const result = await upsertOpportunity(buildInput(record, [source('https://ssc.gov.in/chsl', 1, {})]));
    const exam = await db.one<any>('SELECT * FROM government_exams WHERE opportunity_id = ?', [result.id]);
    expect(exam).not.toBeNull();
    expect(exam.vacancies).toBe(12256);
    expect(exam.official_notification).toMatch(/ssc\.gov\.in/);
  });

  it('writes NOTHING when the hit is just our own catalogue read back', async () => {
    const record = makeRecord({ canonicalKey: 'key-own' });
    const inserted = await upsertOpportunity(buildInput(record, [source('https://ssc.gov.in/own', 1, { 'application deadline': '2026-11-06' })]));
    const before = await rowOf(inserted.id);
    const sourcesBefore = await sourceCount(inserted.id);

    // The offline provider returns our own row as a thin snippet: no deadline, no vacancies.
    const thin = makeRecord({ canonicalKey: 'key-own', applicationDeadline: null, applicationStart: null, vacancies: null, qualification: [], degreeLevels: [] });
    const result = await upsertOpportunity(
      buildInput(thin, [source('https://ssc.gov.in/own', 1, {})], { ownIds: [inserted.id], external: false }),
    );

    expect(result).toEqual({ id: inserted.id, action: 'unchanged' });
    expect(await rowOf(inserted.id)).toEqual(before); // byte-for-byte, including last_verified
    expect(await sourceCount(inserted.id)).toBe(sourcesBefore);
  });

  it('never erases known fields when a thin external snippet is merged in', async () => {
    const record = makeRecord({ canonicalKey: 'key-merge' });
    const inserted = await upsertOpportunity(buildInput(record, [source('https://ssc.gov.in/m', 1, { 'application deadline': '2026-11-06' })]));
    const before = await rowOf(inserted.id);

    const thin = makeRecord({ canonicalKey: 'key-merge', applicationDeadline: null, applicationStart: null, vacancies: null, qualification: [], degreeLevels: [], organization: '' });
    const result = await upsertOpportunity(buildInput(thin, [source('https://news.example.in/ssc', 3, {})]));
    expect(result).toEqual({ id: inserted.id, action: 'merged' });

    const after = await rowOf(inserted.id);
    for (const field of ['application_deadline', 'application_start', 'vacancies', 'qualification', 'degree_levels', 'organization', 'title']) {
      expect(after[field], field).toEqual(before[field]);
    }
    // The previously known source is kept and the new one is added, not swapped in.
    expect(await sourceCount(inserted.id)).toBe(2);
    expect(after.duplicate_count).toBe(2);
    // It WAS re-checked against a real source, so the verification stamp advances.
    expect(after.last_verified >= before.last_verified).toBe(true);
  });

  it('fills a blank field but never overwrites a known value, flagging disagreement instead', async () => {
    const record = makeRecord({ canonicalKey: 'key-fill', examDate: null });
    const inserted = await upsertOpportunity(buildInput(record, [source('https://ssc.gov.in/f', 1, { 'application deadline': '2026-11-06' })]));
    const before = await rowOf(inserted.id);
    expect(before.exam_date).toBeNull();

    const richer = makeRecord({ canonicalKey: 'key-fill', examDate: '2026-12-15T00:00:00.000Z', applicationDeadline: '2026-11-09T18:29:00.000Z' });
    await upsertOpportunity(buildInput(richer, [source('https://blog.example.in/ssc', 4, { 'application deadline': '2026-11-09' })]));

    const after = await rowOf(inserted.id);
    expect(after.exam_date).toBe('2026-12-15T00:00:00.000Z'); // blank → filled
    expect(after.application_deadline).toBe(before.application_deadline); // known → kept
    // The two sources now disagree, and that is surfaced rather than silently resolved.
    expect(after.verification_status).toBe('conflicting');
    expect(after.status).toBe('needs_verification');
    const flags = jsonDecode<any[]>(after.conflict_flags, []);
    const deadline = flags.find((c) => /deadline/i.test(c.field));
    expect(deadline).toBeDefined();
    expect(deadline.values.map((v: any) => v.value)).toEqual(expect.arrayContaining(['2026-11-06', '2026-11-09']));
  });

  it('merges claims of an already-known source instead of duplicating or dropping it', async () => {
    const record = makeRecord({ canonicalKey: 'key-same-source' });
    const inserted = await upsertOpportunity(buildInput(record, [source('https://ssc.gov.in/s', 1, { 'application deadline': '2026-11-06' })]));
    await upsertOpportunity(buildInput(record, [source('https://ssc.gov.in/s', 1, { vacancies: '12256' })]));

    expect(await sourceCount(inserted.id)).toBe(1);
    const stored = await db.one<any>('SELECT claims FROM opportunity_sources WHERE opportunity_id = ?', [inserted.id]);
    expect(jsonDecode<Record<string, string>>(stored.claims, {})).toEqual({ 'application deadline': '2026-11-06', vacancies: '12256' });
  });

  it('does not resurrect a catalogue row that was deleted', async () => {
    const thin = makeRecord({ canonicalKey: 'key-ghost', applicationDeadline: null });
    const result = await upsertOpportunity(buildInput(thin, [source('https://ssc.gov.in/g', 1, {})], { ownIds: ['no-such-id'], external: false }));
    expect(result.action).toBe('unchanged');
    expect(await db.one('SELECT id FROM opportunities WHERE canonical_key = ?', ['key-ghost'])).toBeNull();
  });
});
