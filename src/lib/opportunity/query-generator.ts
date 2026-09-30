import { configInt } from '@/lib/config';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import { runAi } from '@/lib/ai';
import { OPPORTUNITY_QUERY_SYSTEM } from '@/lib/ai/prompts';
import { z } from 'zod';
import type { SearchIntent } from '@/lib/search/types';

/**
 * Opportunity query generator.
 *
 * Queries are derived from the candidate's actual qualification, skills, experience level
 * and location — never from a fixed list. The LLM path is used when configured; the
 * deterministic generator below produces the same shape of output without any API key, so
 * the search pipeline always has real, profile-specific queries to run.
 */

export interface GeneratedQuery {
  q: string;
  intent: SearchIntent;
  tier: 1 | 2 | 3 | 4;
  rationale: string;
}

const QuerySchema = z.object({
  queries: z.array(
    z.object({
      q: z.string().min(3).max(160),
      intent: z.enum(['job', 'government', 'exam', 'internship', 'fellowship', 'official', 'general']).default('job'),
      tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(3),
      rationale: z.string().max(200).default(''),
    }),
  ).max(40),
});

export interface QueryInput {
  profile: CandidateProfileData;
  locations: string[];
  maxQueries?: number;
}

export async function generateQueries(input: QueryInput, userId?: string | null): Promise<{ queries: GeneratedQuery[]; provider: string; usedFallback: boolean }> {
  const outcome = await runAi<{ queries: GeneratedQuery[] }>({
    task: 'opportunity_queries',
    system: OPPORTUNITY_QUERY_SYSTEM,
    input: summariseForPrompt(input),
    schema: QuerySchema,
    fallback: () => ({ queries: generateQueriesDeterministic(input) }),
    maxTokens: 1800,
    temperature: 0.3,
    userId,
  });
  const max = input.maxQueries ?? configInt('search.default_max_queries');
  return { queries: outcome.data.queries.slice(0, max), provider: outcome.provider, usedFallback: outcome.usedFallback };
}

function summariseForPrompt(input: QueryInput) {
  const p = input.profile;
  return {
    qualification: p.education.map((e) => `${e.degree}${e.specialization ? ` (${e.specialization})` : ''}${e.graduationYear ? ` ${e.graduationYear}` : ''}`),
    highestDegreeLevel: p.highestDegreeLevel || null,
    fieldsOfStudy: p.fieldsOfStudy,
    experienceYears: p.personal.totalExperienceYears ?? 0,
    careerLevel: p.careerLevel.name,
    currentLocation: p.personal.location ?? null,
    preferredLocations: input.locations,
    topSkills: p.skills.slice(0, 20).map((s) => s.canonical),
    jobFamilies: p.jobFamilies.slice(0, 6).map((f) => f.name),
    governmentCategories: p.governmentCategories.slice(0, 6).map((g) => g.name),
    examCategories: p.examCategories.slice(0, 6).map((e) => e.name),
    certifications: p.certifications.map((c) => c.name),
    targetRoles: p.careerPaths.slice(0, 4).map((c) => c.target),
  };
}

/**
 * Deterministic generator. Builds queries by composing the candidate's real attributes,
 * so two different resumes never produce the same query set.
 */
