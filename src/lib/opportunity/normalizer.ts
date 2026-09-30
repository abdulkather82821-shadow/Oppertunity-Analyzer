import { createHash } from 'node:crypto';
import type { SearchHit } from '@/lib/search/types';
import { DEGREE_PATTERNS } from '@/lib/analysis/taxonomy';
import { parseIstDate } from './deadline';
import { isOfficialDomain, tierForUrl } from './trust';

/**
 * Opportunity normaliser.
 *
 * Turns raw search hits into the canonical opportunity shape. Only fields that are actually
 * evidenced by the source text are populated — everything else stays null so the UI can
 * render "Unknown" instead of a fabricated value.
 */

export interface NormalizedOpportunity {
  canonicalKey: string;
  title: string;
  organization: string;
  type: string;
  category: string;
  locations: string[];
  workMode: 'onsite' | 'remote' | 'hybrid' | 'unknown';
  employmentType: string;
  description: string;
  qualification: string[];
  degreeLevels: string[];
  fieldsOfStudy: string[];
  skills: string[];
  experienceRequired: string;
  experienceMinYears: number | null;
  salary: string;
  salaryMin: number | null;
  salaryMax: number | null;
  vacancies: number | null;
  ageMin: number | null;
  ageMax: number | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  examDate: string | null;
  officialSource: string;
  applicationUrl: string;
  sourceUrls: string[];
  tier: 1 | 2 | 3 | 4;
  sourceDate: string | null;
  isGovernment: boolean;
  claims: Record<string, string>;
  /** Ids of rows in our own catalogue that this record was derived from. */
  sourceOpportunityIds: string[];
  /** Source classification derived from the authoritative URL, not a column default. */
  sourceType: 'official' | 'secondary' | 'aggregator' | 'social';
}

const GOVERNMENT_HINT = /\b(govt|government|sarkari|ssc|upsc|ibps|rrb|sbi|tnpsc|psu|ministry|department|central government|state government|recruitment board|commission)\b/i;
const EXAM_HINT = /\b(exam|examination|notification|admit card|result|vacanc(y|ies)|apply online|last date|recruitment)\b/i;
const INTERNSHIP_HINT = /\b(intern|internship|trainee|apprentice|graduate trainee|management trainee)\b/i;

const CITY_PATTERN =
  /\b(Chennai|Coimbatore|Thanjavur|Salem|Madurai|Trichy|Tiruchirappalli|Bengaluru|Bangalore|Hyderabad|Mumbai|Pune|Delhi|New Delhi|Noida|Gurugram|Gurgaon|Kolkata|Ahmedabad|Jaipur|Lucknow|Kochi|Indore|Nagpur|Bhopal|Chandigarh|Tamil Nadu|Karnataka|Kerala|Telangana|Andhra Pradesh|Maharashtra|Gujarat|Rajasthan|Uttar Pradesh|West Bengal|Madhya Pradesh|Pan India|All India|India)\b/gi;

