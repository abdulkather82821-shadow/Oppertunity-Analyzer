import { DEGREE_PATTERNS, SKILL_TAXONOMY, type DegreeLevel } from './taxonomy';

/**
 * Deterministic resume parser.
 *
 * This is the key-less engine: everything it returns is either found verbatim in the
 * resume text or derived from it by an explicit rule. Nothing is filled in from general
 * knowledge, which is what lets the platform honour its anti-hallucination contract even
 * when no LLM provider is configured.
 */

export interface ParsedEducation {
  degree: string;
  degreeLevel: DegreeLevel | '';
  specialization: string;
  institution: string;
  graduationYear: number | null;
  score: string | null;
  scoreType: 'percentage' | 'cgpa' | 'gpa' | null;
  raw: string;
}

export interface ParsedExperience {
  jobTitle: string;
  company: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  durationMonths: number | null;
  responsibilities: string;
  achievements: string;
  domain: string;
  tools: string[];
  raw: string;
}

export interface ParsedSkill {
  name: string;
  canonical: string;
  category: string;
  jobFamilies: string[];
  confidence: number;
  source: 'resume';
}

export interface ParsedCertification {
  name: string;
  issuer: string;
  year: number | null;
  skills: string[];
}

export interface ParsedProject {
  title: string;
  technologies: string[];
  domain: string;
  role: string;
  description: string;
  skills: string[];
}

export interface ParsedResume {
  rawText: string;
  sections: Record<string, string[]>;
  personal: {
    name: string | null;
    professionalTitle: string | null;
    careerObjective: string | null;
    location: string | null;
    preferredLocations: string[];
    industry: string | null;
    totalExperienceYears: number | null;
    dateOfBirth: string | null;
    ageYears: number | null;
    salaryExpectation: string | null;
    contactFound: { email: boolean; phone: boolean };
  };
  education: ParsedEducation[];
  experience: ParsedExperience[];
  skills: ParsedSkill[];
  certifications: ParsedCertification[];
  projects: ParsedProject[];
  warnings: string[];
}

const SECTION_ALIASES: Record<string, RegExp> = {
  objective: /^(career\s+)?(objective|summary|professional\s+summary|profile|about\s+me|career\s+profile)\b/i,
  education: /^(educational?\s+)?(education|qualifications?|academic(s)?|academic\s+(background|credentials?|record)|educational\s+background)\b/i,
  experience: /^(work\s+|professional\s+|employment\s+|relevant\s+|industry\s+)?(experience|employment|work\s+history|career\s+history|professional\s+background|internship(s)?)\b/i,
  skills: /^(technical\s+|key\s+|core\s+|relevant\s+)?(skills?|competenc(y|ies)|skill\s+set|expertise|areas?\s+of\s+expertise|proficiency|it\s+skills?|computer\s+skills?)\b/i,
  certifications: /^(certifications?|certificates?|licenses?|courses?(\s+and\s+certifications?)?|professional\s+development|training(s)?)\b/i,
  projects: /^(academic\s+|key\s+|major\s+|personal\s+)?(projects?|projects?\s+undertaken|portfolio)\b/i,
  achievements: /^(achievements?|accomplishments?|awards?(\s+and\s+honou?rs?)?|honou?rs?|extra[\s-]?curricular)\b/i,
  languages: /^(languages?\s+known|languages?)\b/i,
  personal_details: /^(personal\s+(details|information|particulars)|declaration|contact(\s+details?)?)\b/i,
};

const SECTION_ORDER = ['objective', 'education', 'experience', 'skills', 'certifications', 'projects', 'achievements', 'languages', 'personal_details'];