export function generateQueriesDeterministic(input: QueryInput): GeneratedQuery[] {
  const p = input.profile;
  const queries: GeneratedQuery[] = [];
  const seen = new Set<string>();

  const push = (q: string, intent: SearchIntent, tier: 1 | 2 | 3 | 4, rationale: string) => {
    const key = q.toLowerCase().trim();
    if (seen.has(key) || !q.trim()) return;
    seen.add(key);
    queries.push({ q: q.replace(/\s+/g, ' ').trim(), intent, tier, rationale });
  };

  const location = p.personal.location ?? input.locations.find((l) => l !== 'India') ?? null;
  const state = input.locations.find((l) => !['India', location].includes(l)) ?? null;
  const level = p.careerLevel.name;
  const isFresher = level === 'fresher';
  const degree = p.education[0]?.degree ?? null;
  const specialization = p.education[0]?.specialization ?? p.fieldsOfStudy[0] ?? null;
  const topSkills = p.skills.slice(0, 6).map((s) => s.canonical);
  const families = p.jobFamilies.slice(0, 4).map((f) => f.name);
  const targets = p.careerPaths.slice(0, 3).map((c) => c.target);

  // 1. Role + location
  for (const target of targets) {
    const role = cleanRole(target);
    if (location) push(`${role} jobs ${location}`, 'job', 3, `target role + current location`);
    if (state && state !== location) push(`${role} jobs ${state}`, 'job', 3, 'target role + state');
    push(`${role} jobs India`, 'job', 3, 'target role, nationwide');
  }

  // 2. Qualification + role
  if (degree) {
    if (location) push(`${degree} jobs ${location}`, 'job', 3, 'qualification + location');
    push(`${degree} jobs ${isFresher ? 'fresher' : 'experienced'}`, 'job', 3, 'qualification + experience level');
    if (specialization) push(`${degree} ${specialization} jobs`, 'job', 3, 'qualification + specialisation');
  }

  // 3. Skill-led queries
  for (const skill of topSkills.slice(0, 3)) {
    const family = families[0];
    push(`${skill} ${family ? family.split(' ')[0].toLowerCase() : ''} jobs ${location ?? 'India'}`.replace(/\s+/g, ' '), 'job', 3, `key skill: ${skill}`);
  }

  // 4. Experience-appropriate variants
  if (isFresher) {
    if (degree) push(`${degree} fresher jobs ${location ?? 'India'}`, 'job', 3, 'fresher-friendly');
    for (const family of families.slice(0, 2)) push(`${family} fresher jobs`, 'job', 3, `entry route into ${family}`);
    if (degree) push(`graduate trainee ${degree} ${location ?? 'India'}`, 'job', 3, 'graduate trainee programmes');
  } else {
    const years = Math.max(1, Math.floor(p.personal.totalExperienceYears ?? 1));
    for (const family of families.slice(0, 2)) push(`${family} jobs ${years}+ years experience ${location ?? 'India'}`, 'job', 3, 'experience-weighted');
  }

  // 5. Internships / apprenticeships (relevant for early-career profiles)
  if (isFresher || (p.personal.totalExperienceYears ?? 0) <= 2) {
    if (degree) push(`${degree} internship ${location ?? 'India'}`, 'internship', 3, 'internship route');
    if (specialization) push(`${specialization} internship`, 'internship', 3, 'specialisation-specific internship');
    push('apprenticeship registration India NAPS', 'fellowship', 1, 'national apprenticeship scheme');
  }

  // 6. Government recruitment — qualification specific
  const govtTerms = governmentSearchTerms(p);
  for (const term of govtTerms.slice(0, 4)) {
    push(`${term} recruitment ${new Date().getFullYear()}`, 'government', 3, 'government recruitment for this qualification');
    push(`${term} recruitment official notification`, 'official', 1, 'seek the official notification');
  }

  // 7. Competitive examinations
  const year = new Date().getFullYear();
  const examTerms = examSearchTerms(p);
  for (const term of examTerms.slice(0, 4)) {
    // examSearchTerms already builds complete phrases such as "IBPS PO Clerk 2026 notification
    // apply online"; appending the suffix again produced
    // "IBPS PO Clerk 2026 notification apply online 2026 notification last date apply online".
    const lower = term.toLowerCase();
    const suffix = /notification|apply online|last date/.test(lower)
      ? (lower.includes(String(year)) ? '' : ` ${year}`)
      : ` ${year} notification last date apply online`;
    push(`${term}${suffix}`, 'exam', 3, 'exam the candidate may be eligible for');
  }

  // 8. Official-portal restricted queries for the most likely government categories
  for (const entry of officialPortalQueries(p)) push(entry.q, 'official', 1, entry.rationale);

  // 9. Fellowships / scholarships when the profile is academic
  if (p.highestDegreeLevel === 'master' || p.highestDegreeLevel === 'doctorate') {
    push(`fellowship ${specialization ?? 'postgraduate'} India ${new Date().getFullYear()}`, 'fellowship', 2, 'postgraduate fellowship');
    if (degree) push(`${degree} scholarship India application`, 'fellowship', 2, 'scholarship for this qualification');
  }

  // A resume with no degree, no skills and no job families gives us nothing to search for.
  // The generic fallbacks above would still emit "graduate government jobs", which invents a
  // qualification the document never stated — so emit nothing instead.
  const hasSignal = Boolean(degree) || topSkills.length > 0 || families.length > 0;
  if (!hasSignal) return [];

  // Honour the caller's ceiling. `generateQueries` applies the same limit on the AI path;
  // without this the keyless path could emit an unbounded number of searches.
  const max = input.maxQueries ?? configInt('search.default_max_queries');
  if (!Number.isFinite(max) || max <= 0) return queries;
  return capAcrossIntents(queries, max);
}

/**
 * Truncate a query list to `max` *without* dropping whole categories.
 *
 * Government, exam and official-portal queries are generated after the private-job ones, so a
 * naive slice silently removes all of them — on a platform whose core purpose is government
 * exam discovery. Round-robin across intents keeps every category represented, and spends any
 * leftover budget on whichever categories have queries still waiting.
 */
function capAcrossIntents(queries: GeneratedQuery[], max: number): GeneratedQuery[] {
  if (queries.length <= max) return queries;

  const byIntent = new Map<SearchIntent, GeneratedQuery[]>();
  for (const query of queries) {
    const list = byIntent.get(query.intent) ?? [];
    list.push(query);
    byIntent.set(query.intent, list);
  }

  const picked: GeneratedQuery[] = [];
  const taken = new Set<GeneratedQuery>();
  while (picked.length < max) {
    let progressed = false;
    for (const list of byIntent.values()) {
      if (picked.length >= max) break;
      const next = list.find((query) => !taken.has(query));
      if (!next) continue;
      taken.add(next);
      picked.push(next);
      progressed = true;
    }
    if (!progressed) break;
  }
  // Restore the original generation order so the UI shows the strongest queries first.
  return queries.filter((query) => taken.has(query)).slice(0, max);
}