export function normaliseHit(hit: SearchHit, options: { intent?: string; query?: string } = {}): NormalizedOpportunity | null {
  const title = cleanTitle(hit.title);
  if (!title || title.length < 6) return null;
  const text = `${hit.title}. ${hit.snippet}`;
  const organization = extractOrganisation(text);
  const isGovernment = GOVERNMENT_HINT.test(text) || Boolean(hit.url && isOfficialDomain(hit.url).official);
  const type = isGovernment
    ? EXAM_HINT.test(text)
      ? 'exam'
      : 'government_job'
    : INTERNSHIP_HINT.test(text)
      ? 'internship'
      : 'job';

  const locations = [...new Set((text.match(CITY_PATTERN) ?? []).map((l) => titleCase(l)))].slice(0, 6);
  const workMode = /remote|work from home|wfh/i.test(text)
    ? 'remote'
    : /hybrid/i.test(text)
      ? 'hybrid'
      : locations.length || /on-?site|office/i.test(text)
        ? 'onsite'
        : 'unknown';

  const degreeLevels: string[] = [];
  const qualification: string[] = [];
  for (const rule of DEGREE_PATTERNS) {
    if (rule.pattern.test(text)) {
      if (!qualification.includes(rule.canonical)) qualification.push(rule.canonical);
      if (!degreeLevels.includes(rule.level)) degreeLevels.push(rule.level);
    }
  }

  const fieldsOfStudy: string[] = [];
  if (/commerce|b\.?com|m\.?com|accounting|finance/i.test(text)) fieldsOfStudy.push('commerce', 'accounting', 'finance');
  if (/engineering|b\.?tech|computer science/i.test(text)) fieldsOfStudy.push('engineering', 'computer science');
  if (/\bmba\b|management/i.test(text)) fieldsOfStudy.push('management');
  if (/\bca\b|chartered/i.test(text)) fieldsOfStudy.push('accounting');
  if (/economics|statistics|mathematics/i.test(text)) fieldsOfStudy.push('economics', 'statistics');

  const experience = extractExperience(text);
  const salary = extractSalary(text);
  const vacancies = extractVacancies(text);
  const age = extractAge(text);
  const dates = extractDates(text);

  const canonicalKey = canonicalKeyFor({ title, organization, category: type, deadline: dates.deadline });

  return {
    canonicalKey,
    title,
    organization,
    type,
    category: isGovernment ? classifyGovernmentCategory(text) : classifyPrivateCategory(text),
    locations,
    workMode,
    employmentType: /part[- ]?time/i.test(text) ? 'part_time' : /contract/i.test(text) ? 'contract' : INTERNSHIP_HINT.test(text) ? 'internship' : 'full_time',
    description: hit.snippet.slice(0, 1200),
    qualification: qualification.slice(0, 6),
    degreeLevels: degreeLevels.slice(0, 4),
    fieldsOfStudy: [...new Set(fieldsOfStudy)],
    skills: [],
    experienceRequired: experience.raw,
    experienceMinYears: experience.min,
    salary: salary.raw,
    salaryMin: salary.min,
    salaryMax: salary.max,
    vacancies,
    ageMin: age.min,
    ageMax: age.max,
    applicationStart: dates.start,
    applicationDeadline: dates.deadline,
    examDate: dates.exam,
    officialSource: isOfficialDomain(hit.url).official ? hit.url : '',
    applicationUrl: hit.url,
    sourceUrls: [hit.url],
    tier: hit.tier ?? tierForUrl(hit.url),
    sourceDate: hit.sourceDate ?? null,
    isGovernment,
    claims: buildClaims({ dates, vacancies, age, experience, salary }),
    sourceOpportunityIds: hit.sourceOpportunityId ? [hit.sourceOpportunityId] : [],
    sourceType: classifySourceType(hit.url, hit.tier ?? tierForUrl(hit.url)),
  };
}

/**
 * Classifies the authoritative URL. This is derived per record rather than left to the
 * column default, so an official `.gov.in` portal is never labelled a secondary source.
 */
const SOCIAL_HOSTS = /(linkedin\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|telegram\.|t\.me|whatsapp\.com|youtube\.com)/i;

export function classifySourceType(url: string, tier: number): 'official' | 'secondary' | 'aggregator' | 'social' {
  if (isOfficialDomain(url).official || tier <= 1) return 'official';
  if (SOCIAL_HOSTS.test(url)) return 'social';
  if (tier === 2) return 'secondary';
  return 'aggregator';
}

/** Only record what the source actually asserted — this is what conflict detection compares. */
function buildClaims(input: {
  dates: { start: string | null; deadline: string | null; exam: string | null };
  vacancies: number | null;
  age: { min: number | null; max: number | null };
  experience: { raw: string; min: number | null };
  salary: { raw: string };
}): Record<string, string> {
  const claims: Record<string, string> = {};
  if (input.dates.deadline) claims['application deadline'] = input.dates.deadline.slice(0, 10);
  if (input.dates.start) claims['application start'] = input.dates.start.slice(0, 10);
  if (input.dates.exam) claims['exam date'] = input.dates.exam.slice(0, 10);
  if (input.vacancies != null) claims.vacancies = String(input.vacancies);
  if (input.age.min != null || input.age.max != null) claims['age limit'] = `${input.age.min ?? '—'}-${input.age.max ?? '—'}`;
  if (input.experience.raw) claims.experience = input.experience.raw;
  if (input.salary.raw) claims.salary = input.salary.raw;
  return claims;
}

export function canonicalKeyFor(input: { title: string; organization: string; category: string; deadline?: string | null }): string {
  const titleKey = input.title
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|for|and|with|apply|online|latest|new|recruitment|notification|vacancy|vacancies|posts|jobs|exam|2024|2025|2026|2027)$/.test(w))
    .slice(0, 7)
    .sort()
    .join(' ');
  const orgKey = input.organization.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  const deadlineKey = input.deadline ? input.deadline.slice(0, 10) : '';
  return createHash('sha1').update(`${input.category}|${titleKey}|${orgKey}|${deadlineKey}`).digest('hex').slice(0, 20);
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[-|–—]\s*(Sarkari Result|FreeJobAlert|Testbook|Adda247|Career Power|Shiksha|Jagran Josh|Rojgar Live|Naukri|Indeed|LinkedIn).*$/i, '')
    .replace(/\s*[-|–—]\s*(Apply Online|Notification|Last Date|Exam Date|Official Website|Download).*$/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 160);
}

