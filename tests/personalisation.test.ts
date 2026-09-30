import { describe, expect, it } from 'vitest';
import { enrichOpportunity, toMatchable } from '@/lib/api/enrich';
import { feedbackAdjustFor, scoreForUser, type FeedbackCounts, type ScoringContext } from '@/lib/opportunity/personal';
import { profileCandidate } from '@/lib/analysis/profiler';
import { parseResume } from '@/lib/analysis/resume-parser';

/**
 * Scores belong to the viewer.
 *
 * The opportunities table is shared, so any score stored on a row belongs to whoever wrote it
 * last. These tests pin the rule that fit, eligibility, band and ranking are computed per
 * viewer, from their own profile, weights, locations and feedback — and that a stored value
 * can never leak from one user into another's results.
 */

const COMMERCE = profileCandidate(
  parseResume(`PRIYA RAMESH
Chennai, Tamil Nadu

EDUCATION
Bachelor of Commerce (B.Com), Accounting & Finance
University of Madras, Chennai - 2025

SKILLS
Tally ERP 9, MS Excel, GST Filing, TDS, Bank Reconciliation, Accounts Payable
`),
);

const ENGINEER = profileCandidate(
  parseResume(`ARJUN MEHTA
Bengaluru, Karnataka

EDUCATION
B.E Computer Science
Anna University, Chennai - 2021

EXPERIENCE
Software Engineer - Acme Systems, Bengaluru
June 2021 - Present
- Built REST APIs in Node.js and React.

SKILLS
JavaScript, TypeScript, React, Node.js, SQL, Docker, AWS, Git
`),
);

