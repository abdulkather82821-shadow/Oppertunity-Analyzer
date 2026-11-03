import { DEGREE_LEVEL_RANK, DEGREE_PATTERNS, SKILL_TAXONOMY, type DegreeLevel } from '@/lib/analysis/taxonomy';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import { daysRemaining } from './deadline';
import { configWeights } from '@/lib/config';

/**
 * Opportunity matching.
 *
 * Two scoring models:
 *   • private-sector opportunities → weighted fit model (skills, qualification, experience…)
 *   • government exams             → eligibility-first model (an exam you are ineligible for
 *                                     scores zero no matter how well the skills overlap)
 * Weights are configurable per user (user_settings.scoring_weights) and by super admin
 * (platform_config), which is why they are read at call time rather than hard-coded.
 */

export interface MatchBreakdown {
  education: number;
  skill: number;
  experience: number;
  location: number;
  role: number;
  industry: number;
  eligibility: number;
  salary: number;
  careerGrowth: number;
}

export interface MatchResult {
  overall: number;
  band: MatchBand;
  label: string;
  breakdown: MatchBreakdown;
  weights: Record<string, number>;
  matchedSkills: string[];
  missingSkills: string[];
  eligible: EligibilityVerdict;
  reasons: string[];
  model: 'private' | 'government';
}

export type MatchBand = 'perfect' | 'strong' | 'good' | 'possible' | 'gap' | 'not_eligible';

export const BAND_META: Record<MatchBand, { label: string; icon: string; tone: string }> = {
  perfect: { label: 'Perfect Match', icon: '🏆', tone: 'success' },
  strong: { label: 'Strong Match', icon: '🔥', tone: 'success' },
  good: { label: 'Good Match', icon: '👍', tone: 'info' },
  possible: { label: 'Possible Match', icon: '📌', tone: 'neutral' },
  gap: { label: 'Skill Gap', icon: '⚠️', tone: 'warning' },
  not_eligible: { label: 'Not Eligible', icon: '❌', tone: 'danger' },
};

export const DEFAULT_WEIGHTS = {
  skill: 30,
  qualification: 20,
  experience: 15,
  role: 15,
  location: 5,
  industry: 5,
  salary: 5,
  careerGrowth: 5,
} as const;

export type WeightKey = keyof typeof DEFAULT_WEIGHTS;

export function normaliseWeights(input: unknown): Record<WeightKey, number> {
  // The administrator's default weights (if configured) replace the built-in ones; a user's own
  // weights then override those, key by key.
  const weights = { ...DEFAULT_WEIGHTS, ...(configWeights() ?? {}) } as Record<WeightKey, number>;
  if (input && typeof input === 'object') {
    const parsed = typeof input === 'string' ? safeParse(input) : input;
    if (parsed && typeof parsed === 'object') {
      for (const key of Object.keys(DEFAULT_WEIGHTS) as WeightKey[]) {
        const value = Number((parsed as Record<string, unknown>)[key]);
        if (Number.isFinite(value) && value >= 0 && value <= 100) weights[key] = value;
      }
    }
  }
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS } as Record<WeightKey, number>;
  // Normalise to 100 so partial user configs still produce a 0–100 score.
  for (const key of Object.keys(weights) as WeightKey[]) weights[key] = (weights[key] / total) * 100;
  return weights;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Shape shared by opportunities and government exams so one matcher serves both. */
export interface MatchableRecord {
  id: string;
  title: string;
  organization?: string;
  type?: string;
  category?: string;
  jobFamily?: string;
  locations?: string[];
  workMode?: string;
  qualification?: string[];
  degreeLevels?: string[];
  fieldsOfStudy?: string[];
  skills?: string[];
  experienceMinYears?: number | null;
  experienceMaxYears?: number | null;
  isFresherFriendly?: boolean;
  salaryMin?: number | null;
  salaryMax?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  experienceRequired?: string;
  nationality?: string;
  applicationDeadline?: string | null;
  status?: string;
  isGovernment?: boolean;
}

export type EligibilityVerdict = 'eligible' | 'probably_eligible' | 'not_eligible' | 'unknown';

export const ELIGIBILITY_META: Record<EligibilityVerdict, { label: string; tone: string }> = {
  eligible: { label: 'Eligible', tone: 'success' },
  probably_eligible: { label: 'Probably Eligible — Verify Notification', tone: 'warning' },
  not_eligible: { label: 'Not Eligible', tone: 'danger' },
  unknown: { label: 'Eligibility Unknown', tone: 'neutral' },
};

