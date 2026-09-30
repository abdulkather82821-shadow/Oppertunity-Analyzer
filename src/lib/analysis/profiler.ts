import {
  DEGREE_LEVEL_RANK,
  EXAM_CATEGORIES,
  GOVERNMENT_CATEGORIES,
  LOCATIONS,
  SKILL_TAXONOMY,
  type DegreeLevel,
} from './taxonomy';
import {
  sumExperienceMonths,
  type ParsedEducation,
  type ParsedExperience,
  type ParsedResume,
  type ParsedSkill,
} from './resume-parser';

/**
 * Candidate profiler — deterministic scoring layer.
 * Every inferred field carries a confidence score and a `source` of either `resume`
 * (found in the document) or `inferred` (derived by rule). The UI renders those two
 * differently, so a user can always see what the document said versus what the AI concluded.
 */

export interface ScoredItem {
  name: string;
  confidence: number;
  source: 'resume' | 'inferred';
  rationale?: string;
}

export interface CareerPath {
  target: string;
  confidence: number;
  rationale: string;
  requiredSkills: string[];
  gapSkills: string[];
}

export interface CandidateProfileData {
  personal: ParsedResume['personal'];
  education: ParsedEducation[];
  experience: ParsedExperience[];
  skills: ParsedSkill[];
  certifications: ParsedResume['certifications'];
  projects: ParsedResume['projects'];
  careerLevel: ScoredItem;
  jobFamilies: ScoredItem[];
  industries: ScoredItem[];
  strongestSkills: string[];
  missingSkills: ScoredItem[];
  transferableSkills: ScoredItem[];
  careerPaths: CareerPath[];
  governmentCategories: ScoredItem[];
  examCategories: ScoredItem[];
  highestDegreeLevel: DegreeLevel | '';
  fieldsOfStudy: string[];
  warnings: string[];
}

const FAMILY_SKILL_WEIGHT: Record<string, string[]> = {
  'Accounting & Finance': ['Bookkeeping', 'General Ledger', 'Accounts Payable', 'Accounts Receivable', 'Bank Reconciliation', 'GST Filing', 'TDS', 'Financial Statements', 'Auditing', 'Cost Accounting', 'MS Excel', 'Tally ERP', 'SAP', 'Financial Analysis'],
  Taxation: ['GST Filing', 'TDS', 'Income Tax Returns', 'Auditing', 'MS Excel'],
  'Audit & Assurance': ['Auditing', 'Financial Statements', 'General Ledger', 'Bank Reconciliation', 'MS Excel'],
  Banking: ['Customer Service', 'Financial Analysis', 'Risk Management', 'Credit Appraisal', 'MS Excel', 'Communication Skills'],
  'Data & Analytics': ['Data Analysis', 'SQL', 'Python', 'Power BI', 'Tableau', 'MS Excel', 'Statistics', 'Data Visualization', 'Business Intelligence'],
  'Software Engineering': ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'SQL', 'Git', 'Docker', 'AWS'],
  'Web Development': ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'PHP', 'Git'],
  'AI/ML': ['Python', 'Machine Learning', 'Statistics', 'Data Analysis', 'SQL'],
  DevOps: ['Docker', 'AWS', 'Shell Scripting', 'Git', 'Python'],
  'Digital Marketing': ['Digital Marketing', 'SEO', 'SEM', 'Social Media Marketing', 'Content Marketing', 'Email Marketing', 'Google Analytics'],
  Marketing: ['Market Research', 'Brand Management', 'Digital Marketing', 'Sales', 'Presentation Skills'],
  Sales: ['Sales', 'Negotiation', 'Communication Skills', 'Stakeholder Management'],
  'Human Resources': ['Recruitment', 'Onboarding', 'Employee Relations', 'Performance Management', 'HR Operations', 'Payroll Processing', 'MS Excel'],
  Administration: ['MS Excel', 'MS Word', 'MS PowerPoint', 'Communication Skills', 'Customer Service', 'Business Intelligence'],
  Operations: ['Operations Management', 'Vendor Management', 'MS Excel', 'Project Management'],
  'Supply Chain': ['Inventory Accounting', 'Vendor Management', 'Operations Management', 'MS Excel'],
  'Project Management': ['Project Management', 'Stakeholder Management', 'Strategic Planning', 'Business Analysis'],
  'Business Analysis': ['Business Analysis', 'SQL', 'Data Analysis', 'MS Excel', 'Stakeholder Management'],
  Consulting: ['Business Analysis', 'Strategic Planning', 'Presentation Skills', 'Financial Analysis', 'Stakeholder Management'],
  'Customer Support': ['Customer Service', 'Communication Skills', 'English'],
  'Teaching & Academia': ['Teaching', 'Communication Skills', 'Presentation Skills', 'English'],
  'Investment Banking': ['Valuation', 'Equity Research', 'Financial Analysis', 'MS Excel', 'Investment Analysis'],
};