function classifyHeading(line: string): string | null {
  const cleaned = line.replace(/^[\s•*\-–—#:|]+/, '').replace(/[\s•*\-–—#:|]+$/, '').trim();
  if (!cleaned || cleaned.length > 60) return null;
  if (/\.\s/.test(cleaned) && !/^(?!(?:courses?|projects?)\b)/i.test(cleaned)) return null;
  const words = cleaned.split(/\s+/).length;
  if (words > 6) return null;
  for (const [key, pattern] of Object.entries(SECTION_ALIASES)) {
    if (pattern.test(cleaned)) return key;
  }
  return null;
}

/** Split the resume into labelled sections, preserving the preamble (name/contact header). */
export function splitSections(text: string): { preamble: string[]; sections: Record<string, string[]> } {
  const lines = text.split('\n');
  const sections: Record<string, string[]> = { _preamble: [] };
  let current = '_preamble';
  let sinceHeading = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (sections[current]) sections[current].push('');
      continue;
    }
    const heading = classifyHeading(line);
    if (heading) {
      // Guard against a sentence that merely starts with a keyword (e.g. "Skills in Excel…").
      const isLikelyHeading = line === line.toUpperCase() || line.length <= 32 || /^(skills?|projects?|certifications?)\b/i.test(line);
      if (isLikelyHeading) {
        current = heading;
        sections[current] = sections[current] ?? [];
        sinceHeading = 0;
        continue;
      }
    }
    sinceHeading += 1;
    sections[current] = sections[current] ?? [];
    sections[current].push(line);
  }
  // A heading with nothing under it is not a real section — drop it.
  for (const key of Object.keys(sections)) {
    if (key !== '_preamble' && sections[key].filter((l) => l.trim()).length === 0) delete sections[key];
  }
  void sinceHeading;
  return { preamble: (sections._preamble ?? []).filter((l) => l.trim()), sections };
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const DATE_TOKEN =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*['’]?\d{0,2}\s*(?:,|\s)?\s*\d{4}|(?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.]\d{2,4}|\b(19|20)\d{2}\b)/i;

const PRESENT_WORDS = 'present|current|currently|till date|till now|tilldate|continuing|ongoing|now';
const RANGE_CONNECTOR = '\\s*(?:–|—|-|to|till|until|through)\\s*';
const DATE_RANGE = new RegExp(`(?:${DATE_TOKEN.source})${RANGE_CONNECTOR}(?:${DATE_TOKEN.source}|${PRESENT_WORDS})`, 'i');

/** The substring of `text` that holds a date range (or a single date), or null when there is none. */
export function locateDateSpan(text: string): string | null {
  const range = text.match(DATE_RANGE);
  if (range) return range[0];
  const single = text.match(DATE_TOKEN);
  return single ? single[0] : null;
}

export interface DateRange {
  start: string | null;
  end: string | null;
  isCurrent: boolean;
  months: number | null;
}

/**
 * Parses the many date formats found in real resumes:
 * "Jan 2020 – Present", "2020 - 2022", "01/2021 - 12/2023", "Jan'20", "June 2019 to till date".
 * Handles Indian DD/MM/YYYY ordering. Returns null rather than guessing when unclear.
 */
export function parseDateRange(line: string, now = new Date()): DateRange {
  const empty: DateRange = { start: null, end: null, isCurrent: false, months: null };
  if (!line) return empty;
  // Locate the date span first. Splitting the whole line on dashes would cut a header such as
  // "Analyst — Acme Corp, Jan 2020 – Present" at the dash between title and company and then
  // look for the start date in the wrong half.
  const text = locateDateSpan(line.replace(/\s+/g, ' '));
  if (!text) return empty;
  const splitter = /\s*(?:–|—|-|to|till|until|through)\s*/i;
  const parts = text.split(splitter).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return empty;

  const currentWords = /\b(present|current|currently|till date|till now|tilldate|continuing|ongoing|now)\b/i;
  const isCurrent = parts.length >= 2 && currentWords.test(parts[parts.length - 1]);

  const parseOne = (token: string): string | null => {
    const m = token.match(DATE_TOKEN);
    if (!m) return null;
    const raw = m[0].trim();
    const monthMatch = raw.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i);
    const yearMatch = raw.match(/(\d{4})/) ?? raw.match(/'(\d{2})\b/);
    let year: number | null = yearMatch ? Number(yearMatch[1]) : null;
    if (year !== null && year < 100) year += year >= 0 && year <= 49 ? 2000 : 1900;
    if (year === null) {
      const twoDigit = raw.match(/\b(\d{2})\b/);
      if (twoDigit) {
        const candidate = Number(twoDigit[1]);
        year = candidate <= 49 ? 2000 + candidate : 1900 + candidate;
      }
    }
    if (year === null) return null;
    if (year < 1950 || year > now.getFullYear() + 6) return null; // implausible → do not guess
    const month = monthMatch ? MONTHS[monthMatch[1].toLowerCase().replace(/\.$/, '').slice(0, 4)] ?? null : null;
    // Numeric DD/MM/YYYY or MM/DD — only trust the month when unambiguous.
    let numericMonth: number | null = null;
    if (!month) {
      const numeric = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (numeric) {
        const a = Number(numeric[1]);
        const b = Number(numeric[2]);
        if (a > 12 && b <= 12) numericMonth = b;      // DD/MM/YYYY (Indian)
        else if (b > 12 && a <= 12) numericMonth = a; // MM/DD/YYYY
        else if (a <= 12 && b > 12) numericMonth = a; // YYYY-DD impossible → MM/DD
        else numericMonth = null;                     // ambiguous → leave month unknown
      }
    }
    const effectiveMonth = month ?? numericMonth;
    return effectiveMonth
      ? `${year}-${String(effectiveMonth).padStart(2, '0')}-01`
      : `${year}-01-01`;
  };

  let start = parseOne(parts[0]);
  let end = isCurrent ? null : parseOne(parts[parts.length - 1] ?? '');

  if (parts.length === 1 && start) {
    end = start; // single date → treat as a one-point event, not a span
  }
  if (start && end && end < start) [start, end] = [end, start];

  let months: number | null = null;
  if (start) {
    const endDate = end ? new Date(end) : now;
    const startDate = new Date(start);
    months = Math.max(
      0,
      (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth()),
    );
  }
  return { start, end, isCurrent, months };
}

export function findEducation(sectionLines: string[], preamble: string[]): ParsedEducation[] {
  // Blank lines inside the education section separate nothing that the degree patterns do not
  // already separate, and dropping them lets an institution or year on the NEXT line still be
  // read when the source (a Word file, say) double-spaces its paragraphs.
  const pool = [...(sectionLines ?? []), ...(sectionLines?.length ? [] : preamble)].filter((line) => line.trim());
  const found: ParsedEducation[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < pool.length; index += 1) {
    const clean = pool[index].trim();
    if (!clean) continue;
    for (const rule of DEGREE_PATTERNS) {
      const match = clean.match(rule.pattern);
      if (!match) continue;
      const key = `${rule.canonical}:${clean.toLowerCase().slice(0, 60)}`;
      if (seen.has(key)) break;
      seen.add(key);

      // Many resumes put the institution and year on the line *after* the degree title.
      // Look ahead a couple of lines so that layout is read correctly, but stop at the next
      // line that itself looks like a degree entry or a new section heading.
      const lookahead: string[] = [];
      for (let offset = 1; offset <= 2; offset += 1) {
        const next = (pool[index + offset] ?? '').trim();
        if (!next) break;
        if (DEGREE_PATTERNS.some((candidate) => candidate.pattern.test(next))) break;
        if (/^(skills?|experience|projects?|certifications?|languages?|summary|objective)\b/i.test(next)) break;
        lookahead.push(next);
      }
      const extended = [clean, ...lookahead].join(' | ');

      const range = parseDateRange(extended);
      const yearFromRange = range.end ? Number(range.end.slice(0, 4)) : null;
      const bareYear = extended.match(/\b(19|20)\d{2}\b/);
      const candidateYear = yearFromRange ?? (bareYear ? Number(bareYear[0]) : null);
      const graduationYear = candidateYear && candidateYear >= 1960 && candidateYear <= new Date().getFullYear() + 6 ? candidateYear : null;

      const scoreFromLookahead = lookahead.length
        ? extended.match(/(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|percent(?:age)?)/i) ??
          extended.match(/(?:cgpa|gpa|sgpa)\s*(?:of|:|=|\s)\s*(\d{1,2}(?:\.\d{1,3})?)/i)
        : null;
      const scoreMatch =
        clean.match(/(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|percent(?:age)?)/i) ??
        clean.match(/(?:cgpa|gpa|sgpa)\s*(?:of|:|=|\s)\s*(\d{1,2}(?:\.\d{1,3})?)/i) ??
        clean.match(/\b(\d\.\d{1,3})\s*(?:\/\s*10|cgpa)/i);
      const score = scoreMatch ? scoreMatch[1] : (scoreFromLookahead ? scoreFromLookahead[1] : null);
      const scoreType: ParsedEducation['scoreType'] = score
        ? /%|percent/i.test(extended)
          ? 'percentage'
          : /cgpa|gpa|sgpa|\/\s*10/i.test(extended)
            ? 'cgpa'
            : null
        : null;

      const specialization = extractSpecialization(clean, rule.canonical) || extractSpecialization(extended, rule.canonical);
      const institution = extractInstitution(clean) || extractInstitution(extended);

      found.push({
        degree: rule.canonical,
        degreeLevel: rule.level,
        specialization,
        institution,
        graduationYear,
        score,
        scoreType,
        raw: clean,
      });
      break; // one degree per line
    }
  }
  return found;
}

const SPECIALIZATION_WORDS =
  /(?:in|speciali[sz](?:ing|ation)\s+in|major(?:ing)?\s+in|stream[:\s]|branch[:\s]|concentration[:\s])\s+([A-Za-z][A-Za-z &,\-']{2,60})/i;

function extractSpecialization(line: string, degree: string): string {
  const match = line.match(SPECIALIZATION_WORDS);
  if (match) {
    const value = match[1].replace(/[.,;|]+$/, '').trim();
    if (value && !/^\d/.test(value) && !/university|college|institute/i.test(value)) return value;
  }
  // "B.Com Accounting and Finance" style — words directly after the degree token.
  const afterDegree = line.split(new RegExp(degree.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))[1];
  if (afterDegree) {
    const candidate = afterDegree.replace(/^[\s,:\-–—()]+/, '').split(/[,|;(\d]/)[0].trim();
    if (candidate && candidate.length > 2 && candidate.length < 60 && !/university|college|institute|\d{4}/i.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

const INSTITUTION_KIND = 'University|College|Institute|School|Academy|Institution|Vidyalaya|Polytechnic';

function extractInstitution(line: string): string {
  // Keyword *after* the name: "Anna University", "St Joseph's College".
  const trailing = line.match(new RegExp(`\\b([A-Z][A-Za-z&'.\\- ]{2,60}?(?:${INSTITUTION_KIND}))\\b`));
  if (trailing) return trailing[1].replace(/\s+/g, ' ').trim();
  // Keyword *first*: "University of Madras", "Institute of Chartered Accountants".
  const leading = line.match(new RegExp(`\\b((?:${INSTITUTION_KIND})\\s+of\\s+[A-Z][A-Za-z&'.\\- ]{2,60})\\b`));
  if (leading) return leading[1].replace(/\s+/g, ' ').trim();
  const after = line.match(/(?:from|at)\s+([A-Z][A-Za-z&'.\- ]{3,60})/);
  return after ? after[1].trim() : '';
}

const TITLE_HINTS =
  /\b(assistant|associate|junior|senior|executive|manager|analyst|accountant|engineer|developer|intern|trainee|clerk|officer|consultant|specialist|administrator|coordinator|supervisor|lecturer|teacher|designer|director|lead|head|cashier|auditor|recruiter|representative|associate|apprentice|typist|stenographer|professor|researcher)\b/i;

const BULLET = /^[-•*▪◦·>»]\s*/;

/** Lines that start with an action verb are duties, not job headers. */
const DUTY_OPENER =
  /^(?:[A-Z][a-z]+(?:ed|ing)|Led|Ran|Built|Wrote|Drove|Took|Made|Got|Kept|Held|Sold|Taught|Responsible\b|Worked\b)\b/;

/** A line that is only a date range ("June 2024 - August 2024", "(2019 – 2021)"). */
function isDateOnlyLine(line: string): boolean {
  const span = locateDateSpan(line.replace(/\s+/g, ' '));
  if (!span) return false;
  const rest = line
    .replace(span, ' ')
    .replace(/\b(?:duration|period|tenure|from|to|till|until|present|current|date|since)\b/gi, ' ')
    .replace(/[()[\]|,;:–—-]/g, ' ');
  return !/[A-Za-z]{3,}/.test(rest);
}

function isJobHeader(line: string, hasDate: boolean): boolean {
  if (BULLET.test(line) || line.length > 130) return false;
  const words = line.split(/\s+/).length;
  if (words > 18 || /[.!?]$/.test(line)) return false;
  if (DUTY_OPENER.test(line)) return false;
  const hasSeparator = /\s(?:—|–|\|)\s|\s-\s|\s@\s|\bat\s+[A-Z]/.test(line);
  return TITLE_HINTS.test(line) && (hasSeparator || hasDate || words <= 6);
}

export function findExperience(sectionLines: string[]): ParsedExperience[] {
  const results: ParsedExperience[] = [];
  const lines = (sectionLines ?? []).map((line) => line.trim());
  let current: ParsedExperience | null = null;
  let pendingDate: DateRange | null = null;

  const flush = () => {
    if (!current) return;
    if (current.jobTitle || current.company) {
      current.responsibilities = current.responsibilities.replace(/\n{2,}/g, '\n').trim();
      current.achievements = current.achievements.trim();
      results.push(current);
    }
    current = null;
  };

  const applyRange = (entry: ParsedExperience, range: DateRange) => {
    entry.startDate = range.start;
    entry.endDate = range.isCurrent ? null : range.end;
    entry.isCurrent = range.isCurrent;
    entry.durationMonths = range.months;
  };

  const appendDuty = (entry: ParsedExperience, line: string) => {
    const text = line.replace(BULLET, '');
    const isAchievement =
      /\b(achieved|improved|increased|reduced|saved|awarded|recogni[sz]ed|generated|delivered|cut|grew|raised)\b/i.test(line) && /\d/.test(line);
    if (isAchievement) entry.achievements += `${entry.achievements ? '\n' : ''}${text}`;
    else entry.responsibilities += `${entry.responsibilities ? '\n' : ''}${text}`;
    for (const skill of SKILL_TAXONOMY) {
      if (entry.tools.length >= 12) break;
      for (const needle of [skill.canonical, ...skill.aliases]) {
        if (needle.length < 3) continue;
        if (new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i').test(line)) {
          if (!entry.tools.includes(skill.canonical)) entry.tools.push(skill.canonical);
          break;
        }
      }
    }
  };

  for (const line of lines) {
    if (!line) continue;

    if (BULLET.test(line)) {
      if (current) appendDuty(current, line);
      continue;
    }

    const range = parseDateRange(line);

    // A line holding nothing but dates. Layouts differ: the dates may sit under the job header
    // (the usual case) or above it, so decide which entry they belong to.
    if (range.start !== null && isDateOnlyLine(line)) {
      const entry = current as ParsedExperience | null;
      if (entry && entry.startDate === null && !entry.responsibilities && !entry.achievements) applyRange(entry, range);
      else pendingDate = range;
      continue;
    }

    if (isJobHeader(line, range.start !== null)) {
      flush();
      const { jobTitle, company } = splitRoleAndCompany(line);
      const entry: ParsedExperience = {
        jobTitle,
        company,
        startDate: null,
        endDate: null,
        isCurrent: false,
        durationMonths: null,
        responsibilities: '',
        achievements: '',
        domain: '',
        tools: [],
        raw: line,
      };
      // Dates printed on the header line win over dates seen on the line before it.
      const dates = range.start !== null ? range : pendingDate;
      if (dates) applyRange(entry, dates);
      pendingDate = null;
      current = entry;
      continue;
    }

    if (current) appendDuty(current, line);
  }
  flush();
  return results;
}

function splitRoleAndCompany(line: string): { jobTitle: string; company: string } {
  const cleaned = line.replace(BULLET, '').trim();
  // Remove only the date span itself. Stripping "to"/"till"/dashes from the whole line would
  // delete the title/company separator and mangle names such as "Back to Basics Ltd".
  const span = locateDateSpan(cleaned.replace(/\s+/g, ' '));
  const withoutDates = (span ? cleaned.replace(span, ' ') : cleaned)
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, '')
    .trim();

  const at = withoutDates.match(/^(.{2,70}?)\s+(?:at|@)\s+(.{2,80})$/i);
  let title = '';
  let company = '';
  if (at) {
    title = at[1];
    company = at[2];
  } else {
    // Spaced separators first (an em dash, a pipe, " - "); a bare comma is the weakest signal.
    const spaced = withoutDates.match(/^(.{2,70}?)\s+(?:—|–|\||-)\s+(.{2,100})$/);
    const comma = withoutDates.match(/^(.{2,60}?),\s*(.{2,100})$/);
    const hit = spaced ?? comma;
    if (hit) {
      title = hit[1];
      company = hit[2];
    } else {
      title = withoutDates.slice(0, 80);
    }
  }
  title = title.replace(/[\s|,;:–—-]+$/g, '').trim();
  company = company.replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, '').trim();

  // "Acme Corp — Senior Analyst": the title is the half that reads like one.
  if (company && !TITLE_HINTS.test(title) && TITLE_HINTS.test(company) && !/\b(ltd|limited|inc|llp|pvt|corp|company|associates)\b/i.test(company)) {
    [title, company] = [company, title];
  }
  return { jobTitle: title.slice(0, 80), company: company.slice(0, 100) };
}

export function findSkills(sectionLines: string[], allText: string): ParsedSkill[] {
  const collected = new Map<string, ParsedSkill>();

  const consider = (token: string, confidence: number, source: 'resume') => {
    const entry = SKILL_TAXONOMY.find(
      (s) =>
        s.canonical.toLowerCase() === token.toLowerCase() ||
        s.aliases.some((a) => a.toLowerCase() === token.toLowerCase()),
    );
    const canonical = entry?.canonical ?? token;
    if (canonical.length < 2 || canonical.length > 48) return;
    const existing = collected.get(canonical.toLowerCase());
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      return;
    }
    collected.set(canonical.toLowerCase(), {
      name: token,
      canonical,
      category: entry?.category ?? 'other',
      jobFamilies: entry?.jobFamilies ?? [],
      confidence,
      source,
    });
  };

  // 1) Explicit skills section (highest confidence).
  for (const line of sectionLines ?? []) {
    for (const token of line.split(/[,•;|/\n•●▪◦·]+/)) {
      const trimmed = token.replace(/^[\s\-–—:*]+|[\s\-–—:*.]+$/g, '').trim();
      if (!trimmed || trimmed.length > 48 || trimmed.split(/\s+/).length > 5) continue;
      if (SKILL_TAXONOMY.some((s) => s.canonical.toLowerCase() === trimmed.toLowerCase() || s.aliases.includes(trimmed.toLowerCase()))) {
        consider(trimmed, 0.98, 'resume');
      }
    }
  }

  // 2) Mentions elsewhere in the document (still resume-derived, slightly lower confidence).
  for (const skill of SKILL_TAXONOMY) {
    for (const needle of [skill.canonical, ...skill.aliases]) {
      if (needle.length < 3) continue;
      const re = new RegExp(`\\b${escapeRegex(needle)}\\b`, 'i');
      if (re.test(allText)) {
        consider(skill.canonical, 0.8, 'resume');
        break;
      }
    }
  }

  return [...collected.values()].sort((a, b) => b.confidence - a.confidence || a.canonical.localeCompare(b.canonical));
}

export function findCertifications(sectionLines: string[]): ParsedCertification[] {
  const results: ParsedCertification[] = [];
  for (const raw of sectionLines ?? []) {
    const line = raw.trim();
    if (!line || line.length < 4) continue;
    const name = line.replace(/^[-•*▪◦·>»\s]+/, '').split(/\s*[|,]\s*/)[0].trim();
    if (!name || name.length > 90) continue;
    if (/^(certifications?|certificates?|courses?|training)\b/i.test(name) && name.split(/\s+/).length <= 2) continue;
    const yearMatch = line.match(/\b(19|20)\d{2}\b/);
    const issuerMatch = line.match(/\b(?:by|from|issued by|-\s*)([A-Z][A-Za-z&'.\- ]{2,50})/);
    const skills: string[] = [];
    for (const skill of SKILL_TAXONOMY) {
      if (new RegExp(`\\b${escapeRegex(skill.canonical)}\\b`, 'i').test(line)) skills.push(skill.canonical);
    }
    results.push({
      name,
      issuer: issuerMatch ? issuerMatch[1].trim() : '',
      year: yearMatch ? Number(yearMatch[0]) : null,
      skills: skills.slice(0, 6),
    });
  }
  return results.slice(0, 20);
}

export function findProjects(sectionLines: string[]): ParsedProject[] {
  const results: ParsedProject[] = [];
  const lines = (sectionLines ?? []).filter((l) => l.trim());
  let current: ParsedProject | null = null;
  const flush = () => {
    if (current && current.title) results.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim().replace(/^[-•*▪◦·>»\s]+/, '');
    if (!line) continue;
    const isTitle = line.length < 90 && !/[.]\s/.test(line) && (TITLE_HINTS.test(line) === false || /project/i.test(line));
    if (isTitle && !current) {
      current = { title: line, technologies: [], domain: '', role: '', description: '', skills: [] };
      continue;
    }
    if (isTitle && current && current.description.length > 40) {
      flush();
      current = { title: line, technologies: [], domain: '', role: '', description: '', skills: [] };
      continue;
    }
    if (current) {
      current.description += `${current.description ? ' ' : ''}${line}`;
      const roleMatch = line.match(/\b(role|responsibilit\w+)\s*[:\-]\s*([A-Za-z ,&]{3,40})/i);
      if (roleMatch && !current.role) current.role = roleMatch[2].trim();
      for (const skill of SKILL_TAXONOMY) {
        if (new RegExp(`\\b${escapeRegex(skill.canonical)}\\b`, 'i').test(line)) {
          if (!current.technologies.includes(skill.canonical)) current.technologies.push(skill.canonical);
          if (!current.skills.includes(skill.canonical)) current.skills.push(skill.canonical);
        }
      }
      const domainMatch = line.match(/\b(domain|industry)\s*[:\-]\s*([A-Za-z ,&]{3,40})/i);
      if (domainMatch && !current.domain) current.domain = domainMatch[2].trim();
    }
  }
  flush();
  return results.slice(0, 15);
}

export function findPersonal(preamble: string[], sections: Record<string, string[]>, allText: string) {
  const head = preamble.filter((l) => l.trim());
  const emailMatch = allText.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/);
  const phoneMatch = allText.match(/(?:\+91[\s-]?)?(?:[6-9]\d{9}|\d{5}[\s-]?\d{5})\b/);

  let name: string | null = null;
  for (const line of head.slice(0, 5)) {
    const cleaned = line.replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const words = cleaned.split(' ');
    if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))) {
      if (/resume|curriculum|vitae|cv|portfolio|contact|email|phone|address/i.test(cleaned)) continue;
      name = cleaned;
      break;
    }
  }

  let professionalTitle: string | null = null;
  for (const line of head.slice(0, 8)) {
    const cleaned = line.trim();
    if (cleaned === name) continue;
    if (/@|\d{10}|http|www|\.com|\.in/i.test(cleaned)) continue;
    if (TITLE_HINTS.test(cleaned) && cleaned.length < 70 && cleaned.split(/\s+/).length <= 8) {
      professionalTitle = cleaned.replace(/[|,]\s*$/, '');
      break;
    }
  }

  const objectiveLines = (sections.objective ?? []).filter((l) => l.trim());
  const careerObjective = objectiveLines.length ? objectiveLines.join(' ').slice(0, 700) : null;

  let location: string | null = null;
  const locationMatch =
    allText.match(/\b(Chennai|Coimbatore|Thanjavur|Salem|Madurai|Trichy|Tiruchirappalli|Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Delhi|Noida|Gurugram|Gurgaon|Kolkata|Ahmedabad|Tamil Nadu|Karnataka|Kerala|Telangana|Maharashtra|India)\b/i);
  if (locationMatch) location = locationMatch[1];

  const preferredLocations: string[] = [];
  const prefMatch = allText.match(/\b(preferred|willing to relocate|open to|relocation|location preference)\b[^.\n]{0,120}/i);
  if (prefMatch) {
    const cities = prefMatch[0].match(
      /\b(Chennai|Coimbatore|Thanjavur|Salem|Madurai|Trichy|Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Delhi|Noida|Gurugram|Kolkata|Tamil Nadu|India|Remote|Anywhere)\b/gi,
    );
    if (cities) for (const city of cities) if (!preferredLocations.includes(city)) preferredLocations.push(capitalize(city.toLowerCase()));
  }

  const totalExperienceYears = computeTotalExperienceYears(allText);
  const dob = extractDateOfBirth(allText);
  const salaryExpectation = extractSalaryExpectation(allText);

  return {
    name,
    professionalTitle,
    careerObjective,
    location,
    preferredLocations,
    industry: inferIndustryFromText(allText),
    totalExperienceYears,
    dateOfBirth: dob,
    ageYears: dob ? computeAge(dob) : null,
    salaryExpectation,
    contactFound: { email: Boolean(emailMatch), phone: Boolean(phoneMatch) },
  };
}

/** Total experience: prefer an explicit statement, otherwise sum the parsed date ranges. */
export function computeTotalExperienceYears(allText: string): number | null {
  const explicit =
    allText.match(/(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:total\s+|overall\s+|professional\s+|work\s+|industry\s+)?experience/i) ??
    allText.match(/experience\s*(?:of)?\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)/i);
  if (explicit) {
    const value = Number(explicit[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 60) return value;
  }
  return null;
}

export function sumExperienceMonths(experiences: { durationMonths: number | null; isCurrent: boolean; startDate: string | null }[]): number {
  let total = 0;
  for (const exp of experiences) {
    if (exp.durationMonths !== null) total += exp.durationMonths;
    else if (exp.isCurrent && exp.startDate) {
      const months = (Date.now() - new Date(exp.startDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
      if (Number.isFinite(months)) total += Math.max(0, Math.round(months));
    }
  }
  return Math.round(total);
}

export function extractDateOfBirth(text: string): string | null {
  const match =
    text.match(/\b(?:date of birth|dob|d\.o\.b\.?)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i) ??
    text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4})\b/);
  if (!match) return null;
  const parsed = parseDateRange(match[1]);
  return parsed.start;
}

export function computeAge(isoDate: string, now = new Date()): number | null {
  const birth = new Date(isoDate);
  if (Number.isNaN(birth.getTime())) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 14 && age <= 80 ? age : null;
}

export function extractSalaryExpectation(text: string): string | null {
  const match = text.match(/\b(?:salary|ctc|package|expected ctc|expected salary)\s*(?:expectation)?\s*[:\-]?\s*(₹|rs\.?|inr)?\s*([\d.,]+\s*(?:lakh|lac|lpa|k|cr|crore)?\s*(?:-|–|to)\s*[\d.,]+\s*(?:lakh|lac|lpa|k|cr|crore)?|[\d.,]+\s*(?:lakh|lac|lpa|k|cr|crore))/i);
  return match ? match[0].replace(/\s+/g, ' ').trim().slice(0, 80) : null;
}

const INDUSTRY_KEYWORDS: [string, RegExp][] = [
  ['Banking & Financial Services', /\b(bank|nbfc|financial services|lending|credit|investment|mutual fund|stock|securities)\b/i],
  ['Accounting & Audit', /\b(accounting|audit|taxation|gst|chartered|bookkeeping|payroll)\b/i],
  ['Information Technology', /\b(software|it services|saas|web development|cloud|devops|application development)\b/i],
  ['Retail & E-commerce', /\b(retail|e-?commerce|store|merchandis|supply chain)\b/i],
  ['Manufacturing', /\b(manufactur|plant|production|assembly|factory)\b/i],
  ['Healthcare', /\b(hospital|clinic|patient|nursing|pharma)\b/i],
  ['Education', /\b(school|college|university|teaching|tutor|curriculum)\b/i],
  ['Marketing & Advertising', /\b(marketing|advertis|brand|campaign|media agency)\b/i],
  ['Logistics', /\b(logistic|freight|warehouse|transport|shipping)\b/i],
  ['Government / Public Sector', /\b(government|public sector|psu|ministry|department|municipal)\b/i],
];

export function inferIndustryFromText(text: string): string | null {
  for (const [label, pattern] of INDUSTRY_KEYWORDS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

export function parseResume(rawText: string): ParsedResume {
  const warnings: string[] = [];
  const { preamble, sections } = splitSections(rawText);

  const education = findEducation(sections.education ?? [], preamble);
  if (education.length === 0 && preamble.length) {
    // Some resumes put qualification in the header — check it before giving up.
    const fromPreamble = findEducation(preamble, []);
    if (fromPreamble.length) {
      education.push(...fromPreamble);
      warnings.push('No dedicated education section found; qualifications were read from the header area.');
    } else {
      warnings.push('No education qualification could be detected in this resume.');
    }
  }

  const experience = findExperience(sections.experience ?? []);
  if (experience.length === 0) warnings.push('No work experience section detected — treated as a fresher profile.');

  const skills = findSkills(sections.skills ?? [], rawText);
  if (skills.length === 0) warnings.push('No recognised skills detected; recommendations will rely on qualifications only.');

  const certifications = findCertifications(sections.certifications ?? []);
  const projects = findProjects(sections.projects ?? []);

  const personal = findPersonal(preamble, sections, rawText);
  if (personal.totalExperienceYears === null && experience.length > 0) {
    const months = sumExperienceMonths(experience);
    if (months > 0) personal.totalExperienceYears = Math.round((months / 12) * 10) / 10;
  }
  if (!personal.name) warnings.push('Candidate name could not be detected — it will be left blank rather than guessed.');

  return {
    rawText,
    sections: sections as Record<string, string[]>,
    personal,
    education,
    experience,
    skills,
    certifications,
    projects,
    warnings,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function capitalize(value: string): string {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

export { SECTION_ORDER };