export interface EligibilityResult {
  verdict: EligibilityVerdict;
  score: number; // 0-100
  reasons: string[];
  blockers: string[];
  assumptions: string[];
  checks: { field: string; requirement: string; candidate: string; outcome: 'pass' | 'fail' | 'unknown' }[];
}

/**
 * Rule-based eligibility validation.
 * Every check is explicit and reported, so the UI can show *why* — and because legal
 * eligibility often depends on clauses in the notification, anything ambiguous resolves
 * to `probably_eligible` rather than a definitive claim.
 */
/**
 * Degree requirements.
 *
 * A posting's qualification list is a set of ALTERNATIVES — "B.Com / M.Com / MBA" means any one
 * of them will do — and the free text is messy: "Bachelor's degree in any stream", "Graduation
 * in any stream from a recognised university", "MBA/PGDM", "BE/B.Tech". Each item is resolved
 * into alternatives of two kinds:
 *
 *   • level-only    "Bachelor's degree", "Diploma", "Any degree"  → satisfied by rank alone
 *   • named degree  "B.Com", "MBA", "CA", "MBBS"                  → needs that degree (or a
 *                   higher degree in the same stream, e.g. M.Com satisfies B.Com)
 *
 * The requirement is met if ANY alternative is met. Text that resolves to nothing is reported
 * as uninterpretable — never turned into an invented requirement, and never a blocker.
 */
interface DegreeAlternative {
  text: string;
  level: DegreeLevel;
  /** Canonical degree name for a named alternative; absent for level-only alternatives. */
  named?: string;
  /** True when no stream is imposed ("any degree"), as opposed to "degree in Law / Engineering". */
  anyStream?: boolean;
}