/** Courses/certifications that plausibly close each family's gaps (used by the roadmap). */
export const FAMILY_UPSKILL: Record<string, { skill: string; course: string; certification: string }[]> = {
  'Accounting & Finance': [
    { skill: 'Advanced MS Excel', course: 'Advanced Excel for Finance (formulae, pivots, Power Query)', certification: 'Microsoft Office Specialist: Excel' },
    { skill: 'Power BI', course: 'Power BI Data Analyst fundamentals', certification: 'Microsoft PL-300 (Power BI Data Analyst)' },
    { skill: 'SAP', course: 'SAP S/4HANA Finance basics', certification: 'SAP Certified Associate – Financial Accounting' },
    { skill: 'Financial Analysis', course: 'Financial modelling and valuation', certification: 'CFA Level I (optional)' },
  ],
  'Data & Analytics': [
    { skill: 'SQL', course: 'SQL for data analysis', certification: 'Google Data Analytics Certificate' },
    { skill: 'Power BI', course: 'Power BI dashboards end-to-end', certification: 'Microsoft PL-300' },
    { skill: 'Python', course: 'Python for data analysis (pandas)', certification: 'IBM Data Analyst Professional Certificate' },
  ],
  'Human Resources': [
    { skill: 'HR Operations', course: 'HR generalist operations', certification: 'SHRM-CP / HRCI aPHRi' },
    { skill: 'Payroll Processing', course: 'Indian payroll, PF/ESI and statutory compliance', certification: 'Payroll specialist certificate' },
  ],
  'Digital Marketing': [
    { skill: 'SEO', course: 'Search engine optimisation fundamentals', certification: 'Google Digital Garage / HubSpot SEO' },
    { skill: 'SEM', course: 'Google Ads search campaigns', certification: 'Google Ads Search Certification' },
    { skill: 'Google Analytics', course: 'GA4 measurement and reporting', certification: 'Google Analytics (GA4) Certification' },
  ],
  Banking: [
    { skill: 'Credit Appraisal', course: 'Retail and MS credit appraisal', certification: 'IIBF JAIIB / CAIIB' },
    { skill: 'Risk Management', course: 'Banking risk fundamentals', certification: 'IIBF JAIIB' },
  ],
};

export function profileCandidate(parsed: ParsedResume): CandidateProfileData {
  const warnings = [...parsed.warnings];

  const highest = parsed.education.reduce<DegreeLevel | ''>((best, edu) => {
    if (!edu.degreeLevel) return best;
    if (!best) return edu.degreeLevel;
    return DEGREE_LEVEL_RANK[edu.degreeLevel] > DEGREE_LEVEL_RANK[best] ? edu.degreeLevel : best;
  }, '');

  const fieldsOfStudy = [
    ...new Set(
      parsed.education
        .flatMap((edu) => {
          const fromRule = degreeFieldsFor(edu.degree);
          const fromSpec = edu.specialization ? [edu.specialization.toLowerCase()] : [];
          return [...fromRule, ...fromSpec];
        })
        .filter(Boolean),
    ),
  ];

  const months = sumExperienceMonths(parsed.experience);
  const statedYears = parsed.personal.totalExperienceYears;
  const experienceYears = statedYears ?? (months > 0 ? Math.round((months / 12) * 10) / 10 : 0);

  const careerLevel = classifyCareerLevel(experienceYears, parsed.experience.length, highest, parsed.skills);

  const skillCanonicals = parsed.skills.map((s) => s.canonical);
  const jobFamilies = scoreJobFamilies(skillCanonicals, parsed, fieldsOfStudy, highest);
  const industries = scoreIndustries(parsed, jobFamilies);

  const { strongest, missing, transferable } = analyseSkills(skillCanonicals, jobFamilies, parsed);
  const careerPaths = buildCareerPaths(jobFamilies, strongest, missing, experienceYears, highest);
  const governmentCategories = scoreGovernmentCategories(highest, fieldsOfStudy, parsed, experienceYears);
  const examCategories = scoreExamCategories(highest, fieldsOfStudy, parsed, experienceYears);

  if (parsed.experience.length === 0 && experienceYears === 0) {
    warnings.push('Profile classified as fresher (no dated work experience detected).');
  }

  return {
    personal: parsed.personal,
    education: parsed.education,
    experience: parsed.experience,
    skills: parsed.skills,
    certifications: parsed.certifications,
    projects: parsed.projects,
    careerLevel,
    jobFamilies,
    industries,
    strongestSkills: strongest.map((s) => s.name),
    missingSkills: missing,
    transferableSkills: transferable,
    careerPaths,
    governmentCategories,
    examCategories,
    highestDegreeLevel: highest,
    fieldsOfStudy,
    warnings,
  };
}

