import { describe, expect, it } from 'vitest';
import { assessTrust, isOfficialDomain, isKnownAggregator, tierForUrl } from '@/lib/opportunity/trust';
import { checkEligibility, matchOpportunity, DEFAULT_WEIGHTS, bandFor } from '@/lib/opportunity/matcher';
import type { MatchableRecord } from '@/lib/opportunity/matcher';
import { profileCandidate } from '@/lib/analysis/profiler';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import { parseResume } from '@/lib/analysis/resume-parser';
import { canonicalKeyFor, cleanTitle, classifyPrivateCategory, extractVacancies } from '@/lib/opportunity/normalizer';
import { fingerprint, groupDuplicates, detectConflicts, titleSimilarity } from '@/lib/opportunity/dedupe';

/**
 * Trust, eligibility, normalisation and deduplication.
 *
 * These are the guards that keep a scraped listing from being presented as an authoritative
 * government notification, and keep one listing from being shown four times.
 */

const PROFILE: CandidateProfileData = profileCandidate(
  parseResume(`PRIYA RAMESH
Chennai, Tamil Nadu

EDUCATION
Bachelor of Commerce (B.Com), Accounting & Finance
University of Madras, Chennai — 2025, 78%

SKILLS
Tally ERP 9, MS Excel, GST Filing, TDS, Bank Reconciliation
`),
);

describe('source trust', () => {
  it('rates an official government domain as tier 1', () => {
    expect(tierForUrl('https://www.rrbapply.gov.in/notification')).toBe(1);
    expect(isOfficialDomain('https://ssc.gov.in/').official).toBe(true);
    expect(isOfficialDomain('https://upsconline.nic.in/').official).toBe(true);
  });

  it('treats a .gov.in host not on the curated list as official too', () => {
    expect(isOfficialDomain('https://tnpsc.gov.in/').official).toBe(true);
  });

  it('rates an aggregator low and never calls it official', () => {
    expect(isOfficialDomain('https://www.freejobalert.com/').official).toBe(false);
    expect(isKnownAggregator('https://www.freejobalert.com/')).toBe(true);
    expect(tierForUrl('https://www.freejobalert.com/')).toBeGreaterThan(1);
  });

  it('does not treat an arbitrary domain as official just because it looks formal', () => {
    expect(isOfficialDomain('https://careers-google.com/').official).toBe(false);
    expect(isOfficialDomain('https://ssc-gov-india.com/').official).toBe(false);
  });

  it('requires a high score for the "verified" label', () => {
    const official = assessTrust({
      title: 'RRB NTPC Graduate Level Recruitment 2026',
      organization: 'Railway Recruitment Board',
      officialSource: 'https://www.rrbapply.gov.in/cen-06-2026',
      sourceUrls: ['https://www.rrbapply.gov.in/cen-06-2026'],
      description: 'Centralised Employment Notice 06/2026, 3,477 vacancies',
    });
    expect(official.officialDomain).not.toBeNull();
    expect(official.tier).toBe(1);
    expect(official.label).toBe('verified');

    const weak = assessTrust({
      title: 'Latest Govt Job 2026',
      organization: 'Unknown',
      officialSource: null,
      sourceUrls: ['https://some-random-blog.blogspot.com/job'],
      description: 'apply now',
    });
    expect(weak.officialDomain).toBeNull();
    expect(weak.label).not.toBe('verified');
  });

  it('flags scam signals and caps the trust score', () => {
    const scam = assessTrust({
      title: 'Govt Job 2026 - Pay Rs 500 Registration Fee - Guaranteed Selection',
      organization: 'Unknown',
      officialSource: null,
      sourceUrls: ['https://quick-govt-jobs.blogspot.com/apply'],
      description: 'Guaranteed selection, limited seats, pay registration fee, urgent',
    });
    expect(scam.label).toBe('suspicious');
    expect(scam.score).toBeLessThan(50);
  });
});

