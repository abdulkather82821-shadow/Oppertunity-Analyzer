import { db, jsonList, nowIso, uid } from '@/lib/db';
import { parseIstDate } from './deadline';
import { isOfficialDomain, tierForUrl } from './trust';

/**
 * Multi-source verification.
 *
 * For every time-sensitive field we compare what each source asserted. Where sources
 * disagree the record is flagged `conflicting` and the UI shows both values side by side
 * with the authoritative one identified. We never silently pick a winner, and we never
 * present an unverified value as certain.
 */

export interface SourceClaim {
  url: string;
  tier: number;
  isOfficial: boolean;
  sourceDate: string | null;
  claims: Record<string, string>;
}

export interface FieldVerification {
  field: string;
  chosen: string | null;
  confidence: 'official' | 'corroborated' | 'single_source' | 'conflicting' | 'unknown';
  values: { value: string; url: string; tier: number; isOfficial: boolean }[];
  note: string;
}

export interface VerificationReport {
  outcome: 'verified' | 'needs_verification' | 'conflicting' | 'suspicious';
  fields: FieldVerification[];
  conflicts: FieldVerification[];
  checkedAt: string;
  sourceCount: number;
  bestTier: number;
  summary: string;
}

const VERIFIABLE_FIELDS = ['application deadline', 'application start', 'exam date', 'vacancies', 'age limit'] as const;

export function verifyFromSources(sources: SourceClaim[]): VerificationReport {
  const fields: FieldVerification[] = [];
  const officialSources = sources.filter((s) => s.isOfficial);
  const bestTier = sources.length ? Math.min(...sources.map((s) => s.tier)) : 4;

  for (const field of VERIFIABLE_FIELDS) {
    const entries = sources
      .map((source) => ({ value: source.claims[field], source }))
      .filter((entry): entry is { value: string; source: SourceClaim } => Boolean(entry.value));

    if (entries.length === 0) {
      fields.push({
        field,
        chosen: null,
        confidence: 'unknown',
        values: [],
        note: 'No source stated this field.',
      });
      continue;
    }

    // Normalise dates so "20/09/2026" and "2026-09-20" compare equal.
    const normalise = (value: string) => {
      const parsed = parseIstDate(value, true);
      return parsed ? parsed.toISOString().slice(0, 10) : value.trim().toLowerCase();
    };

    const grouped = new Map<string, { value: string; url: string; tier: number; isOfficial: boolean }[]>();
    for (const entry of entries) {
      const key = normalise(entry.value);
      const bucket = grouped.get(key) ?? [];
      bucket.push({
        value: normalise(entry.value),
        url: entry.source.url,
        tier: entry.source.tier,
        isOfficial: entry.source.isOfficial,
      });
      grouped.set(key, bucket);
    }

    const distinctValues = [...grouped.values()];
    const values = distinctValues.flat();

    if (distinctValues.length === 1) {
      const only = distinctValues[0][0];
      fields.push({
        field,
        chosen: only.value,
        confidence: only.isOfficial ? 'official' : entries.length > 1 ? 'corroborated' : 'single_source',
        values,
        note: only.isOfficial
          ? 'Stated by the official source.'
          : entries.length > 1
            ? `Consistent across ${entries.length} sources.`
            : 'Only one source states this — verify before relying on it.',
      });
      continue;
    }

    // Sources disagree → never silently choose. Identify the authoritative one if it exists.
    const officialValues = distinctValues.filter((group) => group.some((v) => v.isOfficial));
    const chosen = officialValues.length ? officialValues[0][0].value : null;
    const lowestTier = Math.min(...distinctValues.map((group) => Math.min(...group.map((v) => v.tier))));
    fields.push({
      field,
      chosen,
      confidence: 'conflicting',
      values,
      note: officialValues.length
        ? `Sources disagree. The official notification (${officialValues[0][0].value}) is authoritative.`
        : `Sources disagree (${distinctValues.map((g) => g[0].value).join(' vs ')}). No official source available — the lowest-tier source says ${
            distinctValues.find((g) => g.some((v) => v.tier === lowestTier))?.[0].value ?? 'unknown'
          }.`,
    });
  }

  const conflicts = fields.filter((f) => f.confidence === 'conflicting');
  const hasOfficial = officialSources.length > 0;

  let outcome: VerificationReport['outcome'];
  if (conflicts.length > 0) outcome = 'conflicting';
  else if (hasOfficial && fields.some((f) => f.confidence === 'official')) outcome = 'verified';
  else if (sources.length >= 2 && fields.some((f) => f.confidence === 'corroborated')) outcome = 'needs_verification';
  else outcome = 'needs_verification';

  const summary =
    outcome === 'verified'
      ? 'Key details confirmed against an official source.'
      : outcome === 'conflicting'
        ? `Conflicting information detected for: ${conflicts.map((c) => c.field).join(', ')}.`
        : sources.length === 0
          ? 'No sources captured for this record.'
          : `Corroborated across ${sources.length} source(s) but no official page — verify before applying.`;

  return {
    outcome,
    fields,
    conflicts,
    checkedAt: nowIso(),
    sourceCount: sources.length,
    bestTier,
    summary,
  };
}

/** Loads the stored per-source claims for an opportunity and re-runs verification. */
export async function verifyOpportunity(opportunityId: string): Promise<VerificationReport | null> {
  const rows = await db.query(
    `SELECT url, tier, claims, source_date FROM opportunity_sources WHERE opportunity_id = ?`,
    [opportunityId],
  );
  if (rows.length === 0) return null;
  const sources: SourceClaim[] = rows.map((row: any) => ({
    url: row.url,
    tier: Number(row.tier ?? 4),
    isOfficial: isOfficialDomain(row.url).official,
    sourceDate: row.source_date ?? null,
    claims: typeof row.claims === 'string' ? safeParse(row.claims) : (row.claims ?? {}),
  }));
  return verifyFromSources(sources);
}

/** Persists a verification run and updates the parent record's status. */
export async function persistVerification(target: { opportunityId?: string; examId?: string }, report: VerificationReport): Promise<void> {
  await db.run(
    `INSERT INTO verification_runs (id, opportunity_id, exam_id, checked_fields, agreements, conflicts, outcome, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uid(),
      target.opportunityId ?? null,
      target.examId ?? null,
      JSON.stringify(report.fields.map((f) => f.field)),
      JSON.stringify(report.fields.filter((f) => f.confidence !== 'conflicting')),
      JSON.stringify(report.conflicts),
      report.outcome,
      report.checkedAt,
    ],
  );
  const conflictFlags = JSON.stringify(report.conflicts.map((c) => ({ field: c.field, values: c.values })));
  if (target.opportunityId) {
    await db.run(
      `UPDATE opportunities SET verification_status = ?, conflict_flags = ?, last_verified = ?, updated_at = ? WHERE id = ?`,
      [report.outcome, conflictFlags, report.checkedAt, nowIso(), target.opportunityId],
    );
  }
  if (target.examId) {
    await db.run(
      `UPDATE government_exams SET verification_status = ?, conflict_flags = ?, last_verified = ?, updated_at = ? WHERE id = ?`,
      [report.outcome, conflictFlags, report.checkedAt, nowIso(), target.examId],
    );
  }
}

function safeParse(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export { jsonList, tierForUrl };