function degreeFieldsFor(degree: string): string[] {
  const lower = degree.toLowerCase();
  if (lower.includes('com')) return ['commerce', 'accounting', 'finance'];
  if (lower.includes('chartered')) return ['accounting', 'audit', 'taxation', 'finance'];
  if (lower.includes('tech') || lower.includes('engineering')) return ['engineering'];
  if (lower.includes('mca') || lower.includes('bca') || lower.includes('computer')) return ['computer science'];
  if (lower.includes('sc')) return ['science'];
  if (lower.includes('ba')) return ['arts'];
  if (lower.includes('ed')) return ['education'];
  if (lower.includes('nursing')) return ['nursing'];
  if (lower.includes('mbbs')) return ['medicine'];
  if (lower.includes('law') || lower.startsWith('ll')) return ['law'];
  if (lower.includes('business') || lower.includes('mba') || lower.includes('bba')) return ['management', 'business'];
  return [];
}

export function classifyCareerLevel(
  experienceYears: number,
  roleCount: number,
  highestDegree: DegreeLevel | '',
  skills: ParsedSkill[],
): ScoredItem {
  const seniorityWords = skills.filter((s) => /management|leadership|strategic/i.test(s.canonical)).length;
  let value: string;
  let confidence: number;
  let rationale: string;

  if (experienceYears <= 0.5 && roleCount <= 1) {
    value = 'fresher';
    confidence = roleCount === 0 ? 0.97 : 0.9;
    rationale = roleCount === 0 ? 'No dated work experience found in the resume.' : 'Less than 6 months of experience detected.';
  } else if (experienceYears < 2) {
    value = 'junior';
    confidence = 0.85;
    rationale = `${experienceYears} year(s) of experience detected.`;
  } else if (experienceYears < 5) {
    value = 'mid';
    confidence = 0.86;
    rationale = `${experienceYears} years of experience detected.`;
  } else if (experienceYears < 10) {
    value = 'senior';
    confidence = seniorityWords > 0 ? 0.9 : 0.82;
    rationale = `${experienceYears} years of experience detected${seniorityWords ? ' with leadership/strategy skills' : ''}.`;
  } else {
    value = experienceYears >= 14 ? 'executive' : 'lead';
    confidence = 0.8;
    rationale = `${experienceYears} years of experience detected.`;
  }
  if (highestDegree === 'doctorate' && value === 'fresher') {
    value = 'junior';
    confidence = 0.6;
    rationale = 'Doctoral qualification with no dated industry experience — classified as entry-level professional.';
  }
  return { name: value, confidence, source: 'inferred', rationale };
}