const ORG_PATTERNS = [
  /\b(Staff Selection Commission|Union Public Service Commission|Institute of Banking Personnel Selection|Railway Recruitment Board|Tamil Nadu Public Service Commission|State Bank of India|Reserve Bank of India|Securities and Exchange Board of India|National Bank for Agriculture and Rural Development|Life Insurance Corporation|Employees'? State Insurance Corporation)\b/i,
  /\b([A-Z][A-Za-z&'.\-]{2,40}?\s(?:Limited|Ltd|Technologies|Solutions|Systems|Consulting|Consultants|Services|Bank|University|Institute|College|School|Hospital|Industries|Enterprises|Group|Labs|Labs\.|Media|Infotech|Analytics))\b/,
  /\b([A-Z]{2,8})\b/,
];

export function extractOrganisation(text: string): string {
  for (const pattern of ORG_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1].trim();
      if (/^(SSC|UPSC|IBPS|RRB|SBI|RBI|SEBI|NABARD|LIC|ESIC|TNPSC|CTET|UGC|CSIR|ISRO|DRDO|NTPC|BHEL|ONGC|IOCL|GAIL|SAIL)$/.test(value)) return expandAcronym(value);
      if (value.length >= 3) return value;
    }
  }
  return '';
}

const ACRONYMS: Record<string, string> = {
  SSC: 'Staff Selection Commission',
  UPSC: 'Union Public Service Commission',
  IBPS: 'Institute of Banking Personnel Selection',
  RRB: 'Railway Recruitment Board',
  SBI: 'State Bank of India',
  RBI: 'Reserve Bank of India',
  SEBI: 'Securities and Exchange Board of India',
  NABARD: 'National Bank for Agriculture and Rural Development',
  LIC: 'Life Insurance Corporation of India',
  ESIC: "Employees' State Insurance Corporation",
  TNPSC: 'Tamil Nadu Public Service Commission',
  UGC: 'University Grants Commission',
  CSIR: 'Council of Scientific and Industrial Research',
  ISRO: 'Indian Space Research Organisation',
  DRDO: 'Defence Research and Development Organisation',
  NTPC: 'National Thermal Power Corporation',
  BHEL: 'Bharat Heavy Electricals Limited',
  ONGC: 'Oil and Natural Gas Corporation',
  IOCL: 'Indian Oil Corporation Limited',
  GAIL: 'Gas Authority of India Limited',
  SAIL: 'Steel Authority of India Limited',
};

export function expandAcronym(value: string): string {
  return ACRONYMS[value.toUpperCase()] ?? value;
}

export function extractExperience(text: string): { raw: string; min: number | null; max: number | null } {
  const match = text.match(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/i) ?? text.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:experience|exp)/i) ?? text.match(/(?:experience|exp)[:\s]*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/i);
  if (!match) return /fresher|no experience|0 experience/i.test(text) ? { raw: 'Fresher / no experience required', min: 0, max: null } : { raw: '', min: null, max: null };
  if (match[2]) return { raw: match[0], min: Number(match[1]), max: Number(match[2]) };
  const value = Number(match[1]);
  return { raw: match[0], min: Number.isFinite(value) && value <= 40 ? value : null, max: null };
}

export function extractSalary(text: string): { raw: string; min: number | null; max: number | null } {
  const lpa = text.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(lpa|lakh|lac|lakhs|per annum|p\.a\.)/i);
  if (lpa) {
    return {
      raw: lpa[0].trim(),
      min: Math.round(Number(lpa[1]) * 100_000),
      max: Math.round(Number(lpa[2]) * 100_000),
    };
  }
  const single = text.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(lpa|lakh|lac|lakhs)/i);
  if (single) return { raw: single[0].trim(), min: Math.round(Number(single[1]) * 100_000), max: null };

  const monthly = text.match(/(?:₹|rs\.?|inr)\s*(\d{3,7})\s*(?:-|–|to)\s*(\d{3,7})\s*(?:per month|\/\s*month|p\.?m\.?)/i);
  if (monthly) {
    return { raw: monthly[0].trim(), min: Number(monthly[1]) * 12, max: Number(monthly[2]) * 12 };
  }
  const payLevel = text.match(/pay\s*(?:level|scale|matrix)?\s*[:\-]?\s*(?:level[- ]?)?(\d{1,2})/i);
  if (payLevel) return { raw: payLevel[0].trim(), min: null, max: null };
  return { raw: '', min: null, max: null };
}

export function extractVacancies(text: string): number | null {
  const match = text.match(/(\d{1,3}(?:,\d{3})*|\d{1,6})\s*(?:total\s+)?(?:vacanc(?:y|ies)|posts?|seats?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 && value < 1_000_000 ? value : null;
}

export function extractAge(text: string): { min: number | null; max: number | null } {
  const range = text.match(/(?:age(?:\s+limit)?\s*[:\-]?\s*)?(\d{2})\s*(?:-|–|to)\s*(\d{2})\s*(?:years?|yrs?)/i);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min >= 15 && min <= 45 && max >= 18 && max <= 70 && max > min) return { min, max };
  }
  const single = text.match(/age\s*(?:limit)?\s*(?:up to|upto|max(?:imum)?)\s*[:\-]?\s*(\d{2})\s*(?:years?|yrs?)/i);
  if (single) {
    const max = Number(single[1]);
    if (max >= 18 && max <= 70) return { min: null, max };
  }
  return { min: null, max: null };
}

