import { CONFIG_SPECS, FLAG_SPECS } from '../config';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Seed dataset.
 *
 * Government records below were collected from public sources on 2026-09-29 and each one
 * carries its source URLs and a `last_verified` timestamp. Where sources disagreed (SSC CGL
 * closing date, SEBI notification month) the disagreement is stored explicitly as a
 * conflict rather than silently resolved — that is the behaviour the verification engine is
 * supposed to demonstrate.
 *
 * Private-sector listings cannot be verified from a static seed without inventing them, so
 * the handful included here are flagged `is_demo: true`, have generic employer names, and
 * are badged as demonstration data in the UI. Delete them with `npm run db:seed -- --no-demo`
 * or from the admin panel.
 */

export const SEED_VERIFIED_AT = '2026-09-29T09:00:00.000Z';

export interface SeedExam {
  key: string;
  examName: string;
  organization: string;
  organizationType: string;
  category: string;
  post: string;
  qualification: string[];
  degreeLevels: string[];
  fieldsOfStudy: string[];
  ageMin: number | null;
  ageMax: number | null;
  ageRelaxation: string;
  experienceRequired: string;
  experienceMinYears: number | null;
  vacancies: number | null;
  applicationFee: string;
  notificationNumber: string;
  notificationDate: string | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  feeDeadline: string | null;
  correctionStart: string | null;
  correctionEnd: string | null;
  admitCardDate: string | null;
  examDate: string | null;
  examEndDate: string | null;
  answerKeyStatus: string;
  resultStatus: string;
  eligibility: string;
  officialNotification: string;
  officialApplication: string;
  officialWebsite: string;
  sourceUrls: string[];
  conflictFlags: { field: string; values: { value: string; url: string; isOfficial: boolean }[]; resolution: string }[];
  verificationStatus: string;
  notes: string;
}