export function scoreJobFamilies(
  skillCanonicals: string[],
  parsed: ParsedResume,
  fieldsOfStudy: string[],
  highestDegree: DegreeLevel | '',
): ScoredItem[] {
  const scores = new Map<string, number>();
  const evidence = new Map<string, string[]>();

  const add = (family: string, amount: number, why: string) => {
    scores.set(family, (scores.get(family) ?? 0) + amount);
    const list = evidence.get(family) ?? [];
    list.push(why);
    evidence.set(family, list);
  };

  for (const skill of skillCanonicals) {
    const entry = SKILL_TAXONOMY.find((s) => s.canonical === skill);
    const families = entry?.jobFamilies ?? [];
    for (const family of families) {
      if (family === '*') continue;
      add(family, 6, skill);
    }
    // Weighted bonus when a family explicitly lists this skill.
    for (const [family, list] of Object.entries(FAMILY_SKILL_WEIGHT)) {
      if (list.includes(skill)) add(family, 10, skill);
    }
  }

  // Qualification-based priors.
  const studyText = fieldsOfStudy.join(' ');
  if (/commerce|accounting|finance/.test(studyText)) {
    add('Accounting & Finance', 22, 'commerce/accounting qualification');
    add('Taxation', 10, 'commerce qualification');
    add('Audit & Assurance', 9, 'commerce qualification');
    add('Banking', 12, 'commerce qualification');
  }
  if (/computer science|engineering/.test(studyText)) {
    add('Software Engineering', 18, 'technical qualification');
    add('Web Development', 12, 'technical qualification');
    add('Data & Analytics', 10, 'technical qualification');
  }
  if (/management|business/.test(studyText)) {
    add('Marketing', 10, 'management qualification');
    add('Human Resources', 10, 'management qualification');
    add('Consulting', 8, 'management qualification');
  }
  if (/education/.test(studyText)) add('Teaching & Academia', 22, 'education qualification');
  if (/nursing|medicine/.test(studyText)) add('Healthcare', 22, 'healthcare qualification');
  if (/law/.test(studyText)) add('Legal', 20, 'law qualification');

  // Project / certification evidence.
  for (const project of parsed.projects) {
    for (const tech of project.technologies) {
      const entry = SKILL_TAXONOMY.find((s) => s.canonical === tech);
      for (const family of entry?.jobFamilies ?? []) if (family !== '*') add(family, 4, `project: ${project.title}`);
    }
  }
  for (const cert of parsed.certifications) {
    for (const skill of cert.skills) {
      const entry = SKILL_TAXONOMY.find((s) => s.canonical === skill);
      for (const family of entry?.jobFamilies ?? []) if (family !== '*') add(family, 5, `certification: ${cert.name}`);
    }
  }

  // Administration is a weak prior for anyone with *some* signal, so it can surface as a
  // fallback without ever dominating. It must not fire on an empty resume: with no evidence
  // it would be the only entry and therefore report as 100% confidence, which is exactly the
  // kind of invention this profiler is not allowed to make.
  const hasEvidence = skillCanonicals.length > 0 || fieldsOfStudy.length > 0 || parsed.experience.length > 0;
  if (hasEvidence) add('Administration', 6, 'general');

  if (scores.size === 0) return [];

  const maxScore = Math.max(1, ...scores.values());
  return [...scores.entries()]
    .map(([name, score]) => ({
      name,
      confidence: Math.min(0.99, Math.round((score / maxScore) * 100) / 100),
      source: 'inferred' as const,
      rationale: (evidence.get(name) ?? []).slice(0, 5).join(', '),
    }))
    .filter((item) => item.confidence >= 0.15)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
}

export function scoreIndustries(parsed: ParsedResume, jobFamilies: ScoredItem[]): ScoredItem[] {
  const map: Record<string, string[]> = {
    'Banking & Financial Services': ['Accounting & Finance', 'Banking', 'Taxation', 'Audit & Assurance', 'Investment Banking'],
    'Information Technology': ['Software Engineering', 'Web Development', 'Data & Analytics', 'AI/ML', 'DevOps'],
    'Retail & E-commerce': ['Digital Marketing', 'Marketing', 'Sales', 'Supply Chain'],
    Manufacturing: ['Operations', 'Supply Chain'],
    Healthcare: ['Healthcare'],
    Education: ['Teaching & Academia'],
    'Marketing & Advertising': ['Digital Marketing', 'Marketing'],
    Logistics: ['Supply Chain', 'Operations'],
    'Government / Public Sector': ['Administration', 'Accounting & Finance'],
    Consulting: ['Consulting', 'Business Analysis', 'Project Management'],
  };
  const out: ScoredItem[] = [];
  const families = jobFamilies.map((f) => f.name);
  for (const [industry, list] of Object.entries(map)) {
    const hits = list.filter((f) => families.includes(f));
    if (!hits.length) continue;
    const best = Math.max(...hits.map((h) => jobFamilies.find((f) => f.name === h)?.confidence ?? 0));
    out.push({
      name: industry,
      confidence: Math.min(0.97, Math.round(best * (0.7 + 0.1 * hits.length) * 100) / 100),
      source: 'inferred',
      rationale: `aligned with ${hits.join(', ')}`,
    });
  }
  if (parsed.personal.industry) {
    out.unshift({ name: parsed.personal.industry, confidence: 0.92, source: 'resume', rationale: 'industry stated in resume' });
  }
  return dedupeByName(out).slice(0, 8);
}

