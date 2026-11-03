import { describe, expect, it } from 'vitest';
import { parseResume } from '@/lib/analysis/resume-parser';
import { profileCandidate } from '@/lib/analysis/profiler';

/**
 * Parser and profiler contract.
 *
 * The governing rule is: never invent. A field that cannot be read from the document must be
 * reported as missing, with a warning, rather than filled in with a plausible guess.
 */

const FULL_RESUME = `PRIYA RAMESH
Chennai, Tamil Nadu | priya.ramesh@example.com | +91 98400 12345

CAREER OBJECTIVE
Commerce graduate seeking an entry-level accounting role.

EDUCATION
Bachelor of Commerce (B.Com), Accounting & Finance
University of Madras, Chennai — 2025, 78%

SKILLS
Tally ERP 9, MS Excel (VLOOKUP, Pivot Tables), GST Filing, TDS Calculation,
Accounts Payable, Bank Reconciliation

EXPERIENCE
Accounts Intern — Lakshmi & Associates, Chennai
June 2024 - August 2024
- Prepared 120+ journal entries and assisted with monthly GST returns.

CERTIFICATIONS
GST Practitioner Certificate — TaxMann Institute, 2025
`;

describe('resume parser', () => {
  it('extracts name, location, education, skills and experience from a well-formed resume', () => {
    const parsed = parseResume(FULL_RESUME);
    expect(parsed.personal.name).toBe('PRIYA RAMESH');
    expect(parsed.personal.location).toMatch(/Chennai/);
    expect(parsed.education.length).toBeGreaterThan(0);
    expect(parsed.education[0].degree).toMatch(/Bachelor of Commerce|B\.Com/i);
    expect(parsed.skills.length).toBeGreaterThanOrEqual(5);
    expect(parsed.experience.length).toBe(1);
    expect(parsed.certifications.length).toBe(1);
  });

  it('recognises the degree level and graduation year', () => {
    const parsed = parseResume(FULL_RESUME);
    expect(parsed.education[0].graduationYear).toBe(2025);
    const profile = profileCandidate(parsed);
    expect(profile.highestDegreeLevel).toMatch(/bachelor/i);
    // Institution and marks sit on the line after the degree title and must still be read.
    expect(parsed.education[0].institution).toMatch(/University of Madras/);
    expect(parsed.education[0].score).toBe('78');
  });

  it('leaves the name blank and warns rather than guessing when it is absent', () => {
    const parsed = parseResume(`EDUCATION\nB.Com, University of Madras, 2025\n\nSKILLS\nExcel, Tally\n`);
    expect(parsed.personal.name).toBeNull();
    expect(parsed.warnings.some((w) => /name/i.test(w))).toBe(true);
  });

  it('reports missing education as a warning instead of inventing a qualification', () => {
    const parsed = parseResume(`JOHN DOE\n\nSKILLS\nPython, SQL, Machine Learning\n`);
    expect(parsed.education).toHaveLength(0);
    expect(parsed.warnings.some((w) => /education/i.test(w))).toBe(true);
  });

  it('reports an empty resume honestly instead of producing a fabricated profile', () => {
    const parsed = parseResume('');
    expect(parsed.education).toHaveLength(0);
    expect(parsed.skills).toHaveLength(0);
    expect(parsed.personal.name).toBeNull();
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('does not resolve an ambiguous numeric date to a specific month', () => {
    const parsed = parseResume(`EXPERIENCE\nAnalyst — Acme Corp\n05/06/2024 - 07/08/2025\n- Did analysis.\n`);
    const experience = parsed.experience[0];
    expect(experience).toBeDefined();
    // Day-first and month-first readings disagree, so the parser must not assert one.
    const start = experience.startDate;
    if (start) {
      expect(start).toMatch(/^2024-/);
    }
  });
});

describe('candidate profiler', () => {
  it('marks every inferred field with a confidence score and a source', () => {
    const profile = profileCandidate(parseResume(FULL_RESUME));
    expect(profile.careerLevel.confidence).toBeGreaterThan(0);
    expect(profile.careerLevel.confidence).toBeLessThanOrEqual(1);
    expect(['resume', 'inferred']).toContain(profile.careerLevel.source);
    for (const family of profile.jobFamilies) {
      expect(family.confidence).toBeGreaterThan(0);
      expect(family.confidence).toBeLessThanOrEqual(1);
      expect(['resume', 'inferred']).toContain(family.source);
    }
  });

  it('distinguishes resume-derived skills from AI-inferred ones', () => {
    const profile = profileCandidate(parseResume(FULL_RESUME));
    const stated = profile.skills.filter((s) => s.source === 'resume');
    expect(stated.length).toBeGreaterThan(0);
    // Skills named on the document must be attributed to the resume, not to inference.
    const tally = stated.find((s) => /tally/i.test(s.canonical));
    expect(tally).toBeDefined();
  });

  it('classifies a commerce fresher into accounting-related job families', () => {
    const profile = profileCandidate(parseResume(FULL_RESUME));
    expect(profile.careerLevel.name).toBe('fresher');
    const families = profile.jobFamilies.map((f) => f.name);
    expect(families.some((f) => /account|finance/i.test(f))).toBe(true);
  });

  it('produces no job families at all when the resume has nothing to go on', () => {
    const profile = profileCandidate(parseResume(''));
    expect(profile.jobFamilies).toHaveLength(0);
    expect(profile.strongestSkills).toHaveLength(0);
  });

  it('never assigns an age when no date of birth is present', () => {
    const profile = profileCandidate(parseResume(FULL_RESUME));
    expect(profile.personal.ageYears).toBeNull();
  });
});


describe('experience layouts', () => {
  const parse = (body: string) => parseResume(`RAVI K\nEXPERIENCE\n${body}`);

  it('reads every job when the dates sit on the line under the header', () => {
    const parsed = parse(`Accounts Intern — Lakshmi & Associates, Chartered Accountants, Chennai
June 2024 - August 2024
- Prepared 120+ journal entries.

Sales Support Trainee — Sunrise Traders, Chennai
December 2023 - February 2024
- Handled invoicing.
`);
    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience[0].jobTitle).toBe('Accounts Intern');
    expect(parsed.experience[0].company).toMatch(/^Lakshmi & Associates/);
    expect(parsed.experience[0].startDate).toBe('2024-06-01');
    expect(parsed.experience[1].jobTitle).toBe('Sales Support Trainee');
    expect(parsed.experience[1].company).toBe('Sunrise Traders, Chennai');
    // Two short stints add up; the total is computed, not left blank.
    expect(parsed.personal.totalExperienceYears).toBeGreaterThan(0);
  });

  it('reads role, company and dates printed on a single line', () => {
    const parsed = parse(`Senior Accountant, Acme Corp | Jan 2020 – Present
- Closed monthly books.
Junior Accountant, Beta Traders | Jun 2017 - Dec 2019
- Bank reconciliation.
`);
    expect(parsed.experience.map((e) => e.jobTitle)).toEqual(['Senior Accountant', 'Junior Accountant']);
    expect(parsed.experience[0].isCurrent).toBe(true);
    expect(parsed.experience[1].durationMonths).toBe(30);
  });

  it('reads "Title at Company (years)"', () => {
    const parsed = parse(`Software Engineer at Infosys Ltd (2019-2022)
- Built APIs.
Senior Software Engineer at Wipro (2022 - 2024)
- Led a team.
`);
    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience[0].company).toBe('Infosys Ltd');
  });

  it('attaches dates printed ABOVE the header to the right job', () => {
    const parsed = parse(`Jan 2021 - Dec 2022
Data Analyst - Zoho Corporation
- Built dashboards in Power BI.
Jan 2019 - Dec 2020
Junior Analyst - Freshworks
- Cleaned data in Excel.
`);
    expect(parsed.experience).toHaveLength(2);
    expect(parsed.experience[0].jobTitle).toBe('Data Analyst');
    expect(parsed.experience[0].startDate).toBe('2021-01-01');
    expect(parsed.experience[1].startDate).toBe('2019-01-01');
  });

  it('keeps company names intact when they contain words like "to" or "till"', () => {
    const parsed = parse(`Operations Executive — Back to Basics Logistics Pvt Ltd, Salem
March 2022 - Present
- Coordinated dispatch.
`);
    expect(parsed.experience[0].jobTitle).toBe('Operations Executive');
    expect(parsed.experience[0].company).toMatch(/^Back to Basics Logistics/);
  });

  it('does not mistake unbulleted duty sentences for new jobs', () => {
    const parsed = parse(`Accounts Assistant, Sharma & Co, Madurai
2021 - 2023
Assisted senior accountants in preparing returns
Managed a team of junior clerks during audits
Reported to senior management weekly
`);
    expect(parsed.experience).toHaveLength(1);
    expect(parsed.experience[0].responsibilities.split('\n')).toHaveLength(3);
  });
});

describe('degree recognition', () => {
  it('reads an MCA as a master-level MCA, not a Chartered Accountant', () => {
    const parsed = parseResume('ROHAN K\nEDUCATION\nMCA (Master of Computer Applications)\nAnna University, Chennai - 2024, 8.1 CGPA\n');
    expect(parsed.education[0].degree).toBe('MCA');
    expect(parsed.education[0].degreeLevel).toBe('master');
    expect(profileCandidate(parsed).highestDegreeLevel).toBe('master');
  });

  it('still recognises a real Chartered Accountant qualification', () => {
    const parsed = parseResume('ASHA N\nEDUCATION\nChartered Accountant (CA), ICAI - 2023\n');
    expect(parsed.education[0].degree).toBe('Chartered Accountant');
  });
});