export const SEED_EXAMS: SeedExam[] = [
  {
    key: 'upsc-advt-12-2026',
    examName: 'UPSC Direct Recruitment — Advertisement No. 12/2026',
    organization: 'Union Public Service Commission',
    organizationType: 'central',
    category: 'upsc',
    post: '212 posts across various Government of India departments',
    qualification: ["Bachelor's degree in a relevant discipline"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: [],
    ageMin: null,
    ageMax: null,
    ageRelaxation: 'As per the post-specific rules in Advertisement No. 12/2026',
    experienceRequired: 'Varies by post',
    experienceMinYears: null,
    vacancies: 212,
    applicationFee: 'As prescribed in the advertisement',
    notificationNumber: 'Advertisement No. 12/2026',
    notificationDate: '2026-09-26T00:00:00.000Z',
    applicationStart: '2026-09-26T00:00:00.000Z',
    applicationDeadline: '2026-10-16T17:29:59.000Z',
    feeDeadline: '2026-10-16T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: null,
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: 'Eligibility differs per post; read the post-specific module in the advertisement.',
    officialNotification: 'https://upsc.gov.in/',
    officialApplication: 'https://upsconline.nic.in/',
    officialWebsite: 'https://upsc.gov.in',
    sourceUrls: [
      'https://upsc.gov.in/',
      'https://upsconline.nic.in/',
      'https://english.dainikjagranmpcg.com/education/upsc-recruitment-2026-apply-for-government-jobs/article-33543',
      'https://bestcolleges.indiatoday.in/latest-news/upsc-recruitment-2026-applications-open-for-212-posts-in-government-departments-11506',
    ],
    conflictFlags: [],
    verificationStatus: 'needs_verification',
    notes:
      'Applications open 26 September – 16 October 2026 per the PIB release of 26 September 2026. A secondary outlet reported a 12 September – 2 October window for a different UPSC advertisement; confirm which advertisement you are applying to on upsconline.nic.in.',
  },
  {
    key: 'rrb-ntpc-graduate-2026',
    examName: 'RRB NTPC Graduate Level Recruitment 2026 (CEN 06/2026)',
    organization: 'Railway Recruitment Boards, Ministry of Railways',
    organizationType: 'railway',
    category: 'railway',
    post: 'Goods Train Manager · Chief Commercial-cum-Ticket Supervisor · Junior Accounts Assistant cum Typist · Senior Clerk cum Typist',
    qualification: ["Bachelor's degree (Level 5 and Level 6 posts)"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: ['commerce', 'accounting'],
    ageMin: 18,
    ageMax: 36,
    ageRelaxation: 'Category-based relaxation as per the CEN; verify the notification',
    experienceRequired: 'Not specified for these posts',
    experienceMinYears: 0,
    vacancies: 3477,
    applicationFee: 'To be notified',
    notificationNumber: 'CEN 06/2026',
    notificationDate: '2026-09-26T00:00:00.000Z',
    applicationStart: '2026-10-08T00:00:00.000Z',
    applicationDeadline: '2026-11-06T18:29:59.000Z',
    feeDeadline: '2026-11-08T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: null,
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility:
      "Bachelor's degree for Level 5/6 posts. Junior Accounts Assistant cum Typist and Senior Clerk cum Typist suit commerce and accounting graduates.",
    officialNotification: 'https://www.rrbapply.gov.in/',
    officialApplication: 'https://www.rrbapply.gov.in/',
    officialWebsite: 'https://www.rrbapply.gov.in',
    sourceUrls: [
      'https://www.rrbapply.gov.in/',
      'https://www.rojgarlive.com/articles/rrb-ntpc-graduate-recruitment-2026-apply-online-for-3477-posts-3357',
      'https://www.governmentdailyjobs.com/2026/09/rrb-ntpc-graduate-recruitment-2026.html',
    ],
    conflictFlags: [
      {
        field: 'notification date',
        values: [
          { value: '2026-09-21', url: 'https://www.governmentdailyjobs.com/2026/09/rrb-ntpc-graduate-recruitment-2026.html', isOfficial: false },
          { value: '2026-09-26', url: 'https://www.rojgarlive.com/articles/rrb-ntpc-graduate-recruitment-2026-apply-online-for-3477-posts-3357', isOfficial: false },
        ],
        resolution: 'Sources disagree on the indicative notice date. Dates after the application window are tentative — confirm on rrbapply.gov.in.',
      },
    ],
    verificationStatus: 'conflicting',
    notes:
      'Dates come from the indicative notice and are marked tentative by the RRBs. The detailed notification was expected around 7 October 2026.',
  },
  {
    key: 'tnpsc-group-4-2026',
    examName: 'TNPSC Combined Civil Services Examination IV (Group 4) 2026',
    organization: 'Tamil Nadu Public Service Commission',
    organizationType: 'state',
    category: 'state_psc',
    post: 'Village Administrative Officer · Junior Assistant · Typist / Steno-Typist (Grade III) · Junior Revenue Inspector · Forest Guard',
    qualification: ['SSLC (10th standard) pass as the minimum, varying by post'],
    degreeLevels: ['school'],
    fieldsOfStudy: [],
    ageMin: 21,
    ageMax: 30,
    ageRelaxation: 'Relaxations for reserved categories as per the notification',
    experienceRequired: 'Not required',
    experienceMinYears: 0,
    vacancies: null,
    applicationFee: 'As notified',
    notificationNumber: 'Annual Planner 2026',
    notificationDate: '2026-10-06T00:00:00.000Z',
    applicationStart: '2026-10-06T00:00:00.000Z',
    applicationDeadline: '2026-11-05T17:29:59.000Z',
    feeDeadline: null,
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: '2026-12-10T00:00:00.000Z',
    examDate: '2026-12-20T04:00:00.000Z',
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: 'SSLC pass minimum; a TNPSC One Time Registration (OTR) is required before applying.',
    officialNotification: 'https://www.tnpsc.gov.in/',
    officialApplication: 'https://www.tnpscexams.in/',
    officialWebsite: 'https://www.tnpsc.gov.in',
    sourceUrls: [
      'https://www.tnpsc.gov.in/',
      'https://www.shiksha.com/exams/tnpsc-group-4-exam-dates',
      'https://arivark.com/tnpsc-faq/tnpsc-group-4-notification-2026',
    ],
    conflictFlags: [],
    verificationStatus: 'needs_verification',
    notes:
      'Dates are taken from the TNPSC annual planner; the vacancy count is not published until the notification is released on 6 October 2026.',
  },
  {
    key: 'ssc-cgl-2026',
    examName: 'SSC Combined Graduate Level Examination 2026',
    organization: 'Staff Selection Commission',
    organizationType: 'central',
    category: 'ssc',
    post: 'Group B and Group C posts across Central Government ministries and departments',
    qualification: ["Bachelor's degree from a recognised university"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: [],
    ageMin: 18,
    ageMax: 32,
    ageRelaxation: 'Varies by post; age calculated as on 01-08-2026',
    experienceRequired: 'Not required',
    experienceMinYears: 0,
    vacancies: 12256,
    applicationFee: '₹100 (exempt for Women / SC / ST / PwBD / ESM)',
    notificationNumber: 'HQ-C11018/1/2026-C-1',
    notificationDate: '2026-05-21T00:00:00.000Z',
    applicationStart: '2026-05-21T00:00:00.000Z',
    applicationDeadline: '2026-06-25T17:29:59.000Z',
    feeDeadline: '2026-06-26T17:29:59.000Z',
    correctionStart: '2026-07-01T00:00:00.000Z',
    correctionEnd: '2026-07-03T17:29:59.000Z',
    admitCardDate: '2026-09-27T00:00:00.000Z',
    examDate: '2026-09-30T00:00:00.000Z',
    examEndDate: '2026-10-30T00:00:00.000Z',
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: "Bachelor's degree; age 18–32 as on 01-08-2026 with post-specific variation.",
    officialNotification: 'https://ssc.gov.in/',
    officialApplication: 'https://ssc.gov.in/',
    officialWebsite: 'https://ssc.gov.in',
    sourceUrls: [
      'https://ssc.gov.in/',
      'https://www.freejobalert.com/articles/ssc-cgl-recruitment-2026-apply-online-for-12256-group-b-group-c-posts-3050273',
      'https://www.pw.live/ssc/exams/ssc-cgl-2026-exam',
      'https://www.class24.study/ssc-cgl/ssc-cgl-exam-application-form',
    ],
    conflictFlags: [
      {
        field: 'application deadline',
        values: [
          { value: '2026-06-22', url: 'https://www.class24.study/ssc-cgl/ssc-cgl-exam-application-form', isOfficial: false },
          { value: '2026-06-25', url: 'https://www.freejobalert.com/articles/ssc-cgl-recruitment-2026-apply-online-for-12256-group-b-group-c-posts-3050273', isOfficial: false },
        ],
        resolution:
          'The original last date was 22 June 2026 and the window was subsequently reopened to 25 June 2026 (23:00 hrs). The later date is the effective deadline; ssc.gov.in is authoritative.',
      },
      {
        field: 'vacancies',
        values: [
          { value: '12256', url: 'https://www.freejobalert.com/articles/ssc-cgl-recruitment-2026-apply-online-for-12256-group-b-group-c-posts-3050273', isOfficial: false },
          { value: '10731', url: 'https://testbook.com/ssc-cgl-exam', isOfficial: false },
        ],
        resolution: 'A revised vacancy figure of 10,731 has been reported. Confirm the current figure in the notification on ssc.gov.in.',
      },
    ],
    verificationStatus: 'conflicting',
    notes:
      'Applications closed on 25 June 2026. Tier-I CBE is scheduled 30 September – 30 October 2026 and Tier-II in December 2026.',
  },
  {
    key: 'ibps-clerk-2026',
    examName: 'IBPS Clerk Recruitment 2026 (CRP CSA XVI)',
    organization: 'Institute of Banking Personnel Selection',
    organizationType: 'banking',
    category: 'banking',
    post: 'Customer Service Associate (Clerk) in participating public sector banks',
    qualification: ["Graduation in any stream from a recognised university"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: [],
    ageMin: 20,
    ageMax: 28,
    ageRelaxation: 'As per the IBPS notification',
    experienceRequired: 'Not required',
    experienceMinYears: 0,
    vacancies: 11403,
    applicationFee: 'As per the notification',
    notificationNumber: 'CRP CSA XVI',
    notificationDate: '2026-08-01T00:00:00.000Z',
    applicationStart: '2026-08-01T00:00:00.000Z',
    applicationDeadline: '2026-08-28T17:29:59.000Z',
    feeDeadline: '2026-08-28T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: '2026-10-10T00:00:00.000Z',
    examEndDate: '2026-10-11T00:00:00.000Z',
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: 'Graduation in any stream; age 20–28. Local language proficiency is tested after the mains.',
    officialNotification: 'https://www.ibps.in/',
    officialApplication: 'https://www.ibps.in/',
    officialWebsite: 'https://www.ibps.in',
    sourceUrls: [
      'https://www.ibps.in/',
      'https://www.careerpower.in/ibps-clerk-apply-online.html',
      'https://examcart.in/blogs/central-exam/ibps-clerk-notification-out-exam-date-syllabus-eligibility-pattern',
    ],
    conflictFlags: [
      {
        field: 'application deadline',
        values: [
          { value: '2026-08-21', url: 'https://examcart.in/blogs/central-exam/ibps-clerk-notification-out-exam-date-syllabus-eligibility-pattern', isOfficial: false },
          { value: '2026-08-28', url: 'https://www.careerpower.in/ibps-clerk-apply-online.html', isOfficial: false },
        ],
        resolution: 'The original deadline was 21 August 2026 and was extended to 28 August 2026. ibps.in is authoritative.',
      },
    ],
    verificationStatus: 'conflicting',
    notes: 'Applications closed. Preliminary examination 10–11 October 2026; mains 27 December 2026.',
  },
  {
    key: 'ibps-po-2026',
    examName: 'IBPS PO Recruitment 2026 (CRP-PO/MT-XVI)',
    organization: 'Institute of Banking Personnel Selection',
    organizationType: 'banking',
    category: 'banking',
    post: 'Probationary Officer / Management Trainee in participating public sector banks',
    qualification: ["Graduation in any stream from a recognised university"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: [],
    ageMin: 20,
    ageMax: 30,
    ageRelaxation: 'As per the IBPS notification',
    experienceRequired: 'Not required',
    experienceMinYears: 0,
    vacancies: 7565,
    applicationFee: 'As per the notification',
    notificationNumber: 'CRP-PO/MT-XVI',
    notificationDate: '2026-07-01T00:00:00.000Z',
    applicationStart: '2026-07-01T00:00:00.000Z',
    applicationDeadline: '2026-07-26T17:29:59.000Z',
    feeDeadline: '2026-07-26T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: '2026-10-04T00:00:00.000Z',
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: 'Graduation in any stream; age 20–30.',
    officialNotification: 'https://www.ibps.in/',
    officialApplication: 'https://www.ibps.in/',
    officialWebsite: 'https://www.ibps.in',
    sourceUrls: ['https://www.ibps.in/', 'https://edutap.in/ibps-po/'],
    conflictFlags: [],
    verificationStatus: 'needs_verification',
    notes: 'Applications closed 26 July 2026. Prelims were held 22–23 August 2026; mains 4 October 2026; interview expected Nov–Dec 2026.',
  },
  {
    key: 'ibps-rrb-2026',
    examName: 'IBPS RRB Recruitment 2026 — Office Assistant / PO / Officer Scale II & III',
    organization: 'Institute of Banking Personnel Selection',
    organizationType: 'banking',
    category: 'banking',
    post: 'Office Assistant (Multipurpose) · Officer Scale I (PO) · Officer Scale II & III in Regional Rural Banks',
    qualification: ["Bachelor's degree in any stream"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: [],
    ageMin: 18,
    ageMax: 40,
    ageRelaxation: 'Post-specific; see the CRP notification',
    experienceRequired: 'Varies by officer scale',
    experienceMinYears: 0,
    vacancies: 8183,
    applicationFee: 'As per the notification',
    notificationNumber: 'CRP RRB 2026',
    notificationDate: '2026-08-31T00:00:00.000Z',
    applicationStart: '2026-09-01T00:00:00.000Z',
    applicationDeadline: '2026-09-27T17:29:59.000Z',
    feeDeadline: '2026-09-27T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: null,
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: "Bachelor's degree; age band varies by post. Pre-Exam Training expected November 2026.",
    officialNotification: 'https://www.ibps.in/',
    officialApplication: 'https://www.ibps.in/',
    officialWebsite: 'https://www.ibps.in',
    sourceUrls: ['https://www.ibps.in/', 'https://www.practicemock.com/blog/ibps-rrb-clerk-notification-2026/'],
    conflictFlags: [],
    verificationStatus: 'needs_verification',
    notes: 'Registration closed on 27 September 2026. Application print-out window ran to 5 October 2026.',
  },
  {
    key: 'upsc-cse-2027',
    examName: 'UPSC Civil Services Examination 2027 (Preliminary)',
    organization: 'Union Public Service Commission',
    organizationType: 'central',
    category: 'upsc',
    post: 'IAS · IPS · IFS · IRS and other Central Services',
    qualification: ["Bachelor's degree from a recognised university (final-year students may apply)"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: [],
    ageMin: 21,
    ageMax: 32,
    ageRelaxation: 'Up to 5 years for OBC, 10 years for SC/ST; age computed as on 1 August 2027',
    experienceRequired: 'Not required',
    experienceMinYears: 0,
    vacancies: null,
    applicationFee: '₹100 (exempt for female / SC / ST / PwBD candidates)',
    notificationNumber: 'Annual Programme of Examinations 2027',
    notificationDate: '2027-01-13T00:00:00.000Z',
    applicationStart: '2027-01-13T00:00:00.000Z',
    applicationDeadline: '2027-02-02T17:29:59.000Z',
    feeDeadline: '2027-02-02T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: '2027-05-23T00:00:00.000Z',
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: "Bachelor's degree; age 21–32 as on 1 August 2027; 6 attempts for General category.",
    officialNotification: 'https://upsc.gov.in/',
    officialApplication: 'https://upsconline.nic.in/',
    officialWebsite: 'https://upsc.gov.in',
    sourceUrls: [
      'https://upsc.gov.in/',
      'https://timesofindia.indiatimes.com/education/news/upsc-exam-calendar-2027-released-at-upsc-gov-in-civil-services-prelims-on-may-23-check-complete-exam-schedule-here/articleshow/131241549.cms',
      'https://indianexpress.com/article/education/upsc-announces-2027-calendar-cse-prelims-mains-nda-na-ies-exam-dates-10700540/',
    ],
    conflictFlags: [],
    verificationStatus: 'needs_verification',
    notes:
      'Dates are from the official UPSC Annual Exam Calendar 2027 released 20 May 2026. UPSC has stated dates may be altered if circumstances require. Mains begin 20 August 2027.',
  },
  {
    key: 'upsc-nda-cds-1-2027',
    examName: 'UPSC NDA & NA (I) 2027 and CDS (I) 2027',
    organization: 'Union Public Service Commission',
    organizationType: 'defence',
    category: 'defence',
    post: 'National Defence Academy · Naval Academy · Combined Defence Services',
    qualification: ['12th pass for NDA; Bachelor’s degree for CDS'],
    degreeLevels: ['school', 'bachelor'],
    fieldsOfStudy: [],
    ageMin: 16,
    ageMax: 25,
    ageRelaxation: 'Strict age windows per the notification',
    experienceRequired: 'Not required',
    experienceMinYears: 0,
    vacancies: null,
    applicationFee: '₹100',
    notificationNumber: 'Annual Programme of Examinations 2027',
    notificationDate: '2026-12-02T00:00:00.000Z',
    applicationStart: '2026-12-02T00:00:00.000Z',
    applicationDeadline: '2026-12-22T17:29:59.000Z',
    feeDeadline: '2026-12-22T17:29:59.000Z',
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: '2027-04-11T00:00:00.000Z',
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility: 'NDA: 12th pass (Physics & Mathematics for Air Force/Navy). CDS: degree, with post-specific age limits.',
    officialNotification: 'https://upsc.gov.in/',
    officialApplication: 'https://upsconline.nic.in/',
    officialWebsite: 'https://upsc.gov.in',
    sourceUrls: [
      'https://upsc.gov.in/',
      'https://www.bweducation.com/article/upsc-releases-2027-dates-for-civil-services-nda-cds-exams-607762',
      'https://indianexpress.com/article/education/upsc-announces-2027-calendar-cse-prelims-mains-nda-na-ies-exam-dates-10700540/',
    ],
    conflictFlags: [],
    verificationStatus: 'needs_verification',
    notes: 'Notification 2 December 2026; applications close 22 December 2026; examination 11 April 2027.',
  },
  {
    key: 'sebi-grade-a-2026',
    examName: 'SEBI Officer Grade A (Assistant Manager) Recruitment 2026',
    organization: 'Securities and Exchange Board of India',
    organizationType: 'regulatory',
    category: 'regulatory',
    post: 'Officer Grade A (Assistant Manager) — General / Legal / Research streams',
    qualification: ["Bachelor's degree in Law / Engineering / Economics / Commerce / Management, or CA/CFA/CS"],
    degreeLevels: ['bachelor'],
    fieldsOfStudy: ['commerce', 'finance', 'economics', 'management'],
    ageMin: 21,
    ageMax: 30,
    ageRelaxation: 'As per the notification',
    experienceRequired: 'Not required for the General stream',
    experienceMinYears: 0,
    vacancies: null,
    applicationFee: 'As per the notification',
    notificationNumber: '',
    notificationDate: null,
    applicationStart: null,
    applicationDeadline: null,
    feeDeadline: null,
    correctionStart: null,
    correctionEnd: null,
    admitCardDate: null,
    examDate: null,
    examEndDate: null,
    answerKeyStatus: 'not_released',
    resultStatus: 'not_declared',
    eligibility:
      "Bachelor's degree in Commerce, Management, Economics, Law or Engineering; professional qualifications (CA/CFA/CS) are preferred for the Research stream.",
    officialNotification: 'https://www.sebi.gov.in/',
    officialApplication: 'https://www.sebi.gov.in/',
    officialWebsite: 'https://www.sebi.gov.in',
    sourceUrls: ['https://www.sebi.gov.in/', 'https://www.adda247.com/jobs/sebi-grade-a-exam/', 'https://www.practicemock.com/blog/sebi-grade-a-notification/'],
    conflictFlags: [
      {
        field: 'notification date',
        values: [
          { value: 'November 2026', url: 'https://www.adda247.com/jobs/sebi-grade-a-exam/', isOfficial: false },
          { value: 'September/October 2026', url: 'https://www.practicemock.com/blog/sebi-grade-a-notification/', isOfficial: false },
        ],
        resolution: 'Secondary sources disagree on the notification month and neither is official. No date is asserted here — watch sebi.gov.in.',
      },
    ],
    verificationStatus: 'conflicting',
    notes:
      'Notification not yet released as of 29 September 2026. Expected vacancy estimates of 80–130 are secondary-source speculation and are deliberately not stored as fact.',
  },
];

export interface SeedOpportunity {
  key: string;
  title: string;
  organization: string;
  type: string;
  category: string;
  jobFamily: string;
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
  vacancies: number | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  officialSource: string;
  applicationUrl: string;
  sourceUrls: string[];
  isGovernment: boolean;
  isDemo: boolean;
  verificationStatus: string;
  notes: string;
}

/** Public-sector listings sourced from a recruitment aggregator (tier 4) — not verified. */
export const SEED_OPPORTUNITIES: SeedOpportunity[] = [
  {
    key: 'wapcos-young-professional-2026',
    title: 'Young Professional — Finance & Accounts',
    organization: 'WAPCOS Limited',
    type: 'government_job',
    category: 'psu',
    jobFamily: 'Accounting & Finance',
    locations: ['Delhi', 'Pan India'],
    workMode: 'onsite',
    employmentType: 'contract',
    description:
      'Young Professional engagement for CA / M.Com / MBA (Finance) candidates. Engagement is contractual and advertised through the WAPCOS careers notice board.',
    qualification: ['CA', 'M.Com', 'MBA/PGDM'],
    degreeLevels: ['master', 'professional'],
    fieldsOfStudy: ['commerce', 'accounting', 'finance'],
    skills: ['Financial Analysis', 'MS Excel', 'Budgeting', 'Financial Statements'],
    experienceRequired: 'As per the advertisement',
    experienceMinYears: null,
    salary: '',
    vacancies: 37,
    applicationStart: null,
    applicationDeadline: '2026-10-08T17:29:59.000Z',
    officialSource: '',
    applicationUrl: 'https://www.wapcos.co.in/',
    sourceUrls: ['https://govtjobguru.in/jobs-by-qualification/jobs-for-graduate/', 'https://www.wapcos.co.in/'],
    isGovernment: true,
    isDemo: false,
    verificationStatus: 'needs_verification',
    notes: 'Deadline reported by a secondary aggregator on 13 September 2026. Confirm on the WAPCOS careers page before applying.',
  },
  {
    key: 'hspcb-accounts-clerk-2026',
    title: 'Accounts Clerk / Assistant and other posts',
    organization: 'Haryana State Pollution Control Board',
    type: 'government_job',
    category: 'state',
    jobFamily: 'Accounting & Finance',
    locations: ['Haryana'],
    workMode: 'onsite',
    employmentType: 'full_time',
    description:
      'Recruitment for Accounts Clerk, Assistant, Stenographer and Engineer posts. Commerce postgraduates and B.Com graduates are listed among the eligible qualifications.',
    qualification: ['B.Com', 'M.Com', 'M.Sc', 'MCA'],
    degreeLevels: ['bachelor', 'master'],
    fieldsOfStudy: ['commerce', 'accounting'],
    skills: ['Bookkeeping', 'MS Excel', 'General Ledger'],
    experienceRequired: 'As per the advertisement',
    experienceMinYears: null,
    salary: '',
    vacancies: 76,
    applicationStart: null,
    applicationDeadline: '2026-10-01T17:29:59.000Z',
    officialSource: '',
    applicationUrl: 'https://hspcb.gov.in/',
    sourceUrls: ['https://govtjobguru.in/jobs-by-qualification/jobs-for-graduate/'],
    isGovernment: true,
    isDemo: false,
    verificationStatus: 'needs_verification',
    notes: 'Single secondary source as of 20 September 2026 — no official notification captured. Verify Before Applying.',
  },
  {
    key: 'exim-bank-bdo-2026',
    title: 'Business Development Officer',
    organization: 'India Exim Bank',
    type: 'government_job',
    category: 'banking',
    jobFamily: 'Sales',
    locations: ['Mumbai', 'Pan India'],
    workMode: 'onsite',
    employmentType: 'full_time',
    description: 'Business Development Officer roles for postgraduates in Marketing or Finance; MBA preferred.',
    qualification: ["Postgraduate in Marketing / Finance", 'MBA'],
    degreeLevels: ['master'],
    fieldsOfStudy: ['marketing', 'finance', 'management'],
    skills: ['Sales', 'Stakeholder Management', 'Communication Skills', 'Market Research'],
    experienceRequired: 'As per the advertisement',
    experienceMinYears: null,
    salary: '',
    vacancies: 12,
    applicationStart: null,
    applicationDeadline: '2026-10-15T17:29:59.000Z',
    officialSource: '',
    applicationUrl: 'https://www.eximbankindia.in/',
    sourceUrls: ['https://govtjobguru.in/jobs-by-qualification/jobs-for-graduate/'],
    isGovernment: true,
    isDemo: false,
    verificationStatus: 'needs_verification',
    notes: 'Deadline reported by a secondary aggregator. Confirm on the Exim Bank careers page.',
  },
  {
    key: 'optcl-apprentice-2026',
    title: 'Graduate / Diploma / ITI Apprentice (Degree Non-Engineering incl. M.Com)',
    organization: 'Odisha Power Transmission Corporation Limited',
    type: 'apprenticeship',
    category: 'apprenticeship',
    jobFamily: 'Accounting & Finance',
    locations: ['Odisha'],
    workMode: 'onsite',
    employmentType: 'apprenticeship',
    description:
      'Apprenticeship engagement across Degree Engineering, Degree Non-Engineering, Diploma Technician and ITI trades. M.Com and MBA are among the eligible non-engineering qualifications.',
    qualification: ['BE/B.Tech', 'MBA', 'M.Com', 'LLM', 'LLB', 'Diploma', 'ITI'],
    degreeLevels: ['bachelor', 'master', 'diploma'],
    fieldsOfStudy: ['commerce', 'management', 'law', 'engineering'],
    skills: [],
    experienceRequired: 'Freshers eligible',
    experienceMinYears: 0,
    salary: 'Stipend as per the Apprentices Act',
    vacancies: 100,
    applicationStart: null,
    applicationDeadline: '2026-10-01T17:29:59.000Z',
    officialSource: '',
    applicationUrl: 'https://optcl.co.in/',
    sourceUrls: ['https://govtjobguru.in/jobs-by-qualification/jobs-for-graduate/', 'https://apprenticeindia.gov.in/'],
    isGovernment: true,
    isDemo: false,
    verificationStatus: 'needs_verification',
    notes: 'Apprenticeship registration is normally routed through apprenticeindia.gov.in (NAPS). Confirm the current notice on optcl.co.in.',
  },
];

/**
 * Synthetic private-sector listings used only to exercise the dashboard when no live search
 * provider is configured. They are flagged `is_demo`, use generic employer names, and are
 * badged in the UI. Deadlines are generated relative to seed time so the deadline engine
 * has examples in every urgency band.
 */
export function demoOpportunities(now = new Date()): SeedOpportunity[] {
  const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const demoNote = 'DEMONSTRATION LISTING — synthetic data used to exercise the matching and deadline engines. Not a live vacancy.';

  return [
    {
      key: 'demo-junior-financial-analyst',
      title: 'Junior Financial Analyst',
      organization: 'Demo Manufacturing Pvt Ltd (sample listing)',
      type: 'job',
      category: 'Accounting & Finance',
      jobFamily: 'Accounting & Finance',
      locations: ['Chennai', 'Tamil Nadu'],
      workMode: 'onsite',
      employmentType: 'full_time',
      description:
        'Support month-end close, prepare management reports, maintain ledgers and assist with budget variance analysis for two business units.',
      qualification: ['M.Com', 'B.Com', 'MBA'],
      degreeLevels: ['bachelor', 'master'],
      fieldsOfStudy: ['commerce', 'accounting', 'finance'],
      skills: ['Financial Analysis', 'MS Excel', 'Financial Statements', 'Budgeting', 'Power BI'],
      experienceRequired: '0–2 years',
      experienceMinYears: 0,
      salary: '₹3.6 – 5.5 LPA',
      vacancies: 2,
      applicationStart: at(-12),
      applicationDeadline: at(9),
      officialSource: '',
      applicationUrl: '',
      sourceUrls: [],
      isGovernment: false,
      isDemo: true,
      verificationStatus: 'needs_verification',
      notes: demoNote,
    },
    {
      key: 'demo-accounts-executive',
      title: 'Accounts Executive (GST & TDS)',
      organization: 'Demo Retail Group (sample listing)',
      type: 'job',
      category: 'Accounting & Finance',
      jobFamily: 'Taxation',
      locations: ['Coimbatore', 'Tamil Nadu'],
      workMode: 'hybrid',
      employmentType: 'full_time',
      description:
        'Handle GST returns (GSTR-1, GSTR-3B), TDS computation and deposit, vendor reconciliation and monthly books closure in Tally.',
      qualification: ['B.Com', 'M.Com'],
      degreeLevels: ['bachelor', 'master'],
      fieldsOfStudy: ['commerce', 'accounting'],
      skills: ['GST Filing', 'TDS', 'Tally ERP', 'Bank Reconciliation', 'MS Excel', 'Accounts Payable'],
      experienceRequired: '1–3 years',
      experienceMinYears: 1,
      salary: '₹2.8 – 4.2 LPA',
      vacancies: 1,
      applicationStart: at(-20),
      applicationDeadline: at(2),
      officialSource: '',
      applicationUrl: '',
      sourceUrls: [],
      isGovernment: false,
      isDemo: true,
      verificationStatus: 'needs_verification',
      notes: demoNote,
    },
    {
      key: 'demo-jr-data-analyst',
      title: 'Junior Data Analyst — Business Reporting',
      organization: 'Demo Analytics Services (sample listing)',
      type: 'job',
      category: 'Data & Analytics',
      jobFamily: 'Data & Analytics',
      locations: ['Bengaluru', 'Remote'],
      workMode: 'remote',
      employmentType: 'full_time',
      description:
        'Build recurring dashboards, write SQL extracts, clean source data and present weekly business reviews to the operations leadership team.',
      qualification: ["Bachelor's degree"],
      degreeLevels: ['bachelor'],
      fieldsOfStudy: [],
      skills: ['SQL', 'MS Excel', 'Power BI', 'Data Analysis', 'Data Visualization'],
      experienceRequired: '0–2 years',
      experienceMinYears: 0,
      salary: '₹4.0 – 6.5 LPA',
      vacancies: 3,
      applicationStart: at(-6),
      applicationDeadline: at(21),
      officialSource: '',
      applicationUrl: '',
      sourceUrls: [],
      isGovernment: false,
      isDemo: true,
      verificationStatus: 'needs_verification',
      notes: demoNote,
    },
    {
      key: 'demo-hr-executive',
      title: 'HR Executive — Recruitment & Operations',
      organization: 'Demo Logistics Ltd (sample listing)',
      type: 'job',
      category: 'Human Resources',
      jobFamily: 'Human Resources',
      locations: ['Chennai', 'Tamil Nadu'],
      workMode: 'onsite',
      employmentType: 'full_time',
      description:
        'End-to-end recruitment for blue and white collar roles, onboarding documentation, attendance and payroll input, and employee engagement activities.',
      qualification: ['MBA', 'BBA', "Bachelor's degree"],
      degreeLevels: ['bachelor', 'master'],
      fieldsOfStudy: ['management'],
      skills: ['Recruitment', 'Onboarding', 'HR Operations', 'Payroll Processing', 'MS Excel'],
      experienceRequired: '1–4 years',
      experienceMinYears: 1,
      salary: '₹3.0 – 4.8 LPA',
      vacancies: 1,
      applicationStart: at(-30),
      applicationDeadline: at(-3),
      officialSource: '',
      applicationUrl: '',
      sourceUrls: [],
      isGovernment: false,
      isDemo: true,
      verificationStatus: 'needs_verification',
      notes: demoNote,
    },
    {
      key: 'demo-finance-intern',
      title: 'Finance & Accounting Intern',
      organization: 'Demo Consulting Partners (sample listing)',
      type: 'internship',
      category: 'Accounting & Finance',
      jobFamily: 'Accounting & Finance',
      locations: ['Thanjavur', 'Remote'],
      workMode: 'remote',
      employmentType: 'internship',
      description:
        'Six-month internship supporting ledger maintenance, invoice processing, expense tracking and month-end reporting for small-business clients.',
      qualification: ['B.Com', 'M.Com'],
      degreeLevels: ['bachelor', 'master'],
      fieldsOfStudy: ['commerce', 'accounting'],
      skills: ['Bookkeeping', 'MS Excel', 'Accounts Receivable', 'General Ledger'],
      experienceRequired: 'Freshers eligible',
      experienceMinYears: 0,
      salary: '₹10,000 – 15,000 per month',
      vacancies: 4,
      applicationStart: at(-4),
      applicationDeadline: at(35),
      officialSource: '',
      applicationUrl: '',
      sourceUrls: [],
      isGovernment: false,
      isDemo: true,
      verificationStatus: 'needs_verification',
      notes: demoNote,
    },
    {
      key: 'demo-suspicious-listing',
      title: 'Urgent Back Office Executives — Guaranteed Job, Pay Registration Fee',
      organization: '',
      type: 'job',
      category: 'Administration',
      jobFamily: 'Administration',
      locations: ['Chennai'],
      workMode: 'onsite',
      employmentType: 'full_time',
      description:
        'Guaranteed job with instant offer. Pay a registration fee of ₹2,500 to secure your slot. Earn ₹45,000 per week from home. Send your CV on WhatsApp only.',
      qualification: ['Any degree'],
      degreeLevels: ['bachelor'],
      fieldsOfStudy: [],
      skills: [],
      experienceRequired: 'No experience needed',
      experienceMinYears: 0,
      salary: '₹45,000 per week',
      vacancies: null,
      applicationStart: null,
      applicationDeadline: at(5),
      officialSource: '',
      applicationUrl: 'http://bit.ly/apply-now-demo',
      sourceUrls: [],
      isGovernment: false,
      isDemo: true,
      verificationStatus: 'suspicious',
      notes: `${demoNote} Included deliberately so the scam/trust engine has a negative example to score.`,
    },
  ];
}

export const SEED_USERS = [
  {
    email: 'admin@opportunity-analyzer.local',
    name: 'Platform Super Admin',
    role: 'super_admin',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!SuperAdmin2026',
    note: 'Super Admin — platform, AI, security and role configuration.',
  },
  {
    email: 'ops@opportunity-analyzer.local',
    name: 'Platform Admin',
    role: 'admin',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!SuperAdmin2026',
    note: 'Platform Admin — users, content, monitoring and analytics.',
  },
  {
    email: 'analyst@opportunity-analyzer.local',
    name: 'Data Analyst',
    role: 'analyst',
    password: process.env.SEED_ANALYST_PASSWORD ?? 'ChangeMe!Analyst2026',
    note: 'Data / Opportunity Analyst — verifies opportunities, exams and sources.',
  },
  {
    email: 'recruiter@opportunity-analyzer.local',
    name: 'Verified Recruiter',
    role: 'recruiter',
    password: process.env.SEED_RECRUITER_PASSWORD ?? 'ChangeMe!Recruiter2026',
    note: 'Verified Recruiter — manages own organisation listings.',
  },
  {
    email: 'candidate@opportunity-analyzer.local',
    name: 'Sample Candidate',
    role: 'candidate',
    password: process.env.SEED_CANDIDATE_PASSWORD ?? 'ChangeMe!Candidate2026',
    note: 'Candidate — the default role every self-registered user receives.',
  },
];

/**
 * Seed rows come straight from the settings registry (src/lib/config.ts), so the seeded database,
 * the admin panel and the running code always describe the same set of settings. (They used to
 * be separate lists, and most seeded settings were read by nothing at all.)
 */
export const SEED_FEATURE_FLAGS = FLAG_SPECS.map((flag) => ({ key: flag.key, enabled: flag.default ? 1 : 0, description: flag.description }));

export const SEED_PLATFORM_CONFIG = CONFIG_SPECS.map((spec) => ({ key: spec.key, value: spec.default, category: spec.category, description: spec.description }));

export function stableId(prefix: string, key: string): string {
  const hash = createHash('sha1').update(`${prefix}:${key}`).digest('hex');
  // Shape it like a UUID so it is interchangeable with runtime-generated ids.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

export { randomUUID };
