import { createHash } from 'node:crypto';
import { parseIstDate } from './deadline';

/**
 * Duplicate detection and merging.
 *
 * The same notification is syndicated across dozens of sites. We group by a normalised
 * fingerprint (title + organisation + post) and use official identifiers (notification
 * number, recruitment ID) as a strong signal. Deadlines are compared, never averaged —
 * a disagreement is surfaced as a conflict rather than silently resolved.
 */

export interface DedupeCandidate {
  id: string;
  title: string;
  organization: string;
  post?: string;
  category?: string;
  location?: string;
  applicationDeadline?: string | null;
  examDate?: string | null;
  notificationNumber?: string | null;
  officialSource?: string | null;
  sourceUrls?: string[];
  sourceTier?: number;
  trustScore?: number;
  isGovernment?: boolean;
}

export interface DedupeGroup {
  key: string;
  representative: DedupeCandidate;
  members: DedupeCandidate[];
  sourceCount: number;
  conflicts: ConflictRecord[];
}

export interface ConflictRecord {
  field: string;
  values: { value: string; sourceUrl: string; tier: number; isOfficial: boolean }[];
  resolution: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'for', 'of', 'in', 'on', 'at', 'and', 'or', 'to', 'by', 'apply', 'online',
  'recruitment', 'notification', 'vacancy', 'vacancies', 'posts', 'post', 'jobs', 'job', 'exam',
  'examination', '2024', '2025', '2026', '2027', 'latest', 'new', 'govt', 'government',
]);

export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\((?:[^)]*)\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .slice(0, 8)
    .sort()
    .join(' ');
}

export function normaliseOrganisation(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(limited|ltd|private|pvt|inc|incorporated|corporation|company|the)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .sort()
    .join(' ');
}

export function fingerprint(candidate: DedupeCandidate): string {
  const titleKey = normaliseTitle(candidate.title);
  const orgKey = normaliseOrganisation(candidate.organization);
  // Official notification numbers are the most reliable identity signal there is.
  const notificationKey = candidate.notificationNumber
    ? candidate.notificationNumber.toLowerCase().replace(/[^a-z0-9/]/g, '')
    : '';
  const raw = notificationKey
    ? `${candidate.category ?? ''}|${notificationKey}`
    : `${titleKey}|${orgKey}|${candidate.category ?? ''}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 20);
}

/** Jaccard similarity of title tokens — used to catch near-duplicates with different wording. */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(normaliseTitle(a).split(' ').filter(Boolean));
  const setB = new Set(normaliseTitle(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function detectConflicts(members: DedupeCandidate[]): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];

  const collect = (field: string, pick: (m: DedupeCandidate) => string | null | undefined, format: (value: string) => string) => {
    const values: ConflictRecord['values'] = [];
    const seen = new Set<string>();
    for (const member of members) {
      const raw = pick(member);
      if (!raw) continue;
      const parsed = field.includes('ate') ? parseIstDate(raw, true) : null;
      const key = parsed ? parsed.toISOString().slice(0, 10) : raw.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const official = Boolean(member.officialSource && /\.gov\.in|\.nic\.in/.test(member.officialSource));
      values.push({
        value: format(parsed ? parsed.toISOString() : raw),
        sourceUrl: member.officialSource ?? member.sourceUrls?.[0] ?? member.id,
        tier: member.sourceTier ?? 4,
        isOfficial: official,
      });
    }
    if (values.length > 1) {
      const official = values.filter((v) => v.isOfficial);
      const bestTier = Math.min(...values.map((v) => v.tier));
      const authoritative = official.length ? official : values.filter((v) => v.tier === bestTier);
      conflicts.push({
        field,
        values,
        resolution: official.length
          ? `Official notification is authoritative — using ${authoritative[0].value}.`
          : `No official source available. Lowest-tier source says ${authoritative[0].value}; treat as unverified.`,
      });
    }
  };

  collect(
    'application deadline',
    (m) => m.applicationDeadline,
    (value) => value.slice(0, 10),
  );
  collect(
    'exam date',
    (m) => m.examDate,
    (value) => value.slice(0, 10),
  );
  return conflicts;
}

/**
 * Chooses the record that best represents the group: prefer the entry backed by an
 * official source, then the lowest source tier, then the highest trust score.
 */
export function chooseRepresentative(members: DedupeCandidate[]): DedupeCandidate {
  const scored = members.map((member) => {
    const official = member.officialSource && /\.gov\.in|\.nic\.in/.test(member.officialSource) ? 1000 : 0;
    return { member, score: official - (member.sourceTier ?? 4) * 100 + (member.trustScore ?? 50) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.member ?? members[0];
}

export function groupDuplicates(candidates: DedupeCandidate[]): DedupeGroup[] {
  const groups = new Map<string, DedupeCandidate[]>();
  for (const candidate of candidates) {
    const key = fingerprint(candidate);
    const bucket = groups.get(key) ?? [];
    bucket.push(candidate);
    groups.set(key, bucket);
  }

  // Second pass: merge groups whose representative titles are near-identical.
  const keys = [...groups.keys()];
  const parent = new Map<string, string>(keys.map((k) => [k, k]));
  const find = (key: string): string => {
    let current = key;
    while (parent.get(current) !== current) current = parent.get(current)!;
    return current;
  };
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = chooseRepresentative(groups.get(keys[i])!);
      const b = chooseRepresentative(groups.get(keys[j])!);
      if (normaliseOrganisation(a.organization) !== normaliseOrganisation(b.organization)) continue;
      if (titleSimilarity(a.title, b.title) < 0.72) continue;
      const rootA = find(keys[i]);
      const rootB = find(keys[j]);
      if (rootA !== rootB) parent.set(rootB, rootA);
    }
  }

  const merged = new Map<string, DedupeCandidate[]>();
  for (const key of keys) {
    const root = find(key);
    merged.set(root, [...(merged.get(root) ?? []), ...groups.get(key)!]);
  }

  const out: DedupeGroup[] = [];
  for (const [key, members] of merged) {
    const sourceUrls = new Set<string>();
    for (const member of members) {
      if (member.officialSource) sourceUrls.add(member.officialSource);
      for (const url of member.sourceUrls ?? []) sourceUrls.add(url);
    }
    out.push({
      key,
      representative: chooseRepresentative(members),
      members,
      sourceCount: Math.max(members.length, sourceUrls.size),
      conflicts: detectConflicts(members),
    });
  }
  return out.sort((a, b) => b.sourceCount - a.sourceCount);
}
