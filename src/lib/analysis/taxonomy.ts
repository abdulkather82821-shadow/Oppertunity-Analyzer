/**
 * Skills taxonomy, job-family map and opportunity vocabularies.
 * This is the knowledge base used by the deterministic (key-less) engine and as the
 * normalisation dictionary for the LLM path, so both routes speak the same vocabulary.
 */

export type SkillCategory =
  | 'technical'
  | 'language'
  | 'tool'
  | 'accounting'
  | 'finance'
  | 'marketing'
  | 'hr'
  | 'management'
  | 'communication'
  | 'data'
  | 'industry'
  | 'other';

interface SkillEntry {
  canonical: string;
  category: SkillCategory;
  aliases: string[];
  jobFamilies: string[];
}

export const SKILL_TAXONOMY: SkillEntry[] = [
  // programming languages
  { canonical: 'Python', category: 'language', aliases: ['python3', 'py'], jobFamilies: ['Data & Analytics', 'Software Engineering', 'AI/ML'] },
  { canonical: 'JavaScript', category: 'language', aliases: ['js', 'ecmascript'], jobFamilies: ['Software Engineering', 'Web Development'] },
  { canonical: 'TypeScript', category: 'language', aliases: ['ts'], jobFamilies: ['Software Engineering', 'Web Development'] },
  { canonical: 'Java', category: 'language', aliases: ['core java', 'java8', 'java se'], jobFamilies: ['Software Engineering'] },
  { canonical: 'C++', category: 'language', aliases: ['cpp', 'c plus plus'], jobFamilies: ['Software Engineering'] },
  { canonical: 'C', category: 'language', aliases: [], jobFamilies: ['Software Engineering'] },
  { canonical: 'SQL', category: 'language', aliases: ['mysql', 'postgresql', 'sqlite', 'plsql', 'pl/sql', 't-sql'], jobFamilies: ['Data & Analytics', 'Software Engineering', 'Database Administration'] },
  { canonical: 'R', category: 'language', aliases: ['r language', 'r programming'], jobFamilies: ['Data & Analytics'] },
  { canonical: 'PHP', category: 'language', aliases: [], jobFamilies: ['Web Development'] },
  { canonical: 'Go', category: 'language', aliases: ['golang'], jobFamilies: ['Software Engineering'] },
  { canonical: 'HTML', category: 'language', aliases: ['html5'], jobFamilies: ['Web Development'] },
  { canonical: 'CSS', category: 'language', aliases: ['css3'], jobFamilies: ['Web Development'] },
  { canonical: 'Shell Scripting', category: 'language', aliases: ['bash', 'shell'], jobFamilies: ['DevOps', 'Software Engineering'] },
  { canonical: 'VBA', category: 'language', aliases: ['excel vba', 'macro'], jobFamilies: ['Accounting & Finance', 'Data & Analytics'] },

  // tools / software
  { canonical: 'MS Excel', category: 'tool', aliases: ['excel', 'microsoft excel', 'advanced excel', 'msexcel'], jobFamilies: ['Accounting & Finance', 'Data & Analytics', 'Administration', 'Human Resources'] },
  { canonical: 'MS Word', category: 'tool', aliases: ['word', 'microsoft word'], jobFamilies: ['Administration', 'Human Resources'] },
  { canonical: 'MS PowerPoint', category: 'tool', aliases: ['powerpoint', 'power point', 'ppt'], jobFamilies: ['Administration', 'Marketing', 'Consulting'] },
  { canonical: 'Tally ERP', category: 'tool', aliases: ['tally', 'tallyerp9', 'tally erp 9', 'tallyprime', 'tally prime'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'SAP', category: 'tool', aliases: ['sap fi', 'sap fico', 'sap erp', 'sap s/4hana'], jobFamilies: ['Accounting & Finance', 'Supply Chain'] },
  { canonical: 'QuickBooks', category: 'tool', aliases: ['quick books'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Zoho Books', category: 'tool', aliases: ['zoho'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Power BI', category: 'tool', aliases: ['powerbi', 'power-bi'], jobFamilies: ['Data & Analytics', 'Accounting & Finance'] },
  { canonical: 'Tableau', category: 'tool', aliases: [], jobFamilies: ['Data & Analytics'] },
  { canonical: 'Google Analytics', category: 'tool', aliases: ['ga4'], jobFamilies: ['Digital Marketing'] },
  { canonical: 'Git', category: 'tool', aliases: ['github', 'gitlab'], jobFamilies: ['Software Engineering', 'Web Development'] },
  { canonical: 'Docker', category: 'tool', aliases: ['containers'], jobFamilies: ['DevOps', 'Software Engineering'] },
  { canonical: 'AWS', category: 'tool', aliases: ['amazon web services'], jobFamilies: ['DevOps', 'Cloud Engineering'] },
  { canonical: 'React', category: 'tool', aliases: ['reactjs', 'react.js'], jobFamilies: ['Web Development', 'Software Engineering'] },
  { canonical: 'Node.js', category: 'tool', aliases: ['nodejs', 'node js'], jobFamilies: ['Web Development', 'Software Engineering'] },
  { canonical: 'AutoCAD', category: 'tool', aliases: ['autocad'], jobFamilies: ['Civil Engineering', 'Design'] },

  // accounting
  { canonical: 'Bookkeeping', category: 'accounting', aliases: ['books of accounts', 'accounting entries', 'journal entries'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'General Ledger', category: 'accounting', aliases: ['gl', 'ledger reconciliation'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Accounts Payable', category: 'accounting', aliases: ['ap', 'creditors', 'vendor reconciliation'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Accounts Receivable', category: 'accounting', aliases: ['ar', 'debtors', 'receivables'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Bank Reconciliation', category: 'accounting', aliases: ['brs', 'bank reconciliation statement'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'GST Filing', category: 'accounting', aliases: ['gst', 'gst returns', 'gstr-1', 'gstr-3b', 'gstn'], jobFamilies: ['Accounting & Finance', 'Taxation'] },
  { canonical: 'TDS', category: 'accounting', aliases: ['tax deducted at source', 'tds returns', 'form 26as'], jobFamilies: ['Accounting & Finance', 'Taxation'] },
  { canonical: 'Income Tax Returns', category: 'accounting', aliases: ['itr', 'itr filing', 'income tax'], jobFamilies: ['Taxation', 'Accounting & Finance'] },
  { canonical: 'Financial Statements', category: 'accounting', aliases: ['balance sheet', 'profit and loss', 'p&l', 'financial reporting'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Payroll Processing', category: 'accounting', aliases: ['payroll', 'salary processing', 'pf and esi'], jobFamilies: ['Human Resources', 'Accounting & Finance'] },
  { canonical: 'Auditing', category: 'accounting', aliases: ['audit', 'internal audit', 'statutory audit', 'vouching'], jobFamilies: ['Accounting & Finance', 'Audit & Assurance'] },
  { canonical: 'Cost Accounting', category: 'accounting', aliases: ['costing', 'cost analysis'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Inventory Accounting', category: 'accounting', aliases: ['stock accounting', 'inventory management'], jobFamilies: ['Accounting & Finance', 'Supply Chain'] },

  // finance
  { canonical: 'Financial Analysis', category: 'finance', aliases: ['financial modelling', 'financial modeling', 'ratio analysis'], jobFamilies: ['Accounting & Finance', 'Investment Banking'] },
  { canonical: 'Budgeting', category: 'finance', aliases: ['budget preparation', 'budgeting and forecasting'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Forecasting', category: 'finance', aliases: ['financial forecasting', 'projection'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Valuation', category: 'finance', aliases: ['dcf', 'discounted cash flow', 'company valuation'], jobFamilies: ['Investment Banking', 'Accounting & Finance'] },
  { canonical: 'Equity Research', category: 'finance', aliases: ['stock research', 'equity analysis'], jobFamilies: ['Investment Banking'] },
  { canonical: 'Risk Management', category: 'finance', aliases: ['credit risk', 'market risk'], jobFamilies: ['Banking', 'Accounting & Finance'] },
  { canonical: 'Working Capital Management', category: 'finance', aliases: ['working capital'], jobFamilies: ['Accounting & Finance'] },
  { canonical: 'Investment Analysis', category: 'finance', aliases: ['portfolio management', 'mutual funds'], jobFamilies: ['Banking', 'Investment Banking'] },
  { canonical: 'Credit Appraisal', category: 'finance', aliases: ['loan appraisal', 'credit analysis'], jobFamilies: ['Banking'] },

  // data & analytics
  { canonical: 'Data Analysis', category: 'data', aliases: ['data analytics', 'analytical skills', 'data interpretation'], jobFamilies: ['Data & Analytics'] },
  { canonical: 'Data Visualization', category: 'data', aliases: ['dashboards', 'data visualisation', 'reporting dashboards'], jobFamilies: ['Data & Analytics'] },
  { canonical: 'Statistics', category: 'data', aliases: ['statistical analysis', 'probability'], jobFamilies: ['Data & Analytics'] },
  { canonical: 'Machine Learning', category: 'data', aliases: ['ml', 'deep learning', 'neural networks'], jobFamilies: ['AI/ML', 'Data & Analytics'] },
  { canonical: 'Data Cleaning', category: 'data', aliases: ['data wrangling', 'etl'], jobFamilies: ['Data & Analytics'] },
  { canonical: 'Business Intelligence', category: 'data', aliases: ['bi reporting', 'mis reporting', 'mis reports'], jobFamilies: ['Data & Analytics', 'Administration'] },

  // marketing
  { canonical: 'Digital Marketing', category: 'marketing', aliases: ['online marketing', 'performance marketing'], jobFamilies: ['Digital Marketing'] },
  { canonical: 'SEO', category: 'marketing', aliases: ['search engine optimization', 'search engine optimisation'], jobFamilies: ['Digital Marketing'] },
  { canonical: 'SEM', category: 'marketing', aliases: ['google ads', 'paid search', 'ppc'], jobFamilies: ['Digital Marketing'] },
  { canonical: 'Social Media Marketing', category: 'marketing', aliases: ['smm', 'social media management'], jobFamilies: ['Digital Marketing', 'Marketing'] },
  { canonical: 'Content Marketing', category: 'marketing', aliases: ['content writing', 'copywriting', 'content strategy'], jobFamilies: ['Digital Marketing', 'Marketing'] },
  { canonical: 'Email Marketing', category: 'marketing', aliases: ['mailchimp', 'crm campaigns'], jobFamilies: ['Digital Marketing', 'Marketing'] },
  { canonical: 'Market Research', category: 'marketing', aliases: ['market analysis', 'consumer research'], jobFamilies: ['Marketing'] },
  { canonical: 'Brand Management', category: 'marketing', aliases: ['branding', 'brand strategy'], jobFamilies: ['Marketing'] },
  { canonical: 'Sales', category: 'marketing', aliases: ['business development', 'b2b sales', 'lead generation', 'inside sales'], jobFamilies: ['Sales', 'Marketing'] },

  // HR
  { canonical: 'Recruitment', category: 'hr', aliases: ['talent acquisition', 'hiring', 'sourcing candidates', 'screening'], jobFamilies: ['Human Resources'] },
  { canonical: 'Onboarding', category: 'hr', aliases: ['induction', 'employee onboarding'], jobFamilies: ['Human Resources'] },
  { canonical: 'Employee Relations', category: 'hr', aliases: ['grievance handling', 'employee engagement'], jobFamilies: ['Human Resources'] },
  { canonical: 'Performance Management', category: 'hr', aliases: ['appraisal', 'performance appraisal', 'kras', 'kpis'], jobFamilies: ['Human Resources'] },
  { canonical: 'HR Operations', category: 'hr', aliases: ['hr generalist', 'hr administration', 'personnel management'], jobFamilies: ['Human Resources'] },
  { canonical: 'Training and Development', category: 'hr', aliases: ['l&d', 'training needs analysis', 'learning and development'], jobFamilies: ['Human Resources'] },
  { canonical: 'Compensation and Benefits', category: 'hr', aliases: ['c&b', 'salary benchmarking'], jobFamilies: ['Human Resources'] },

  // management
  { canonical: 'Project Management', category: 'management', aliases: ['project planning', 'pmp', 'agile', 'scrum', 'kanban'], jobFamilies: ['Project Management', 'Software Engineering'] },
  { canonical: 'Team Leadership', category: 'management', aliases: ['team lead', 'people management', 'team handling'], jobFamilies: ['Management'] },
  { canonical: 'Strategic Planning', category: 'management', aliases: ['strategy', 'business strategy'], jobFamilies: ['Management', 'Consulting'] },
  { canonical: 'Operations Management', category: 'management', aliases: ['operations', 'process improvement'], jobFamilies: ['Operations', 'Supply Chain'] },
  { canonical: 'Vendor Management', category: 'management', aliases: ['supplier management', 'procurement', 'purchase'], jobFamilies: ['Supply Chain', 'Administration'] },
  { canonical: 'Stakeholder Management', category: 'management', aliases: ['client management', 'client relationship'], jobFamilies: ['Consulting', 'Sales', 'Project Management'] },
  { canonical: 'Business Analysis', category: 'management', aliases: ['brd', 'frd', 'requirement gathering', 'business analyst'], jobFamilies: ['Business Analysis', 'Consulting'] },

  // communication
  { canonical: 'Communication Skills', category: 'communication', aliases: ['verbal communication', 'written communication', 'interpersonal skills'], jobFamilies: ['*'] },
  { canonical: 'Presentation Skills', category: 'communication', aliases: ['public speaking', 'client presentation'], jobFamilies: ['*'] },
  { canonical: 'Negotiation', category: 'communication', aliases: ['negotiation skills'], jobFamilies: ['Sales', 'Supply Chain'] },
  { canonical: 'English', category: 'communication', aliases: ['english proficiency', 'fluency in english'], jobFamilies: ['*'] },
  { canonical: 'Tamil', category: 'communication', aliases: ['tamil proficiency'], jobFamilies: ['*'] },
  { canonical: 'Hindi', category: 'communication', aliases: ['hindi proficiency'], jobFamilies: ['*'] },
  { canonical: 'Customer Service', category: 'communication', aliases: ['customer support', 'client servicing', 'help desk', 'bpo'], jobFamilies: ['Customer Support', 'Administration'] },

  // industry-specific
  { canonical: 'Teaching', category: 'industry', aliases: ['lesson planning', 'curriculum design', 'classroom management', 'tutoring'], jobFamilies: ['Teaching & Academia'] },
  { canonical: 'Clinical Research', category: 'industry', aliases: ['pharmacovigilance', 'clinical trials'], jobFamilies: ['Healthcare', 'Life Sciences'] },
  { canonical: 'Nursing Care', category: 'industry', aliases: ['patient care'], jobFamilies: ['Healthcare'] },
  { canonical: 'Civil Engineering', category: 'industry', aliases: ['structural design', 'site supervision', 'construction'], jobFamilies: ['Civil Engineering'] },
  { canonical: 'Mechanical Design', category: 'industry', aliases: ['cad design', 'machine design'], jobFamilies: ['Mechanical Engineering'] },
  { canonical: 'Laboratory Techniques', category: 'industry', aliases: ['lab work', 'instrumentation'], jobFamilies: ['Life Sciences', 'Research'] },
  { canonical: 'Legal Research', category: 'industry', aliases: ['drafting', 'litigation', 'legal drafting'], jobFamilies: ['Legal'] },
];

const ALIAS_INDEX = new Map<string, SkillEntry>();
for (const entry of SKILL_TAXONOMY) {
  ALIAS_INDEX.set(entry.canonical.toLowerCase(), entry);
  for (const alias of entry.aliases) ALIAS_INDEX.set(alias.toLowerCase(), entry);
}

export function lookupSkill(raw: string): SkillEntry | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIAS_INDEX.get(key) ?? null;
}

export function canonicalSkill(raw: string): string {
  return lookupSkill(raw)?.canonical ?? raw.trim();
}

export function skillCategory(raw: string): SkillCategory {
  return lookupSkill(raw)?.category ?? 'other';
}

export function skillsForFamily(family: string): string[] {
  return SKILL_TAXONOMY.filter((s) => s.jobFamilies.includes(family)).map((s) => s.canonical);
}

export const JOB_FAMILIES = [
  'Accounting & Finance',
  'Taxation',
  'Audit & Assurance',
  'Banking',
  'Investment Banking',
  'Data & Analytics',
  'Software Engineering',
  'Web Development',
  'AI/ML',
  'DevOps',
  'Cloud Engineering',
  'Database Administration',
  'Digital Marketing',
  'Marketing',
  'Sales',
  'Human Resources',
  'Administration',
  'Operations',
  'Supply Chain',
  'Project Management',
  'Business Analysis',
  'Consulting',
  'Customer Support',
  'Teaching & Academia',
  'Healthcare',
  'Life Sciences',
  'Research',
  'Civil Engineering',
  'Mechanical Engineering',
  'Legal',
  'Design',
  'Management',
] as const;

export type JobFamily = (typeof JOB_FAMILIES)[number];

export const DEGREE_LEVELS = ['school', 'diploma', 'bachelor', 'master', 'doctorate', 'professional'] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

/** Degree recognition, ordered so more specific patterns win. */
export const DEGREE_PATTERNS: { pattern: RegExp; level: DegreeLevel; canonical: string; fields: string[] }[] = [
  { pattern: /\b(ph\.?\s?d|doctorate|d\.phil)\b/i, level: 'doctorate', canonical: 'Ph.D', fields: ['research'] },
  { pattern: /\b(m\.?phil)\b/i, level: 'master', canonical: 'M.Phil', fields: ['research'] },
  { pattern: /\b(mba|pgdm|master of business administration)\b/i, level: 'master', canonical: 'MBA', fields: ['management', 'finance', 'marketing', 'hr'] },
  { pattern: /\b(m\.?com|master of commerce)\b/i, level: 'master', canonical: 'M.Com', fields: ['commerce', 'accounting', 'finance'] },
  { pattern: /\b(chartered accountant|ca)\b/i, level: 'professional', canonical: 'Chartered Accountant', fields: ['accounting', 'audit', 'taxation'] },
  { pattern: /\b(acca|cpa|cma|cost accountant|cs\b|company secretary|cfa)\b/i, level: 'professional', canonical: 'Professional Certification', fields: ['accounting', 'finance'] },
  { pattern: /\b(m\.?sc|m\.?s\b|master of science)\b/i, level: 'master', canonical: 'M.Sc', fields: ['science'] },
  { pattern: /\b(m\.?a\b|master of arts)\b/i, level: 'master', canonical: 'M.A', fields: ['arts'] },
  { pattern: /\b(m\.?tech|m\.?e\b|master of technology|master of engineering)\b/i, level: 'master', canonical: 'M.Tech', fields: ['engineering'] },
  { pattern: /\b(mca|master of computer applications)\b/i, level: 'master', canonical: 'MCA', fields: ['computer science'] },
  { pattern: /\b(ll\.?m)\b/i, level: 'master', canonical: 'LL.M', fields: ['law'] },
  { pattern: /\b(b\.?com|bachelor of commerce)\b/i, level: 'bachelor', canonical: 'B.Com', fields: ['commerce', 'accounting', 'finance'] },
  { pattern: /\b(b\.?tech|b\.?e\b|bachelor of technology|bachelor of engineering)\b/i, level: 'bachelor', canonical: 'B.Tech', fields: ['engineering'] },
  { pattern: /\b(bca|bachelor of computer applications)\b/i, level: 'bachelor', canonical: 'BCA', fields: ['computer science'] },
  { pattern: /\b(b\.?sc|bachelor of science)\b/i, level: 'bachelor', canonical: 'B.Sc', fields: ['science'] },
  { pattern: /\b(b\.?a\b|bachelor of arts)\b/i, level: 'bachelor', canonical: 'B.A', fields: ['arts'] },
  { pattern: /\b(bba|bachelor of business administration)\b/i, level: 'bachelor', canonical: 'BBA', fields: ['management', 'business'] },
  { pattern: /\b(b\.?ed|bachelor of education)\b/i, level: 'bachelor', canonical: 'B.Ed', fields: ['education'] },
  { pattern: /\b(ll\.?b)\b/i, level: 'bachelor', canonical: 'LL.B', fields: ['law'] },
  { pattern: /\b(mbbs|md\b|bds|bams)\b/i, level: 'bachelor', canonical: 'MBBS', fields: ['medicine'] },
  { pattern: /\b(b\.?nursing|bsc nursing|gnm)\b/i, level: 'bachelor', canonical: 'B.Sc Nursing', fields: ['nursing'] },
  { pattern: /\bdiploma\b/i, level: 'diploma', canonical: 'Diploma', fields: [] },
  { pattern: /\b(12th|higher secondary|hsc|intermediate|\+2)\b/i, level: 'school', canonical: 'Higher Secondary (12th)', fields: [] },
  { pattern: /\b(10th|sslc|ssc\b|matriculation|secondary school)\b/i, level: 'school', canonical: 'SSLC (10th)', fields: [] },
  { pattern: /\b(bachelor'?s? degree|undergraduate degree|graduate degree|ug degree)\b/i, level: 'bachelor', canonical: "Bachelor's Degree", fields: [] },
  { pattern: /\b(master'?s? degree|postgraduate degree|pg degree)\b/i, level: 'master', canonical: "Master's Degree", fields: [] },
];

export const DEGREE_LEVEL_RANK: Record<DegreeLevel, number> = {
  school: 1,
  diploma: 2,
  bachelor: 3,
  professional: 4,
  master: 5,
  doctorate: 6,
};

export const GOVERNMENT_CATEGORIES = [
  { key: 'central', label: 'Central Government', orgs: ['UPSC', 'SSC', 'Ministry', 'Department'] },
  { key: 'state', label: 'State Government', orgs: ['TNPSC', 'KPSC', 'UPPSC', 'MPSC', 'RPSC', 'State Government'] },
  { key: 'psu', label: 'Public Sector Undertakings', orgs: ['BHEL', 'ONGC', 'NTPC', 'IOCL', 'GAIL', 'SAIL', 'WAPCOS', 'IFCI'] },
  { key: 'banking', label: 'Banking Recruitment', orgs: ['IBPS', 'SBI', 'RBI', 'NABARD', 'NHB', 'Exim Bank'] },
  { key: 'railway', label: 'Railway Recruitment', orgs: ['RRB', 'RRC', 'Indian Railways'] },
  { key: 'ssc', label: 'SSC Examinations', orgs: ['SSC', 'Staff Selection Commission'] },
  { key: 'upsc', label: 'UPSC Examinations', orgs: ['UPSC', 'Union Public Service Commission'] },
  { key: 'teaching', label: 'Teaching Recruitment', orgs: ['CTET', 'TET', 'KVS', 'NVS', 'DSSSB', 'School Education Department'] },
  { key: 'police', label: 'Police Recruitment', orgs: ['Police', 'CAPF', 'CRPF', 'CISF', 'BSF'] },
  { key: 'defence', label: 'Defence Recruitment', orgs: ['NDA', 'CDS', 'Army', 'Navy', 'Air Force', 'Coast Guard'] },
  { key: 'insurance', label: 'Insurance Recruitment', orgs: ['LIC', 'GIC', 'NIACL', 'UIIC', 'ESIC'] },
  { key: 'court', label: 'Court / Administrative', orgs: ['High Court', 'District Court', 'Supreme Court', 'Tribunal'] },
  { key: 'university', label: 'University Recruitment', orgs: ['University', 'IIT', 'IIM', 'NIT', 'College', 'Institute'] },
  { key: 'research', label: 'Research Recruitment', orgs: ['CSIR', 'ICMR', 'ISRO', 'DRDO', 'ICAR', 'THSTI'] },
  { key: 'regulatory', label: 'Regulatory Bodies', orgs: ['SEBI', 'NABARD', 'IRDAI', 'PFRDA', 'TRAI'] },
  { key: 'apprenticeship', label: 'Apprenticeships', orgs: ['Apprentice', 'NAPS', 'OPTCL'] },
] as const;

export const EXAM_CATEGORIES = [
  { key: 'ssc', label: 'SSC (CGL, CHSL, MTS, GD, Stenographer)', minDegree: 'bachelor' },
  { key: 'upsc', label: 'UPSC (CSE, IFoS, CDS, NDA, CAPF, CMS)', minDegree: 'bachelor' },
  { key: 'state_psc', label: 'State PSC (TNPSC, KPSC, UPPSC, MPSC)', minDegree: 'school' },
  { key: 'banking', label: 'Banking (IBPS PO/Clerk, SBI PO/Clerk, RRB)', minDegree: 'bachelor' },
  { key: 'railway', label: 'Railway (RRB NTPC, Group D, ALP, JE)', minDegree: 'school' },
  { key: 'regulatory', label: 'Regulatory (SEBI Grade A, NABARD Grade A, RBI Grade B)', minDegree: 'bachelor' },
  { key: 'teaching', label: 'Teaching (CTET, State TET, KVS, NVS)', minDegree: 'bachelor' },
  { key: 'insurance', label: 'Insurance (LIC AAO, ADO, GIC, NIACL)', minDegree: 'bachelor' },
  { key: 'defence', label: 'Defence (CDS, NDA, AFCAT, CAPF)', minDegree: 'bachelor' },
  { key: 'research', label: 'Research (CSIR NET, GATE, ICMR, DBT)', minDegree: 'master' },
  { key: 'university', label: 'University / UGC NET & Fellowships', minDegree: 'master' },
] as const;

export const LOCATIONS = {
  states: ['Tamil Nadu', 'Karnataka', 'Kerala', 'Telangana', 'Andhra Pradesh', 'Maharashtra', 'Delhi', 'Uttar Pradesh', 'West Bengal', 'Rajasthan', 'Gujarat'],
  cities: ['Chennai', 'Coimbatore', 'Thanjavur', 'Salem', 'Madurai', 'Trichy', 'Bengaluru', 'Hyderabad', 'Mumbai', 'Pune', 'Delhi', 'Noida', 'Gurugram', 'Kolkata', 'Ahmedabad'],
  cityToState: {
    Chennai: 'Tamil Nadu', Coimbatore: 'Tamil Nadu', Thanjavur: 'Tamil Nadu', Salem: 'Tamil Nadu',
    Madurai: 'Tamil Nadu', Trichy: 'Tamil Nadu', Bengaluru: 'Karnataka', Bangalore: 'Karnataka',
    Hyderabad: 'Telangana', Mumbai: 'Maharashtra', Pune: 'Maharashtra', Delhi: 'Delhi',
    Noida: 'Uttar Pradesh', Gurugram: 'Haryana', Gurgaon: 'Haryana', Kolkata: 'West Bengal',
    Ahmedabad: 'Gujarat',
  } as Record<string, string>,
};

export const WORK_MODES = ['onsite', 'remote', 'hybrid', 'unknown'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'apprenticeship', 'temporary', 'fellowship'] as const;
export const OPPORTUNITY_TYPES = ['job', 'government_job', 'exam', 'internship', 'apprenticeship', 'fellowship', 'graduate_job', 'contract'] as const;

/** Well-known official recruitment domains — used for source tiering and trust scoring. */
export const OFFICIAL_DOMAINS: Record<string, { name: string; tier: 1 | 2; government: boolean }> = {
  'upsc.gov.in': { name: 'Union Public Service Commission', tier: 1, government: true },
  'upsconline.nic.in': { name: 'UPSC Online Application Portal', tier: 1, government: true },
  'ssc.gov.in': { name: 'Staff Selection Commission', tier: 1, government: true },
  'ssc.nic.in': { name: 'Staff Selection Commission (legacy)', tier: 1, government: true },
  'ibps.in': { name: 'Institute of Banking Personnel Selection', tier: 1, government: true },
  'sbi.co.in': { name: 'State Bank of India Careers', tier: 1, government: true },
  'rrbapply.gov.in': { name: 'Railway Recruitment Board Apply Portal', tier: 1, government: true },
  'indianrailways.gov.in': { name: 'Indian Railways', tier: 1, government: true },
  'tnpsc.gov.in': { name: 'Tamil Nadu Public Service Commission', tier: 1, government: true },
  'tnpscexams.in': { name: 'TNPSC Online Application Portal', tier: 1, government: true },
  'employmentnews.gov.in': { name: 'Employment News (Govt of India)', tier: 1, government: true },
  'pib.gov.in': { name: 'Press Information Bureau', tier: 1, government: true },
  'sebi.gov.in': { name: 'Securities and Exchange Board of India', tier: 1, government: true },
  'nabard.org': { name: 'NABARD', tier: 1, government: true },
  'rbi.org.in': { name: 'Reserve Bank of India', tier: 1, government: true },
  'apprenticeindia.gov.in': { name: 'Apprenticeship India (NAPS)', tier: 1, government: true },
  'india.gov.in': { name: 'National Portal of India', tier: 1, government: true },
  'kpsc.kar.nic.in': { name: 'Karnataka Public Service Commission', tier: 1, government: true },
  'uppsc.up.nic.in': { name: 'Uttar Pradesh Public Service Commission', tier: 1, government: true },
  'mpsc.gov.in': { name: 'Maharashtra Public Service Commission', tier: 1, government: true },
};

/** Reputable secondary aggregators — discovery only, never authoritative. */
export const KNOWN_AGGREGATORS = [
  'freejobalert.com', 'sarkariresult.com', 'testbook.com', 'adda247.com', 'careerpower.in',
  'shiksha.com', 'jagranjosh.com', 'rojgarlive.com', 'examcart.in', 'practicemock.com',
  'naukri.com', 'indeed.com', 'linkedin.com', 'internshala.com', 'timesjobs.com',
  'glassdoor.co.in', 'monsterindia.com', 'unstop.com', 'freshersworld.com',
];

/** Signals that strongly suggest a fraudulent or low-quality listing. */
export const SCAM_SIGNALS: { pattern: RegExp; impact: number; detail: string }[] = [
  { pattern: /\b(pay|paying|payment|deposit|registration fee)\b.{0,40}\b(to get|for the job|to secure|for interview|for offer letter)\b/i, impact: -45, detail: 'Asks the candidate to pay money to obtain the job or interview.' },
  { pattern: /\b(registration fee|processing fee|security deposit)\b/i, impact: -35, detail: 'Charges a registration/processing/security fee.' },
  { pattern: /\b(whatsapp|telegram)\b.{0,30}\b(only|apply|send (your )?(cv|resume))\b/i, impact: -25, detail: 'Applications accepted only via WhatsApp/Telegram — not a verifiable recruitment channel.' },
  { pattern: /\b(guaranteed (job|placement|selection)|100% (job|selection) guarantee)\b/i, impact: -30, detail: 'Guarantees a job or selection — no legitimate recruiter can promise this.' },
  { pattern: /\b(earn\s?₹?\s?[1-9]\d{2,3}(?:,?\d{3})*\s?(?:per|a|\/)\s?(day|week))\b/i, impact: -25, detail: 'Implausibly high earnings claim.' },
  { pattern: /\b(bit\.ly|tinyurl|t\.co|tiny\.cc)\b/i, impact: -20, detail: 'Application link uses a URL shortener, hiding the real destination.' },
  { pattern: /\b(govt\.jobs?-[a-z0-9-]+\.(com|net|in)|sarkari-[a-z0-9-]+\.(com|net))\b/i, impact: -30, detail: 'Domain mimics official government branding but is not a .gov.in site.' },
  { pattern: /\b(no experience needed|no interview|instant offer|same day offer)\b/i, impact: -12, detail: 'Instant-offer language typical of fraudulent listings.' },
];