/** A database-shaped row, as returned by `SELECT * FROM opportunities`. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    title: 'Accounts Executive',
    organization: 'Acme Finance',
    type: 'job',
    category: 'accounting',
    locations: JSON.stringify(['Chennai']),
    work_mode: 'onsite',
    qualification: JSON.stringify(['B.Com', 'M.Com']),
    degree_levels: JSON.stringify(['bachelor']),
    fields_of_study: JSON.stringify(['commerce', 'accounting']),
    skills: JSON.stringify(['Tally ERP', 'MS Excel', 'GST Filing']),
    experience_min_years: 0,
    is_fresher_friendly: 1,
    application_deadline: new Date(Date.now() + 20 * 86_400_000).toISOString(),
    status: 'applications_open',
    trust_score: 90,
    quality_score: 80,
    verification_status: 'verified',
    duplicate_count: 1,
    official_source: 'https://acme.example/careers',
    application_url: 'https://acme.example/apply',
    ...over,
  };
}

const softwareRow = row({
  id: 'row-2',
  title: 'Backend Engineer',
  category: 'software',
  locations: JSON.stringify(['Bengaluru']),
  qualification: JSON.stringify(['B.Tech', 'BE/B.Tech']),
  degree_levels: JSON.stringify(['bachelor']),
  fields_of_study: JSON.stringify(['computer science', 'engineering']),
  skills: JSON.stringify(['Node.js', 'TypeScript', 'SQL', 'Docker']),
});

const score = (r: any, profile: typeof COMMERCE, ctx?: Partial<ScoringContext> | null) => scoreForUser(r, toMatchable(r), profile, ctx);

describe('per-viewer scoring', () => {
  it('ranks the same role differently for different people', () => {
    const accounting = row();
    expect(score(accounting, COMMERCE).finalScore).toBeGreaterThan(score(accounting, ENGINEER).finalScore);
    expect(score(softwareRow, ENGINEER).finalScore).toBeGreaterThan(score(softwareRow, COMMERCE).finalScore);
  });

  it('ignores any score stored on the shared row', () => {
    // Whoever searched last wrote these. They must not reach another viewer.
    const inflated = row({ match_score: 99, final_score: 99, eligibility_status: 'eligible', explanation: 'stale text' });
    const pristine = row();
    expect(score(inflated, COMMERCE).finalScore).toBe(score(pristine, COMMERCE).finalScore);
    expect(enrichOpportunity(inflated, COMMERCE).finalScore).toBe(enrichOpportunity(pristine, COMMERCE).finalScore);
    expect(enrichOpportunity(inflated, ENGINEER).finalScore).toBeLessThan(99);
  });

  it('is deterministic for one viewer and one row', () => {
    const a = score(row(), COMMERCE);
    const b = score(row(), COMMERCE);
    expect(a.finalScore).toBe(b.finalScore);
    expect(a.match.overall).toBe(b.match.overall);
  });

  it("applies the viewer's own scoring weights", () => {
    // An eligible pairing (the cap for ineligible roles would mask any weighting effect).
    const onlyLocation = { skill: 0, qualification: 0, experience: 0, role: 0, location: 100, industry: 0, salary: 0, careerGrowth: 0 };
    const onlySkill = { skill: 100, qualification: 0, experience: 0, role: 0, location: 0, industry: 0, salary: 0, careerGrowth: 0 };
    const job = row({ locations: JSON.stringify(['Delhi']) }); // far from a Chennai candidate
    const byLocation = score(job, COMMERCE, { weights: onlyLocation }).match.overall;
    const bySkill = score(job, COMMERCE, { weights: onlySkill }).match.overall;
    // Skills match well, the city does not: so the two weightings must disagree, in that order.
    expect(bySkill).toBeGreaterThan(byLocation);
  });

  it("uses the viewer's preferred locations, in addition to where they live", () => {
    const chennaiJob = row();
    // The engineer lives in Bengaluru; saying they would move to Chennai must help, Delhi must not.
    const wouldMove = score(chennaiJob, ENGINEER, { preferredLocations: ['Chennai'] }).match.breakdown.location;
    const wouldNot = score(chennaiJob, ENGINEER, { preferredLocations: ['Delhi'] }).match.breakdown.location;
    expect(wouldMove).toBeGreaterThan(wouldNot);
    // A candidate's own city always counts, whatever else they list.
    const athome = score(chennaiJob, COMMERCE, { preferredLocations: ['Delhi'] }).match.breakdown.location;
    expect(athome).toBeGreaterThanOrEqual(wouldMove);
  });

  it("lets the viewer's feedback move the ranking, and only theirs", () => {
    const rejecter: FeedbackCounts = {
      overall: { relevant: 0, notRelevant: 6, notEligible: 0, wrongInformation: 0 },
      byCategory: { accounting: { relevant: 0, notRelevant: 5 } },
    };
    const neutral = score(row(), COMMERCE, { feedback: { overall: { relevant: 0, notRelevant: 0, notEligible: 0, wrongInformation: 0 }, byCategory: {} } });
    const rejected = score(row(), COMMERCE, { feedback: rejecter });
    expect(rejected.finalScore).toBeLessThan(neutral.finalScore);
    // Someone with no feedback history is unaffected by another user's rejections.
    expect(score(row(), COMMERCE).finalScore).toBe(neutral.finalScore);
  });

  it('bounds the feedback adjustment so one bad day cannot bury everything', () => {
    const extreme: FeedbackCounts = { overall: { relevant: 0, notRelevant: 500, notEligible: 500, wrongInformation: 500 }, byCategory: {} };
    expect(feedbackAdjustFor(extreme, 'accounting')).toBeGreaterThanOrEqual(-18 - 15);
    expect(feedbackAdjustFor(null, 'accounting')).toBe(0);
  });
});

describe('view model honesty', () => {
  it('marks scores as personal only when a profile was used', () => {
    expect(enrichOpportunity(row(), COMMERCE).personalised).toBe(true);
    expect(enrichOpportunity(row(), null).personalised).toBe(false);
  });

  it('caps a clearly ineligible role at the not-eligible band however trusted the source', () => {
    const view = enrichOpportunity(row({ qualification: JSON.stringify(['MBBS']), degree_levels: JSON.stringify(['bachelor']), fields_of_study: '[]', title: 'Medical Officer' }), COMMERCE);
    expect(view.eligibilityStatus).toBe('not_eligible');
    expect(view.band).toBe('not_eligible');
    expect(view.finalScore).toBeLessThanOrEqual(25);
  });

  it('never labels a closed application a good match', () => {
    const closed = row({ application_deadline: new Date(Date.now() - 5 * 86_400_000).toISOString(), status: 'applications_closed' });
    const view = enrichOpportunity(closed, COMMERCE);
    expect(view.isClosed).toBe(true);
    expect(view.finalScore).toBeLessThanOrEqual(25);
    expect(['perfect', 'strong', 'good']).not.toContain(view.band);
  });

  it('explains the score from the viewer’s own evidence, with strengths and gaps that are real', () => {
    const view = enrichOpportunity(softwareRow, COMMERCE);
    // The commerce candidate never listed Node.js, so it must appear as a gap and never a strength.
    expect(view.gaps.join(' ')).toMatch(/node/i);
    expect(view.strengths.join(' ')).not.toMatch(/node/i);
    expect(view.scoreBreakdown.length).toBeGreaterThan(3);
    for (const part of view.scoreBreakdown) {
      expect(part.score).toBeGreaterThanOrEqual(0);
      expect(part.score).toBeLessThanOrEqual(100);
    }
  });
});