describe('eligibility checking', () => {
  const record = (over: Partial<MatchableRecord> = {}): MatchableRecord => ({
    id: 'r1',
    title: 'Junior Accountant',
    degreeLevels: ['bachelor'],
    ageMin: 18,
    ageMax: 30,
    experienceMinYears: 0,
    nationality: 'Indian',
    ...over,
  });

  it('passes a candidate who clearly meets every requirement', () => {
    const result = checkEligibility(PROFILE, record());
    expect(result.verdict).toBe('probably_eligible');
    expect(result.blockers).toHaveLength(0);
    // Age is not derivable from a resume, so it is reported as an assumption, not a pass.
    expect(result.assumptions.some((a) => /age/i.test(a))).toBe(true);
  });

  it('understands free-text qualifications, not just canonical level names', () => {
    // Scraped notifications say "Bachelor's degree in any stream"; the catalogue says "bachelor".
    // Both must be understood, or every bachelor's candidate is wrongly rejected.
    const freeText = checkEligibility(PROFILE, record({ degreeLevels: [], qualification: ["Bachelor's degree in any stream"] }));
    expect(freeText.verdict).toBe('probably_eligible');
    expect(freeText.blockers).toHaveLength(0);

    const masters = checkEligibility(PROFILE, record({ degreeLevels: [], qualification: ['MBA/PGDM'] }));
    expect(masters.verdict).toBe('not_eligible');
  });

  it('reports an uninterpretable qualification as unverified rather than guessing a level', () => {
    const result = checkEligibility(PROFILE, record({ degreeLevels: [], qualification: ['see notification annexure'] }));
    expect(result.verdict).toBe('probably_eligible');
    expect(result.assumptions.some((a) => /could not be interpreted/i.test(a))).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks on a hard qualification mismatch and says exactly why', () => {
    const result = checkEligibility(PROFILE, record({ degreeLevels: ['masters'], qualification: ['MBBS'] }));
    expect(result.verdict).toBe('not_eligible');
    expect(result.blockers.length).toBeGreaterThan(0);
  });

  it('never asserts eligibility when the requirements could not be read', () => {
    const result = checkEligibility(PROFILE, record({ degreeLevels: [], ageMin: null, ageMax: null, nationality: '' }));
    // Nothing is verifiable, so nothing may be claimed as satisfied.
    expect(result.verdict).toBe('probably_eligible');
    expect(result.blockers).toHaveLength(0);
    expect(result.checks.every((c) => c.outcome === 'unknown')).toBe(true);
    expect(result.checks.every((c) => c.outcome !== 'pass')).toBe(true);
  });

  it('treats an unknown candidate age as an assumption, not a blocker', () => {
    const noAge: CandidateProfileData = {
      ...PROFILE,
      personal: { ...PROFILE.personal, dateOfBirth: null, ageYears: null },
    };
    const result = checkEligibility(noAge, record({ ageMin: 18, ageMax: 30 }));
    expect(result.verdict).not.toBe('not_eligible');
    expect(result.assumptions.some((a) => /age/i.test(a))).toBe(true);
  });

  it('blocks when the candidate exceeds the maximum age', () => {
    const tooOld: CandidateProfileData = {
      ...PROFILE,
      personal: { ...PROFILE.personal, ageYears: 45 },
    };
    const result = checkEligibility(tooOld, record({ ageMin: 18, ageMax: 30 }));
    expect(result.verdict).toBe('not_eligible');
  });
});