const DATE_LABELS: { key: 'start' | 'deadline' | 'exam'; pattern: RegExp }[] = [
  { key: 'deadline', pattern: /\b(?:last date(?:\s+(?:to apply|for (?:application|submission)))?|application (?:end|closing|last) date|closing date|apply (?:online )?(?:last date|by|before)|deadline|last date)\s*[:\-]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i },
  { key: 'start', pattern: /\b(?:application (?:start|opening|commencement|begins|opens)|start date|registration (?:start|opens|begins)|apply online (?:from|starts)|opening date|from)\s*[:\-]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i },
  { key: 'exam', pattern: /\b(?:exam(?:ination)?\s+date|cbt[- ]?1|prelims(?:\s+exam)?|test date|written exam|tier[- ]?(?:1|i)\s+exam)\s*[:\-]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})/i },
];

export function extractDates(text: string): { start: string | null; deadline: string | null; exam: string | null } {
  const out: { start: string | null; deadline: string | null; exam: string | null } = { start: null, deadline: null, exam: null };
  for (const label of DATE_LABELS) {
    const match = text.match(label.pattern);
    if (!match) continue;
    const parsed = parseIstDate(match[1], label.key === 'deadline');
    if (!parsed) continue;
    const year = parsed.getUTCFullYear();
    if (year < 2000 || year > new Date().getFullYear() + 6) continue; // implausible → ignore, do not guess
    out[label.key] = parsed.toISOString();
  }
  return out;
}

export function classifyGovernmentCategory(text: string): string {
  if (/\bssc\b|staff selection/i.test(text)) return 'ssc';
  if (/\bupsc\b|union public service/i.test(text)) return 'upsc';
  if (/\bibps\b|\bsbi\b|\brbi\b|bank/i.test(text)) return 'banking';
  if (/\brrb\b|railway/i.test(text)) return 'railway';
  if (/\btnpsc\b|\bkpsc\b|\buppsc\b|\bmpsc\b|\brpsc\b|public service commission/i.test(text)) return 'state_psc';
  if (/\bsebi\b|\bnabard\b|\birdai\b|regulatory/i.test(text)) return 'regulatory';
  if (/\bctet\b|\btet\b|\bkvs\b|\bnvs\b|teaching|teacher/i.test(text)) return 'teaching';
  if (/\blic\b|\bgic\b|\bniicl\b|insurance/i.test(text)) return 'insurance';
  if (/\bnda\b|\bcds\b|defence|defense|army|navy|air force/i.test(text)) return 'defence';
  if (/\bpolice\b|\bcapf\b|\bcrpf\b|\bcisf\b/i.test(text)) return 'police';
  if (/\bcourt\b|\bjudicial\b|\btribunal\b/i.test(text)) return 'court';
  if (/\buniversity\b|\bcollege\b|\biit\b|\biim\b|\bnit\b/i.test(text)) return 'university';
  if (/\bcsir\b|\bicmr\b|\bisro\b|\bdrdo\b|research/i.test(text)) return 'research';
  if (/\bapprentice/i.test(text)) return 'apprenticeship';
  if (/\bpsu\b|\bbhel\b|\bongc\b|\bntpc\b|\biocl\b/i.test(text)) return 'psu';
  return 'central';
}

export function classifyPrivateCategory(text: string): string {
  if (/account|financ|audit|tax|gst/i.test(text)) return 'Accounting & Finance';
  if (/software|developer|engineer|programming|java|python/i.test(text)) return 'Software Engineering';
  if (/data analy|analytics|business intelligence|power bi/i.test(text)) return 'Data & Analytics';
  if (/marketing|seo|social media|content/i.test(text)) return 'Digital Marketing';
  if (/\bhr\b|human resource|recruit/i.test(text)) return 'Human Resources';
  if (/sales|business development/i.test(text)) return 'Sales';
  if (/admin|office assistant|back office|data entry/i.test(text)) return 'Administration';
  if (/customer (?:support|service)|bpo|helpdesk/i.test(text)) return 'Customer Support';
  if (/teach|tutor|faculty|lecturer/i.test(text)) return 'Teaching & Academia';
  return 'General';
}

function titleCase(value: string): string {
  const lower = value.toLowerCase();
  if (lower === 'new delhi') return 'New Delhi';
  if (lower === 'pan india' || lower === 'all india') return 'Pan India';
  return lower.replace(/\b\w/g, (c) => c.toUpperCase());
}