/** Word-based phrases that express a level without naming a specific degree. */
const LEVEL_PHRASES: { pattern: RegExp; level: DegreeLevel }[] = [
  { pattern: /\b(ph\.?\s?d|doctorate|doctoral)\b/i, level: 'doctorate' },
  { pattern: /\b(post\s?graduate|postgraduate|pg|masters?|master'?s)\b/i, level: 'master' },
  { pattern: /\b(under\s?graduate|undergraduate|bachelor'?s?|graduat(?:e|ion)|any degree|degree)\b/i, level: 'bachelor' },
  { pattern: /\b(diploma|iti|polytechnic)\b/i, level: 'diploma' },
  { pattern: /\b(10th|12th|sslc|hsc|higher secondary)\b/i, level: 'school' },
];

/** Degree names that express a level rather than a specific stream. */
const GENERIC_DEGREE_NAMES = new Set([
  "Bachelor's Degree",
  "Master's Degree",
  'Professional Certification',
  'Diploma',
  'SSLC (10th)',
  'Higher Secondary (12th)',
]);

/** A higher degree in the same stream satisfies the lower named requirement. */
const SAME_STREAM_HIGHER: Record<string, string[]> = {
  'B.Com': ['M.Com'],
  'B.Sc': ['M.Sc'],
  'B.A': ['M.A'],
  'B.Tech': ['M.Tech'],
  'LL.B': ['LL.M'],
  BCA: ['MCA'],
  BBA: ['MBA'],
};

export interface DegreeRequirement {
  alternatives: DegreeAlternative[];
  /** Requirement text that could not be interpreted at all. */
  unresolved: string[];
}

export function resolveDegreeRequirement(values: (string | null | undefined)[]): DegreeRequirement {
  const alternatives: DegreeAlternative[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const add = (alt: DegreeAlternative) => {
    const key = `${alt.named ?? alt.level}|${alt.named ? '' : alt.anyStream ? 'any' : 'stream'}`;
    if (seen.has(key)) return;
    seen.add(key);
    alternatives.push(alt);
  };

  for (const raw of values) {
    const text = (raw ?? '').trim();
    if (!text) continue;

    // Already a canonical level key.
    if (text in DEGREE_LEVEL_RANK) {
      add({ text, level: text as DegreeLevel, anyStream: true });
      continue;
    }

    let matched = false;
    for (const rule of DEGREE_PATTERNS) {
      if (!rule.pattern.test(text)) continue;
      matched = true;
      if (GENERIC_DEGREE_NAMES.has(rule.canonical)) continue; // handled as a level phrase below
      add({ text, level: rule.level, named: rule.canonical });
    }
    // "Degree in Law / Engineering" names streams; "Bachelor's degree" / "any degree" do not.
    const restrictsStream = /\b(?:degree|graduation|graduate|bachelor'?s?)\s+(?:in|of)\s+(?!any\b)[a-z]/i.test(text);
    for (const phrase of LEVEL_PHRASES) {
      if (!phrase.pattern.test(text)) continue;
      matched = true;
      add({ text, level: phrase.level, anyStream: !restrictsStream });
    }
    if (!matched) unresolved.push(text);
  }
  return { alternatives, unresolved };
}

export function resolveDegreeLevels(values: (string | null | undefined)[]): DegreeLevel[] {
  return [...new Set(resolveDegreeRequirement(values).alternatives.map((alt) => alt.level))];
}

/** True when the candidate's qualifications satisfy one alternative. */
function meetsAlternative(alt: DegreeAlternative, candidateLevel: DegreeLevel, heldDegrees: string[]): boolean {
  if (!alt.named) return DEGREE_LEVEL_RANK[candidateLevel] >= DEGREE_LEVEL_RANK[alt.level];
  const accepted = [alt.named, ...(SAME_STREAM_HIGHER[alt.named] ?? [])].map((name) => name.toLowerCase());
  return heldDegrees.some((held) => accepted.some((name) => held.includes(name)));
}

export function checkEligibility(profile: CandidateProfileData, record: MatchableRecord): EligibilityResult {
  const checks: EligibilityResult['checks'] = [];
  const blockers: string[] = [];
  const assumptions: string[] = [];

  // --- Education -----------------------------------------------------------
  // `qualification` (specific, human-written) is preferred; structured `degreeLevels` are only
  // a fallback, because they are derived from it and would otherwise add redundant level-only
  // alternatives that wrongly bypass a named requirement such as MBBS.
  const qualificationText = (record.qualification ?? []).filter(Boolean) as string[];
  const structuredLevels = (record.degreeLevels ?? []).filter(Boolean) as string[];
  let requirement = resolveDegreeRequirement(qualificationText);
  if (requirement.alternatives.length === 0) {
    const fromLevels = resolveDegreeRequirement(structuredLevels);
    requirement = { alternatives: fromLevels.alternatives, unresolved: requirement.unresolved.length ? requirement.unresolved : fromLevels.unresolved };
  }
  const rawRequirement = [...qualificationText, ...(qualificationText.length ? [] : structuredLevels)];
  const candidateLevel = profile.highestDegreeLevel || null;
  const heldDegrees = profile.education.map((entry) => `${entry.degree} ${entry.specialization ?? ''}`.toLowerCase());
  let genericStreamFreeMet = false;

  if (requirement.alternatives.length === 0 && requirement.unresolved.length > 0) {
    // The posting states a requirement we could not interpret. Guessing a level would either
    // wrongly reject or wrongly approve, so it is reported as unverified.
    checks.push({ field: 'Education', requirement: rawRequirement.join(' / '), candidate: candidateLevel ?? 'not detected', outcome: 'unknown' });
    assumptions.push(`The qualification requirement "${rawRequirement.join(' / ')}" could not be interpreted, so education eligibility is unverified.`);
  } else if (requirement.alternatives.length > 0 && candidateLevel) {
    const met = requirement.alternatives.filter((alt) => meetsAlternative(alt, candidateLevel, heldDegrees));
    const pass = met.length > 0;
    genericStreamFreeMet = met.some((alt) => !alt.named && alt.anyStream);
    const held = profile.education.map((entry) => entry.degree).join(', ') || candidateLevel;
    checks.push({
      field: 'Education',
      requirement: rawRequirement.join(' / '),
      candidate: held,
      outcome: pass ? 'pass' : 'fail',
    });
    if (!pass) {
      const named = [...new Set(requirement.alternatives.filter((alt) => alt.named).map((alt) => alt.named as string))];
      const levelOnly = requirement.alternatives.filter((alt) => !alt.named);
      const lowest = levelOnly.length ? levelOnly.reduce((a, b) => (DEGREE_LEVEL_RANK[a.level] <= DEGREE_LEVEL_RANK[b.level] ? a : b)).level : null;
      const LEVEL_WORDS: Record<DegreeLevel, string> = {
        school: 'a school-level qualification or higher',
        diploma: 'a diploma or higher',
        bachelor: "a bachelor's degree or higher",
        professional: 'a professional qualification or higher',
        master: "a master's degree or higher",
        doctorate: 'a doctorate',
      };
      const parts = [...(lowest ? [LEVEL_WORDS[lowest]] : []), ...(named.length ? [named.length > 1 ? `one of ${named.join(' / ')}` : named[0]] : [])];
      blockers.push(`Requires ${parts.join(', or ')}; the resume shows ${held}.`);
    }
  } else if (requirement.alternatives.length > 0 && !candidateLevel) {
    checks.push({ field: 'Education', requirement: rawRequirement.join(' / '), candidate: 'not detected', outcome: 'unknown' });
    assumptions.push('Education level could not be detected in the resume — education eligibility is unverified.');
  } else {
    checks.push({ field: 'Education', requirement: 'not specified', candidate: candidateLevel ?? 'not detected', outcome: 'unknown' });
  }

  // --- Field of study ------------------------------------------------------
  const requiredFields = (record.fieldsOfStudy ?? []).map((f) => f.toLowerCase()).filter(Boolean);
  if (requiredFields.length > 0) {
    const candidateFields = profile.fieldsOfStudy.map((f) => f.toLowerCase());
    const overlap = requiredFields.filter((field) => candidateFields.some((candidate) => fieldIncludes(candidate, field) || fieldIncludes(field, candidate)));
    // The listed fields are usually derived from the named degrees in the posting. When the
    // posting ALSO accepts any degree at the right level ("MBA / BBA / Bachelor's degree"), the
    // derived field list is not a restriction and must not block or be reported as a failure.
    const pass = overlap.length > 0 || genericStreamFreeMet;
    checks.push({
      field: 'Field of study',
      requirement: genericStreamFreeMet && overlap.length === 0 ? `${requiredFields.join(', ')} (any stream accepted)` : requiredFields.join(', '),
      candidate: candidateFields.join(', ') || 'not detected',
      outcome: genericStreamFreeMet ? 'pass' : candidateFields.length === 0 ? 'unknown' : pass ? 'pass' : 'fail',
    });
    if (!pass && candidateFields.length > 0) {
      blockers.push(`Requires a ${requiredFields.join('/')} background; the resume shows ${candidateFields.join(', ')}.`);
    }
    if (candidateFields.length === 0) assumptions.push('Field of study could not be extracted, so stream requirements are unverified.');
  }

  // --- Age ------------------------------------------------------------------
  if (record.ageMin != null || record.ageMax != null) {
    const age = profile.personal.ageYears;
    if (age == null) {
      checks.push({
        field: 'Age',
        requirement: `${record.ageMin ?? '—'}–${record.ageMax ?? '—'} years`,
        candidate: 'date of birth not in resume',
        outcome: 'unknown',
      });
      assumptions.push('Age limit could not be checked — the resume does not contain a date of birth.');
    } else {
      const tooYoung = record.ageMin != null && age < record.ageMin;
      const tooOld = record.ageMax != null && age > record.ageMax;
      const pass = !tooYoung && !tooOld;
      checks.push({
        field: 'Age',
        requirement: `${record.ageMin ?? '—'}–${record.ageMax ?? '—'} years`,
        candidate: `${age} years`,
        outcome: pass ? 'pass' : 'fail',
      });
      if (tooYoung) blockers.push(`Minimum age is ${record.ageMin}; the candidate is ${age}.`);
      if (tooOld) blockers.push(`Maximum age is ${record.ageMax} (before category relaxation); the candidate is ${age}.`);
      if (tooOld) assumptions.push('Category-based age relaxation may apply — verify against the official notification.');
    }
  }

  // --- Experience -----------------------------------------------------------
  const candidateYears = profile.personal.totalExperienceYears ?? 0;
  if (record.experienceMinYears != null && record.experienceMinYears > 0) {
    const pass = candidateYears >= record.experienceMinYears;
    checks.push({
      field: 'Experience',
      requirement: `${record.experienceMinYears}+ years`,
      candidate: `${candidateYears} years`,
      outcome: pass ? 'pass' : 'fail',
    });
    if (!pass) blockers.push(`Requires ${record.experienceMinYears}+ years of experience; the resume shows ${candidateYears}.`);
  } else if (record.experienceRequired && /\b\d/.test(record.experienceRequired)) {
    checks.push({ field: 'Experience', requirement: record.experienceRequired, candidate: `${candidateYears} years`, outcome: 'unknown' });
    assumptions.push(`Experience requirement stated as "${record.experienceRequired}" — interpreted conservatively.`);
  } else if (record.isFresherFriendly) {
    // A stated "freshers eligible" requirement that the candidate satisfies.
    checks.push({ field: 'Experience', requirement: 'freshers eligible', candidate: `${candidateYears} years`, outcome: 'pass' });
  } else {
    // No experience requirement was published. Reporting 'pass' here would claim a check that
    // never happened, so it is recorded as unverified.
    checks.push({ field: 'Experience', requirement: 'not specified', candidate: `${candidateYears} years`, outcome: 'unknown' });
  }

  // --- Nationality -----------------------------------------------------------
  if (record.nationality && /indian/i.test(record.nationality)) {
    checks.push({ field: 'Nationality', requirement: record.nationality, candidate: 'not stated in resume', outcome: 'unknown' });
    assumptions.push('Nationality is not stated on a resume — confirm you meet the nationality requirement in the notification.');
  }

  const failed = checks.filter((c) => c.outcome === 'fail').length;
  const unknown = checks.filter((c) => c.outcome === 'unknown').length;
  const passed = checks.filter((c) => c.outcome === 'pass').length;
  const total = Math.max(1, checks.length);

  let verdict: EligibilityVerdict;
  if (blockers.length > 0) verdict = 'not_eligible';
  else if (unknown > 0) verdict = 'probably_eligible';
  else if (passed === 0) verdict = 'unknown';
  else verdict = 'eligible';

  const score = Math.round(((passed + unknown * 0.5) / total) * 100);
  const reasons = [
    ...checks.filter((c) => c.outcome === 'pass').map((c) => `✓ ${c.field}: ${c.candidate} meets "${c.requirement}"`),
    ...blockers.map((b) => `✗ ${b}`),
    ...assumptions.map((a) => `? ${a}`),
  ];

  return { verdict, score, reasons, blockers, assumptions, checks };
}

function fieldIncludes(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.includes(needle) || needle.includes(haystack);
}

// --------------------------------------------------------------------------
// Skill matching
// --------------------------------------------------------------------------

export interface SkillMatchResult {
  score: number;
  matched: string[];
  missing: string[];
  coverage: number;
}

/** Bidirectional skill overlap: how much of the job the candidate covers, and vice versa. */
export function matchSkills(candidateSkills: string[], requiredSkills: string[]): SkillMatchResult {
  const normalise = (value: string) => value.trim().toLowerCase();
  const candidateSet = new Set(candidateSkills.map(normalise));
  const candidateAliases = new Map<string, string[]>();
  for (const skill of candidateSkills) {
    const entry = SKILL_TAXONOMY.find((s) => s.canonical.toLowerCase() === normalise(skill));
    if (entry) candidateAliases.set(normalise(entry.canonical), [entry.canonical.toLowerCase(), ...entry.aliases.map((a) => a.toLowerCase())]);
  }

  const matched: string[] = [];
  const missing: string[] = [];
  for (const required of requiredSkills) {
    const key = normalise(required);
    if (!key || key.length < 2) continue;
    const aliases = candidateAliases.get(key);
    const hit =
      candidateSet.has(key) ||
      (aliases?.some((alias) => candidateSet.has(alias)) ?? false) ||
      [...candidateSet].some((candidate) => candidate === key || candidate.includes(key) || key.includes(candidate));
    if (hit) matched.push(required);
    else missing.push(required);
  }

  const totalRequired = matched.length + missing.length;
  const coverage = totalRequired === 0 ? 0 : matched.length / totalRequired;
  const score = totalRequired === 0 ? 0.5 : Math.round(coverage * 100);
  return { score, matched, missing, coverage };
}

// --------------------------------------------------------------------------
// Individual dimensions
// --------------------------------------------------------------------------

export function scoreEducation(profile: CandidateProfileData, record: MatchableRecord): number {
  const requiredLevels = (record.degreeLevels ?? []).filter(Boolean) as DegreeLevel[];
  if (requiredLevels.length === 0) return 70; // not specified → neutral-positive
  const candidateLevel = profile.highestDegreeLevel;
  if (!candidateLevel) return 30; // unknown → cannot claim a match
  const requiredRank = Math.min(...requiredLevels.map((l) => DEGREE_LEVEL_RANK[l] ?? 99));
  const candidateRank = DEGREE_LEVEL_RANK[candidateLevel];
  if (candidateRank >= requiredRank) {
    const excess = candidateRank - requiredRank;
    return excess >= 2 ? 88 : 95; // qualified, and higher than required
  }
  return Math.max(0, 55 - (requiredRank - candidateRank) * 25);
}

export function scoreExperience(profile: CandidateProfileData, record: MatchableRecord): number {
  const candidateYears = profile.personal.totalExperienceYears ?? 0;
  const min = record.experienceMinYears ?? null;
  const max = record.experienceMaxYears ?? null;

  if (min == null && max == null) {
    if (record.isFresherFriendly) return candidateYears <= 2 ? 92 : 78;
    return candidateYears > 0 ? 80 : 60;
  }
  if (min != null && candidateYears < min) {
    const ratio = min === 0 ? 1 : candidateYears / min;
    return Math.round(Math.max(0, ratio * 55));
  }
  if (max != null && candidateYears > max) return 62; // over-qualified is a real signal, not a failure
  return 92;
}

export function scoreLocation(profile: CandidateProfileData, record: MatchableRecord, preferred: string[]): number {
  const recordLocations = (record.locations ?? []).map((l) => l.toLowerCase());
  if (recordLocations.length === 0) return 60;
  if (record.workMode === 'remote') return 95;

  const wanted = [...preferred, ...resolvePreferredFromProfile(profile)].map((l) => l.toLowerCase());
  if (wanted.length === 0) return 65;

  let best = 0;
  for (const wantedLocation of wanted) {
    for (const location of recordLocations) {
      if (location === wantedLocation || location.includes(wantedLocation) || wantedLocation.includes(location)) {
        best = Math.max(best, 95);
        continue;
      }
      if (isSameState(location, wantedLocation)) best = Math.max(best, 85);
    }
  }
  if (best > 0) return best;
  if (recordLocations.some((l) => l.includes('india') || l.includes('pan india') || l.includes('anywhere'))) return 82;
  if (record.workMode === 'hybrid') return 60;
  return 35;
}

const STATE_CITY_MAP: Record<string, string[]> = {
  'tamil nadu': ['chennai', 'coimbatore', 'thanjavur', 'salem', 'madurai', 'trichy', 'tiruchirappalli', 'vellore', 'erode'],
  karnataka: ['bengaluru', 'bangalore', 'mysuru', 'mangaluru'],
  telangana: ['hyderabad', 'warangal'],
  maharashtra: ['mumbai', 'pune', 'nagpur', 'nashik'],
  delhi: ['new delhi', 'delhi'],
  'uttar pradesh': ['noida', 'lucknow', 'kanpur', 'ghaziabad'],
  kerala: ['kochi', 'thiruvananthapuram', 'kozhikode'],
  'andhra pradesh': ['visakhapatnam', 'vijayawada', 'tirupati'],
  'west bengal': ['kolkata', 'howrah'],
  gujarat: ['ahmedabad', 'surat', 'vadodara'],
  haryana: ['gurugram', 'gurgaon', 'faridabad'],
  rajasthan: ['jaipur', 'jodhpur', 'udaipur'],
};

export function isSameState(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  for (const [state, cities] of Object.entries(STATE_CITY_MAP)) {
    const aIn = la === state || cities.includes(la);
    const bIn = lb === state || cities.includes(lb);
    if (aIn && bIn) return true;
  }
  return false;
}

export function resolvePreferredFromProfile(profile: CandidateProfileData): string[] {
  const out: string[] = [];
  if (profile.personal.location) out.push(profile.personal.location);
  out.push(...profile.personal.preferredLocations);
  return out.filter(Boolean);
}

export function scoreRole(profile: CandidateProfileData, record: MatchableRecord): number {
  const title = `${record.title} ${record.organization ?? ''}`.toLowerCase();
  let best = 20;

  for (const family of profile.jobFamilies) {
    const tokens = family.name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
    const hit = tokens.some((token) => title.includes(token));
    if (hit) best = Math.max(best, 60 + Math.round(family.confidence * 35));
  }
  for (const path of profile.careerPaths) {
    const tokens = path.target.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
    const hits = tokens.filter((token) => title.includes(token)).length;
    if (hits > 0) best = Math.max(best, 55 + hits * 12 + Math.round(path.confidence * 15));
  }
  for (const education of profile.education) {
    const degreeToken = education.degree.toLowerCase().replace(/[^a-z]/g, '');
    if (degreeToken.length > 3 && title.includes(degreeToken)) best = Math.max(best, 90);
  }
  if (profile.personal.professionalTitle) {
    const tokens = profile.personal.professionalTitle.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
    if (tokens.some((t) => title.includes(t))) best = Math.max(best, 92);
  }
  const level = profile.careerLevel.name;
  if (level === 'fresher' && /\b(fresher|trainee|graduate|junior|intern|apprentice|entry)\b/.test(title)) best = Math.max(best, 88);
  if (level !== 'fresher' && /\b(fresher|trainee|intern|apprentice)\b/.test(title)) best = Math.min(best, 62);

  return Math.min(100, best);
}

export function scoreIndustry(profile: CandidateProfileData, record: MatchableRecord): number {
  const recordIndustry = `${record.category ?? ''} ${record.organization ?? ''} ${record.jobFamily ?? ''}`.toLowerCase();
  if (!recordIndustry.trim()) return 60;
  for (const industry of profile.industries) {
    const tokens = industry.name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
    if (tokens.some((t) => recordIndustry.includes(t))) return Math.round(70 + industry.confidence * 28);
  }
  for (const family of profile.jobFamilies.slice(0, 3)) {
    const tokens = family.name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3);
    if (tokens.some((t) => recordIndustry.includes(t))) return Math.round(65 + family.confidence * 20);
  }
  return 40;
}

export function scoreSalary(profile: CandidateProfileData, record: MatchableRecord, min: number | null, max: number | null): number {
  const offerMin = record.salaryMin ?? null;
  const offerMax = record.salaryMax ?? null;
  if (offerMin == null && offerMax == null) return 60;
  if (min == null && max == null) {
    // No stated expectation — score on plausibility rather than inventing one.
    const value = offerMax ?? offerMin ?? 0;
    if (value <= 0) return 55;
    const level = profile.careerLevel.name;
    const floor = level === 'fresher' ? 200_000 : level === 'junior' ? 350_000 : 600_000;
    return value >= floor ? 80 : 65;
  }
  const value = offerMax ?? offerMin ?? 0;
  if (max != null && value > 0 && value >= max) return 95;
  if (min != null && value > 0 && value >= min) return 88;
  if (min != null && value > 0) return Math.round(Math.max(20, (value / Math.max(1, min)) * 70));
  return 65;
}

export function scoreCareerGrowth(profile: CandidateProfileData, record: MatchableRecord): number {
  let score = 55;
  const title = record.title.toLowerCase();
  for (const path of profile.careerPaths) {
    if (title.includes(path.target.toLowerCase().split(' ')[0])) score = Math.max(score, 85 + Math.round(path.confidence * 10));
  }
  if (/\b(manager|lead|senior|principal|head)\b/.test(title) && ['senior', 'lead', 'executive'].includes(profile.careerLevel.name)) {
    score = Math.max(score, 85);
  }
  if (/\b(intern|trainee|apprentice)\b/.test(title)) score = profile.careerLevel.name === 'fresher' ? 78 : 45;
  if (/\b(contract|temporary|freelance)\b/.test(record.type ?? '')) score = Math.min(score, 62);
  return Math.min(100, score);
}

// --------------------------------------------------------------------------
// Overall scoring
// --------------------------------------------------------------------------

export function matchOpportunity(
  profile: CandidateProfileData,
  record: MatchableRecord,
  options: {
    weights?: unknown;
    preferredLocations?: string[];
    salaryMin?: number | null;
    salaryMax?: number | null;
  } = {},
): MatchResult {
  const isGovernment = Boolean(record.isGovernment || ['government_job', 'exam'].includes(record.type ?? ''));
  const weights = normaliseWeights(options.weights);
  const eligibility = checkEligibility(profile, record);

  const skillResult = matchSkills(
    profile.skills.map((s) => s.canonical),
    record.skills ?? [],
  );
  const education = scoreEducation(profile, record);
  const experience = scoreExperience(profile, record);
  const location = scoreLocation(profile, record, options.preferredLocations ?? []);
  const role = scoreRole(profile, record);
  const industry = scoreIndustry(profile, record);
  const salary = scoreSalary(profile, record, options.salaryMin ?? null, options.salaryMax ?? null);
  const careerGrowth = scoreCareerGrowth(profile, record);

  const breakdown: MatchBreakdown = {
    education,
    skill: skillResult.score,
    experience,
    location,
    role,
    industry,
    eligibility: eligibility.score,
    salary,
    careerGrowth,
  };

  let overall: number;
  if (isGovernment) {
    // Eligibility-first model: gates the score, then blends the fit dimensions.
    const gate = eligibility.verdict === 'not_eligible' ? 0 : eligibility.verdict === 'eligible' ? 1 : 0.62;
    const fit =
      (education * 0.28 + experience * 0.18 + skillResult.score * 0.17 + location * 0.09 + role * 0.16 + industry * 0.06 + careerGrowth * 0.06);
    overall = Math.round(fit * gate);
  } else {
    overall = Math.round(
      (skillResult.score * weights.skill +
        education * weights.qualification +
        experience * weights.experience +
        role * weights.role +
        location * weights.location +
        industry * weights.industry +
        salary * weights.salary +
        careerGrowth * weights.careerGrowth) /
        100,
    );
  }

  if (eligibility.verdict === 'not_eligible') overall = Math.min(overall, 25);

  // Deadline reality check — a closed application is not a good match.
  const days = daysRemaining(record.applicationDeadline ?? null);
  if (record.status === 'applications_closed' || (days !== null && days < 0)) overall = Math.min(overall, 20);

  const band = bandFor(overall, eligibility.verdict, skillResult.coverage);
  const reasons: string[] = [];
  if (education >= 85) reasons.push('✓ Qualification matches or exceeds the requirement');
  if (skillResult.matched.length) reasons.push(`✓ Skills in common: ${skillResult.matched.slice(0, 5).join(', ')}`);
  if (experience >= 85) reasons.push('✓ Experience level aligns');
  if (location >= 85) reasons.push('✓ Location matches your preference');
  if (role >= 80) reasons.push('✓ Role aligns with your target career path');
  if (skillResult.missing.length) reasons.push(`• Missing: ${skillResult.missing.slice(0, 4).join(', ')}`);
  reasons.push(...eligibility.blockers.map((b) => `✗ ${b}`));

  return {
    overall,
    band,
    label: BAND_META[band].label,
    breakdown,
    weights,
    matchedSkills: skillResult.matched,
    missingSkills: skillResult.missing,
    eligible: eligibility.verdict,
    reasons,
    model: isGovernment ? 'government' : 'private',
  };
}

export function bandFor(score: number, verdict: EligibilityVerdict, coverage: number): MatchBand {
  if (verdict === 'not_eligible') return 'not_eligible';
  if (score >= 90) return 'perfect';
  if (score >= 80) return 'strong';
  if (score >= 70) return 'good';
  if (score >= 55) return coverage < 0.35 ? 'gap' : 'possible';
  return coverage < 0.35 ? 'gap' : 'possible';
}

/** Deterministic, human-readable explanation of how the overall score was produced. */
export function explainScore(result: MatchResult): string {
  const parts = [
    `Skill ${result.breakdown.skill}×${result.weights.skill}%`,
    `Qualification ${result.breakdown.education}×${result.weights.qualification}%`,
    `Experience ${result.breakdown.experience}×${result.weights.experience}%`,
    `Role ${result.breakdown.role}×${result.weights.role}%`,
    `Location ${result.breakdown.location}×${result.weights.location}%`,
    `Industry ${result.breakdown.industry}×${result.weights.industry}%`,
    `Salary ${result.breakdown.salary}×${result.weights.salary}%`,
    `Career growth ${result.breakdown.careerGrowth}×${result.weights.careerGrowth}%`,
  ];
  const model =
    result.model === 'government'
      ? 'Government model: eligibility gates the score, then qualification (28%), experience (18%), skills (17%), role (16%), location (9%), industry (6%) and growth (6%) are blended.'
      : `Weighted model: ${parts.join(' + ')} = ${result.overall}/100`;
  return `${model} Eligibility: ${result.breakdown.eligibility}/100.`;
}