describe('match scoring', () => {
  it('scores a well-fitting job above a poor one', () => {
    const good = matchOpportunity(PROFILE, {
      id: 'a',
      title: 'Junior Accountant',
      organization: 'Acme',
      jobFamily: 'Accounting & Finance',
      locations: ['Chennai'],
      skills: ['MS Excel', 'Tally ERP', 'GST Filing'],
      degreeLevels: ['bachelor'],
      experienceMinYears: 0,
      isFresherFriendly: true,
      salaryMin: 300000,
    });
    const bad = matchOpportunity(PROFILE, {
      id: 'b',
      title: 'Senior DevOps Engineer',
      organization: 'Beta',
      jobFamily: 'DevOps',
      locations: ['Mumbai'],
      skills: ['Kubernetes', 'Terraform', 'Go'],
      degreeLevels: ['masters'],
      experienceMinYears: 8,
    });
    expect(good.overall).toBeGreaterThan(bad.overall);
  });

  it('caps the score and forces the not_eligible band when a hard blocker exists', () => {
    const blocked = matchOpportunity(PROFILE, {
      id: 'c',
      title: 'Medical Officer',
      organization: 'Hospital',
      locations: ['Chennai'],
      skills: ['MBBS'],
      degreeLevels: ['master'],
      experienceMinYears: 5,
    });
    expect(blocked.eligible).toBe('not_eligible');
    expect(blocked.band).toBe('not_eligible');
    expect(blocked.overall).toBeLessThanOrEqual(25);
    expect(blocked.label).toMatch(/not eligible/i);
    // A hard blocker overrides any score, however high the skill overlap happens to be.
    expect(bandFor(99, 'not_eligible', 1)).toBe('not_eligible');
  });

  it('reports matched and missing skills without inventing any', () => {
    const result = matchOpportunity(PROFILE, {
      id: 'd',
      title: 'Accountant',
      locations: ['Chennai'],
      skills: ['MS Excel', 'Tally ERP', 'SAP'],
      degreeLevels: ['bachelor'],
    });
    // SAP was never on the resume, so it must appear as a gap and never as a match.
    expect(result.missingSkills.some((m) => /sap/i.test(m))).toBe(true);
    expect(result.matchedSkills.some((m) => /sap/i.test(m))).toBe(false);
    expect(result.matchedSkills.some((m) => /excel/i.test(m))).toBe(true);
  });

  it('returns component scores in the 0-100 range and honours the configured weights', () => {
    const result = matchOpportunity(PROFILE, { id: 'e', title: 'Tax Associate', skills: ['TDS'], degreeLevels: ['bachelor'] });
    const components = Object.entries(result.breakdown);
    expect(components.length).toBeGreaterThan(5);
    for (const [key, score] of components) {
      expect(score, key).toBeGreaterThanOrEqual(0);
      expect(score, key).toBeLessThanOrEqual(100);
    }
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('uses a separate eligibility-gated model for government records', () => {
    const result = matchOpportunity(PROFILE, {
      id: 'g',
      title: 'RRB NTPC Junior Accounts Assistant',
      organization: 'Railway Recruitment Board',
      category: 'railway',
      type: 'exam',
      isGovernment: true,
      degreeLevels: ['bachelor'],
      qualification: ['Bachelor Degree'],
    });
    expect(result.model).toBe('government');
  });
});

describe('normalisation', () => {
  it('produces the same canonical key regardless of case and noise words', () => {
    const a = canonicalKeyFor({ title: 'RRB NTPC Graduate Level Recruitment 2026', organization: 'Railway Recruitment Board', category: 'railway', deadline: '2026-11-06' });
    const b = canonicalKeyFor({ title: 'rrb ntpc graduate level recruitment 2026', organization: 'railway recruitment board', category: 'railway', deadline: '2026-11-06' });
    expect(a).toBe(b);
  });

  it('produces a different key when the deadline genuinely differs', () => {
    const a = canonicalKeyFor({ title: 'SSC CGL 2026', organization: 'SSC', category: 'ssc', deadline: '2026-06-22' });
    const b = canonicalKeyFor({ title: 'SSC CGL 2026', organization: 'SSC', category: 'ssc', deadline: '2026-06-25' });
    expect(a).not.toBe(b);
  });

  it('strips job-portal decoration from titles', () => {
    expect(cleanTitle('  Junior Accountant - Naukri.com  ')).toBe('Junior Accountant');
    expect(cleanTitle('Junior Accountant — Apply Online')).toBe('Junior Accountant');
    expect(cleanTitle('Junior Accountant - Sarkari Result')).toBe('Junior Accountant');
  });

  it('classifies a commerce listing into an accounting category', () => {
    expect(classifyPrivateCategory('Junior Accountant for B.Com graduates')).toMatch(/account/i);
  });

  it('reads a vacancy count out of free text', () => {
    expect(extractVacancies('3,477 vacancies across various levels')).toBe(3477);
    expect(extractVacancies('no number here')).toBeNull();
  });
});

describe('deduplication and conflicts', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: 'x1',
    title: 'RRB NTPC Graduate Level Recruitment 2026',
    organization: 'Railway Recruitment Board',
    category: 'railway',
    location: 'India',
    applicationDeadline: '2026-11-06',
    officialSource: 'https://www.rrbapply.gov.in/cen-06-2026',
    sourceUrls: ['https://www.rrbapply.gov.in/cen-06-2026'],
    sourceTier: 1,
    trustScore: 100,
    isGovernment: true,
    ...over,
  });

  it('fingerprints the same listing identically across sources', () => {
    const a = fingerprint(candidate({ id: 'a' }));
    const b = fingerprint(candidate({ id: 'b', title: 'RRB NTPC Graduate Level Recruitment 2026' }));
    expect(a).toBe(b);
  });

  it('groups the same listing from four sources into one group', () => {
    const groups = groupDuplicates([
      candidate({ id: '1', sourceUrls: ['https://www.rrbapply.gov.in/a'] }),
      candidate({ id: '2', sourceUrls: ['https://www.freejobalert.com/a'], sourceTier: 4, trustScore: 55 }),
      candidate({ id: '3', sourceUrls: ['https://www.rojgarlive.com/a'], sourceTier: 4, trustScore: 50 }),
      candidate({ id: '4', sourceUrls: ['https://governmentdailyjobs.com/a'], sourceTier: 4, trustScore: 45 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sourceCount).toBeGreaterThanOrEqual(4);
    // The official source must win as the representative, not the first one seen.
    expect(groups[0].representative.officialSource).toMatch(/rrbapply\.gov\.in/);
  });

  it('keeps two genuinely different listings apart', () => {
    const groups = groupDuplicates([
      candidate({ id: '1' }),
      candidate({ id: '2', title: 'SSC CGL Tier I 2026', organization: 'Staff Selection Commission', category: 'ssc', applicationDeadline: '2026-06-25' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('measures title similarity rather than requiring an exact match', () => {
    expect(titleSimilarity('Junior Accountant', 'Junior Accountant')).toBe(1);
    expect(titleSimilarity('Junior Accountant', 'Senior DevOps Engineer')).toBeLessThan(0.5);
  });

  it('surfaces conflicting deadlines from different sources instead of silently picking one', () => {
    const conflicts = detectConflicts([
      candidate({ id: '1', title: 'SSC CGL 2026', organization: 'SSC', category: 'ssc', applicationDeadline: '2026-06-25', officialSource: 'https://ssc.gov.in/x', sourceUrls: ['https://ssc.gov.in/x'], sourceTier: 1, isGovernment: true }),
      candidate({ id: '2', title: 'SSC CGL 2026', organization: 'SSC', category: 'ssc', applicationDeadline: '2026-06-22', officialSource: null, sourceUrls: ['https://www.freejobalert.com/x'], sourceTier: 4, isGovernment: true }),
    ]);
    const deadlineConflict = conflicts.find((c) => /deadline/i.test(c.field));
    expect(deadlineConflict).toBeDefined();
    expect(deadlineConflict!.values.length).toBe(2);
    const dates = deadlineConflict!.values.map((v) => v.value);
    expect(dates.some((d) => d.includes('2026-06-25'))).toBe(true);
    expect(dates.some((d) => d.includes('2026-06-22'))).toBe(true);
  });
});


describe('qualification alternatives', () => {
  const base = (over: Partial<MatchableRecord>): MatchableRecord => ({ id: 'q', title: 'Post', ...over });

  it('treats a qualification list as alternatives: B.Com / M.Com / MBA accepts a B.Com graduate', () => {
    const result = checkEligibility(PROFILE, base({ qualification: ['M.Com', 'B.Com', 'MBA'], degreeLevels: ['bachelor', 'master'] }));
    expect(result.blockers).toHaveLength(0);
    expect(result.verdict).not.toBe('not_eligible');
  });

  it('accepts "MBA, BBA or any bachelor\'s degree" without blocking on the derived field list', () => {
    const result = checkEligibility(
      PROFILE,
      base({ qualification: ['MBA', 'BBA', "Bachelor's degree"], degreeLevels: ['bachelor', 'master'], fieldsOfStudy: ['management'] }),
    );
    expect(result.blockers).toHaveLength(0);
    const field = result.checks.find((c) => c.field === 'Field of study');
    expect(field?.outcome).toBe('pass');
  });

  it('accepts a stream-restricted bachelor\'s clause alongside a professional alternative', () => {
    const result = checkEligibility(
      PROFILE,
      base({
        qualification: ["Bachelor's degree in Law / Engineering / Economics / Commerce / Management, or CA/CFA/CS"],
        degreeLevels: ['bachelor'],
        fieldsOfStudy: ['commerce', 'finance', 'economics', 'management'],
      }),
    );
    expect(result.blockers).toHaveLength(0);
  });

  it('blocks when EVERY alternative is out of reach, and names them all', () => {
    const result = checkEligibility(PROFILE, base({ qualification: ['CA', 'M.Com', 'MBA/PGDM'], degreeLevels: ['master', 'professional'] }));
    expect(result.verdict).toBe('not_eligible');
    expect(result.blockers.join(' ')).toMatch(/Chartered Accountant.*M\.Com.*MBA|one of/);
  });

  it('does not let a structured degree level bypass a named professional requirement', () => {
    // degreeLevels are derived from the named degree; they must not add a free "bachelor" pass.
    const result = checkEligibility(PROFILE, base({ qualification: ['MBBS'], degreeLevels: ['bachelor'] }));
    expect(result.verdict).toBe('not_eligible');
  });

  it('accepts a higher degree in the same stream for a lower named requirement', () => {
    const mcom = profileCandidate(parseResume('MEERA S\nEDUCATION\nM.Com, University of Madras - 2024\n'));
    expect(checkEligibility(mcom, base({ qualification: ['B.Com'] })).blockers).toHaveLength(0);
    // ...but the reverse does not hold: a B.Com is not an M.Com.
    expect(checkEligibility(PROFILE, base({ qualification: ['M.Com'] })).verdict).toBe('not_eligible');
  });
});