function analyseSkills(skillCanonicals: string[], jobFamilies: ScoredItem[], parsed: ParsedResume) {
  const targetFamilies = jobFamilies.slice(0, 3).map((f) => f.name);
  const strongest = [...parsed.skills]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 12)
    .map((s) => ({ name: s.canonical, confidence: s.confidence, source: 'resume' as const }));

  const missing: ScoredItem[] = [];
  const seen = new Set(skillCanonicals.map((s) => s.toLowerCase()));
  for (const family of targetFamilies) {
    const required = FAMILY_SKILL_WEIGHT[family] ?? [];
    for (const skill of required) {
      if (seen.has(skill.toLowerCase())) continue;
      if (missing.some((m) => m.name === skill)) {
        const existing = missing.find((m) => m.name === skill)!;
        existing.confidence = Math.min(0.95, existing.confidence + 0.08);
        existing.rationale = `${existing.rationale}; requested in ${family}`;
        continue;
      }
      const familyConfidence = jobFamilies.find((f) => f.name === family)?.confidence ?? 0.5;
      missing.push({
        name: skill,
        confidence: Math.min(0.95, Math.round(familyConfidence * 0.9 * 100) / 100),
        source: 'inferred',
        rationale: `frequently requested in ${family}`,
      });
    }
  }
  missing.sort((a, b) => b.confidence - a.confidence);

  // Transferable = skills the candidate has that are valuable outside their top family.
  const topFamilySkills = new Set(FAMILY_SKILL_WEIGHT[targetFamilies[0]] ?? []);
  const transferable = parsed.skills
    .filter((s) => !topFamilySkills.has(s.canonical))
    .map((s) => {
      const entry = SKILL_TAXONOMY.find((x) => x.canonical === s.canonical);
      const otherFamilies = (entry?.jobFamilies ?? []).filter((f) => f !== '*' && !targetFamilies.includes(f));
      return {
        name: s.canonical,
        confidence: Math.min(0.9, Math.round((0.55 + 0.05 * otherFamilies.length) * 100) / 100),
        source: 'resume' as const,
        rationale: otherFamilies.length ? `also valued in ${otherFamilies.slice(0, 3).join(', ')}` : 'broadly applicable',
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);

  return { strongest, missing: missing.slice(0, 12), transferable };
}

function buildCareerPaths(
  jobFamilies: ScoredItem[],
  strongest: { name: string }[],
  missing: ScoredItem[],
  experienceYears: number,
  highestDegree: DegreeLevel | '',
): CareerPath[] {
  const seniorityPrefix = experienceYears >= 5 ? 'Senior ' : experienceYears >= 2 ? '' : 'Junior ';
  const paths: CareerPath[] = [];
  for (const family of jobFamilies.slice(0, 5)) {
    const target = ROLE_BY_FAMILY[family.name];
    if (!target) continue;
    const required = FAMILY_SKILL_WEIGHT[family.name] ?? [];
    const have = new Set(strongest.map((s) => s.name));
    const gap = required.filter((r) => !have.has(r)).slice(0, 4);
    const missingConfidence = gap.reduce((sum, g) => sum + (missing.find((m) => m.name === g)?.confidence ?? 0.5), 0);
    const gapPenalty = gap.length ? Math.min(0.25, (missingConfidence / Math.max(1, gap.length)) * 0.2) : 0;
    paths.push({
      target: `${seniorityPrefix}${target}`,
      confidence: Math.max(0.2, Math.round((family.confidence - gapPenalty) * 100) / 100),
      rationale: `${family.rationale ?? family.name}${experienceYears > 0 ? ` · ${experienceYears} yr experience` : ' · entry level'}`,
      requiredSkills: required.slice(0, 8),
      gapSkills: gap,
    });
  }
  if (highestDegree === 'master' || highestDegree === 'doctorate') {
    paths.push({
      target: 'Research / University position',
      confidence: 0.45,
      rationale: 'Postgraduate qualification opens research and academic recruitment.',
      requiredSkills: ['Research Methodology', 'Data Analysis', 'Publication Writing'],
      gapSkills: [],
    });
  }
  return paths.sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

const ROLE_BY_FAMILY: Record<string, string> = {
  'Accounting & Finance': 'Accountant / Financial Analyst',
  Taxation: 'Tax Associate',
  'Audit & Assurance': 'Audit Associate',
  Banking: 'Banking Officer / Customer Service Associate',
  'Investment Banking': 'Investment Banking Analyst',
  'Data & Analytics': 'Data Analyst',
  'Software Engineering': 'Software Engineer',
  'Web Development': 'Web Developer',
  'AI/ML': 'Machine Learning Engineer',
  DevOps: 'DevOps Engineer',
  'Digital Marketing': 'Digital Marketing Executive',
  Marketing: 'Marketing Executive',
  Sales: 'Business Development Executive',
  'Human Resources': 'HR Executive',
  Administration: 'Office / Administrative Executive',
  Operations: 'Operations Executive',
  'Supply Chain': 'Supply Chain Executive',
  'Project Management': 'Project Coordinator',
  'Business Analysis': 'Business Analyst',
  Consulting: 'Consultant',
  'Customer Support': 'Customer Support Executive',
  'Teaching & Academia': 'Teacher / Lecturer',
  Healthcare: 'Healthcare Professional',
  Legal: 'Legal Associate',
  Management: 'Team Lead',
};

export function scoreGovernmentCategories(
  highestDegree: DegreeLevel | '',
  fieldsOfStudy: string[],
  parsed: ParsedResume,
  experienceYears: number,
): ScoredItem[] {
  const out: ScoredItem[] = [];
  const degreeRank = highestDegree ? DEGREE_LEVEL_RANK[highestDegree] : 0;
  const studyText = fieldsOfStudy.join(' ');
  const text = parsed.rawText.toLowerCase();

  for (const category of GOVERNMENT_CATEGORIES) {
    let confidence = 0.1;
    const reasons: string[] = [];

    const mentionsCategory = category.orgs.some((org) => text.includes(org.toLowerCase()));
    if (mentionsCategory) {
      confidence += 0.25;
      reasons.push(`${category.label} referenced in the resume`);
    }

    switch (category.key) {
      case 'banking':
        if (/commerce|accounting|finance/.test(studyText)) { confidence += 0.4; reasons.push('commerce qualification is the standard banking-recruitment requirement'); }
        if (degreeRank >= 3) { confidence += 0.2; reasons.push('graduation meets the minimum banking requirement'); }
        break;
      case 'ssc':
        if (degreeRank >= 3) { confidence += 0.45; reasons.push('graduation meets SSC CGL/CHSL eligibility'); }
        break;
      case 'upsc':
        if (degreeRank >= 3) { confidence += 0.35; reasons.push('graduation meets UPSC CSE eligibility'); }
        break;
      case 'state':
        if (degreeRank >= 1) { confidence += 0.35; reasons.push('state Group IV posts accept school-level qualification and above'); }
        if (/tamil nadu|chennai|coimbatore|thanjavur|salem|madurai|trichy/.test(text)) { confidence += 0.2; reasons.push('Tamil Nadu connection detected'); }
        break;
      case 'railway':
        if (degreeRank >= 1) { confidence += 0.35; reasons.push('railway NTPC accepts school qualification and above'); }
        if (/commerce|accounting/.test(studyText)) { confidence += 0.15; reasons.push('Junior Accounts Assistant posts suit commerce graduates'); }
        break;
      case 'regulatory':
        if (degreeRank >= 3) { confidence += 0.2; reasons.push('graduation meets the minimum'); }
        if (/commerce|finance|economics|law|management/.test(studyText)) { confidence += 0.25; reasons.push('SEBI/NABARD streams accept commerce, finance, economics and management'); }
        break;
      case 'teaching':
        if (/education/.test(studyText) || /\bteaching|tutor|b\.?ed\b/i.test(text)) { confidence += 0.45; reasons.push('teaching background detected'); }
        else if (degreeRank >= 3) { confidence += 0.15; reasons.push('graduation required; B.Ed/CTET additionally needed'); }
        break;
      case 'research':
      case 'university':
        if (degreeRank >= 5) { confidence += 0.4; reasons.push('postgraduate qualification is typically required'); }
        break;
      case 'apprenticeship':
        if (experienceYears <= 1 && degreeRank >= 2) { confidence += 0.3; reasons.push('limited experience — apprenticeships are a strong entry route'); }
        break;
      case 'insurance':
        if (/commerce|accounting|finance|management/.test(studyText) && degreeRank >= 3) { confidence += 0.3; reasons.push('commerce/management graduates are eligible for LIC/GIC roles'); }
        break;
      case 'court':
        if (/commerce|accounting|law|arts/.test(studyText) && degreeRank >= 2) { confidence += 0.2; reasons.push('court clerical recruitment accepts these streams'); }
        break;
      case 'psu':
        if (degreeRank >= 3) { confidence += 0.2; reasons.push('PSU non-technical posts accept graduates'); }
        if (/commerce|accounting|finance/.test(studyText)) { confidence += 0.15; reasons.push('finance/accounts PSU posts suit this qualification'); }
        break;
      default:
        if (degreeRank >= 3) confidence += 0.12;
    }
    confidence = Math.min(0.96, Math.round(confidence * 100) / 100);
    if (confidence >= 0.3) {
      out.push({ name: category.label, confidence, source: 'inferred', rationale: reasons.join('; ') });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
}

export function scoreExamCategories(
  highestDegree: DegreeLevel | '',
  fieldsOfStudy: string[],
  parsed: ParsedResume,
  experienceYears: number,
): ScoredItem[] {
  const out: ScoredItem[] = [];
  const degreeRank = highestDegree ? DEGREE_LEVEL_RANK[highestDegree] : 0;
  const studyText = fieldsOfStudy.join(' ');
  const text = parsed.rawText.toLowerCase();

  for (const category of EXAM_CATEGORIES) {
    const requiredRank = DEGREE_LEVEL_RANK[category.minDegree as DegreeLevel] ?? 1;
    let confidence = 0.05;
    const reasons: string[] = [];

    if (degreeRank >= requiredRank) {
      confidence += 0.45;
      reasons.push(`qualification meets the ${category.minDegree}-level minimum`);
    } else {
      confidence -= 0.2;
      reasons.push(`qualification is below the ${category.minDegree}-level minimum stated in past notifications`);
    }

    if (category.key === 'banking' && /commerce|accounting|finance/.test(studyText)) { confidence += 0.3; reasons.push('commerce graduates are the core banking-exam cohort'); }
    if (category.key === 'ssc' && degreeRank >= 3) confidence += 0.15;
    if (category.key === 'railway' && /commerce|accounting/.test(studyText)) { confidence += 0.2; reasons.push('Junior Accounts Assistant / Senior Clerk posts suit commerce graduates'); }
    if (category.key === 'regulatory' && /commerce|finance|economics|management/.test(studyText)) { confidence += 0.3; reasons.push('stream matches SEBI/NABARD general & research streams'); }
    if (category.key === 'state_psc' && /tamil nadu|chennai|coimbatore|thanjavur|salem|madurai/.test(text)) { confidence += 0.25; reasons.push('Tamil Nadu connection detected'); }
    if (category.key === 'teaching' && /education|teaching|tutor|b\.?ed\b/i.test(text)) { confidence += 0.3; reasons.push('teaching background detected'); }
    if (category.key === 'research' && degreeRank >= 5) { confidence += 0.3; reasons.push('postgraduate qualification meets NET/CSIR eligibility'); }
    if (category.key === 'university' && degreeRank >= 5) { confidence += 0.25; reasons.push('UGC NET requires a master’s degree'); }
    if (experienceYears > 8 && ['upsc', 'ssc'].includes(category.key)) { confidence -= 0.15; reasons.push('age limit may apply — verify the notification'); }

    confidence = Math.max(0.05, Math.min(0.95, Math.round(confidence * 100) / 100));
    out.push({ name: category.label, confidence, source: 'inferred', rationale: reasons.join('; ') });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

/** Location preference list, combining resume-stated and profile-derived locations. */
export function resolveLocations(parsed: ParsedResume): string[] {
  const set = new Set<string>();
  for (const place of parsed.personal.preferredLocations) set.add(place);
  if (parsed.personal.location) {
    set.add(parsed.personal.location);
    const state = LOCATIONS.cityToState[parsed.personal.location];
    if (state) set.add(state);
  }
  set.add('India');
  return [...set];
}

function dedupeByName(items: ScoredItem[]): ScoredItem[] {
  const seen = new Set<string>();
  const out: ScoredItem[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