function cleanRole(target: string): string {
  return target.replace(/^(Junior|Senior)\s+/, '').replace(/\s*\/.*$/, '').trim();
}

function governmentSearchTerms(p: CandidateProfileData): string[] {
  const terms: string[] = [];
  const degree = p.education[0]?.degree ?? '';
  const specialization = p.education[0]?.specialization ?? p.fieldsOfStudy[0] ?? '';
  const isCommerce = /commerce|accounting|finance/i.test(`${degree} ${specialization} ${p.fieldsOfStudy.join(' ')}`);
  const isTechnical = /engineering|computer/i.test(`${degree} ${specialization}`);

  if (isCommerce) {
    terms.push(`${degree} government jobs`, 'accounts assistant government recruitment', 'junior accountant government vacancy', 'finance executive government department');
  } else if (isTechnical) {
    terms.push(`${degree} government jobs`, 'junior engineer government recruitment', 'technical assistant government vacancy');
  } else if (degree) {
    terms.push(`${degree} government jobs`, 'graduate government recruitment');
  } else {
    terms.push('graduate government jobs');
  }
  if (p.personal.location) terms.push(`government jobs ${p.personal.location}`);
  return [...new Set(terms)];
}

function examSearchTerms(p: CandidateProfileData): string[] {
  const terms: string[] = [];
  const year = new Date().getFullYear();
  for (const category of p.examCategories.slice(0, 5)) {
    const key = category.name.split('(')[0].trim();
    const short = key.split(' ')[0];
    if (['SSC', 'UPSC', 'IBPS', 'RRB', 'SEBI', 'CTET'].includes(short)) {
      terms.push(`${short} exam ${year} application last date`);
    } else if (/State PSC/i.test(key)) {
      const state = statePscFor(p);
      terms.push(`${state} PSC group 4 ${year} notification`);
    } else if (/Banking/i.test(key)) {
      terms.push(`IBPS PO Clerk ${year} notification apply online`);
      terms.push(`SBI PO apprentice ${year} notification`);
    } else if (/Regulatory/i.test(key)) {
      terms.push(`SEBI Grade A ${year} notification commerce`);
    } else if (/Teaching/i.test(key)) {
      terms.push(`CTET ${year} notification apply`);
    } else if (/Research|University/i.test(key)) {
      terms.push(`UGC NET ${year} notification`);
    } else {
      terms.push(`${key} ${year} exam`);
    }
  }
  return [...new Set(terms)].filter(Boolean);
}

function statePscFor(p: CandidateProfileData): string {
  const text = `${p.personal.location ?? ''} ${p.personal.preferredLocations.join(' ')}`.toLowerCase();
  if (/tamil nadu|chennai|coimbatore|thanjavur|salem|madurai|trichy/.test(text)) return 'TNPSC';
  if (/karnataka|bengaluru|bangalore/.test(text)) return 'KPSC';
  if (/kerala|kochi/.test(text)) return 'KPSC Kerala';
  if (/telangana|hyderabad/.test(text)) return 'TSPSC';
  if (/maharashtra|mumbai|pune/.test(text)) return 'MPSC';
  if (/delhi/.test(text)) return 'DSSSB';
  return 'State';
}

/** site:-restricted queries aimed at the authoritative portals for this profile. */
function officialPortalQueries(p: CandidateProfileData): { q: string; rationale: string }[] {
  const out: { q: string; rationale: string }[] = [];
  const degree = p.education[0]?.degree ?? '';
  const categories = p.governmentCategories.map((c) => c.name);

  if (categories.some((c) => /SSC/i.test(c))) out.push({ q: `site:ssc.gov.in ${degree} ${new Date().getFullYear()} notification`, rationale: 'SSC official portal' });
  if (categories.some((c) => /UPSC/i.test(c))) out.push({ q: `site:upsc.gov.in recruitment advertisement ${new Date().getFullYear()}`, rationale: 'UPSC official portal' });
  if (categories.some((c) => /Banking/i.test(c))) out.push({ q: `site:ibps.in ${new Date().getFullYear()} recruitment notification`, rationale: 'IBPS official portal' });
  if (categories.some((c) => /Railway/i.test(c))) out.push({ q: `site:rrbapply.gov.in NTPC ${new Date().getFullYear()}`, rationale: 'RRB official application portal' });
  if (/tamil nadu|chennai|coimbatore|thanjavur|salem|madurai/i.test(`${p.personal.location ?? ''} ${p.personal.preferredLocations.join(' ')}`)) {
    out.push({ q: `site:tnpsc.gov.in notification ${new Date().getFullYear()}`, rationale: 'TNPSC official portal' });
  }
  out.push({ q: `site:employmentnews.gov.in ${degree} recruitment`, rationale: 'Employment News (Government of India)' });
  return out;
}
