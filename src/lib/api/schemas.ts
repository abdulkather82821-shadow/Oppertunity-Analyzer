import { z } from 'zod';

/** Every request body is validated here before it reaches a handler. */

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  password: z.string().min(10, 'Password must be at least 10 characters.').max(200),
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  /** Always coerced to `candidate` server-side — role escalation via signup is impossible. */
  role: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional(),
});

export const settingsSchema = z.object({
  preferredLocations: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  preferredJobTypes: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  salaryMin: z.number().int().nonnegative().nullable().optional(),
  salaryMax: z.number().int().nonnegative().nullable().optional(),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP']).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  dateFormat: z.enum(['indian', 'iso', 'us']).optional(),
  notifyDeadline: z.boolean().optional(),
  notifyNewMatch: z.boolean().optional(),
  notifyExam: z.boolean().optional(),
  notifyBrowser: z.boolean().optional(),
  notifyEmail: z.boolean().optional(),
  digestDaily: z.boolean().optional(),
  digestWeekly: z.boolean().optional(),
  scoringWeights: z
    .object({
      skill: z.number().min(0).max(100).optional(),
      qualification: z.number().min(0).max(100).optional(),
      experience: z.number().min(0).max(100).optional(),
      role: z.number().min(0).max(100).optional(),
      location: z.number().min(0).max(100).optional(),
      industry: z.number().min(0).max(100).optional(),
      salary: z.number().min(0).max(100).optional(),
      careerGrowth: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export const savedSchema = z.object({
  opportunityId: z.string().uuid().nullable().optional(),
  examId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).optional(),
  reminderAt: z.string().datetime().nullable().optional(),
}).refine((value) => Boolean(value.opportunityId ?? value.examId), {
  message: 'Provide either opportunityId or examId.',
});

export const applicationSchema = z.object({
  id: z.string().uuid().optional(),
  opportunityId: z.string().uuid().nullable().optional(),
  examId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(200).optional(),
  status: z
    .enum(['interested', 'to_apply', 'applied', 'test_scheduled', 'interview_scheduled', 'selected', 'rejected', 'withdrawn'])
    .optional(),
  appliedAt: z.string().datetime().nullable().optional(),
  testAt: z.string().datetime().nullable().optional(),
  interviewAt: z.string().datetime().nullable().optional(),
  interviewInfo: z.string().max(1000).optional(),
  resultKnown: z.string().max(200).nullable().optional(),
  notes: z.string().max(4000).optional(),
});

export const feedbackSchema = z.object({
  opportunityId: z.string().uuid().nullable().optional(),
  examId: z.string().uuid().nullable().optional(),
  verdict: z.enum(['relevant', 'not_relevant', 'already_applied', 'not_eligible', 'wrong_information']),
  comment: z.string().max(1000).optional(),
}).refine((value) => Boolean(value.opportunityId ?? value.examId), {
  message: 'Provide either opportunityId or examId.',
});

export const chatSchema = z.object({
  message: z.string().trim().min(1, 'Ask something first.').max(2000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).optional(),
});

export const searchRunSchema = z.object({
  maxQueries: z.number().int().min(1).max(40).optional(),
  /** Return immediately with the job id and run in the background; poll /api/search/status/[id]. */
  background: z.boolean().optional(),
});

export const optimizerSchema = z.object({
  opportunityId: z.string().uuid().optional(),
  jobDescription: z.string().trim().min(40, 'Paste the full job description.').max(20_000).optional(),
});

export const profileEditSchema = z.object({
  fullName: z.string().trim().max(120).nullable().optional(),
  professionalTitle: z.string().trim().max(160).nullable().optional(),
  careerObjective: z.string().trim().max(2000).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  preferredLocations: z.array(z.string().trim().max(80)).max(20).optional(),
  totalExperienceYears: z.number().min(0).max(60).nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
  salaryExpectation: z.string().trim().max(120).nullable().optional(),
  addSkills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
  removeSkills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
});

export const adminUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['candidate', 'recruiter', 'analyst', 'moderator', 'admin', 'super_admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  reason: z.string().max(500).optional(),
  /** Second confirmation required for privilege escalation. */
  confirm: z.boolean().optional(),
});

export const adminOpportunitySchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  organization: z.string().trim().max(200).optional(),
  applicationStart: z.string().datetime().nullable().optional(),
  applicationDeadline: z.string().datetime().nullable().optional(),
  examDate: z.string().datetime().nullable().optional(),
  status: z.string().max(40).optional(),
  verificationStatus: z.enum(['verified', 'needs_verification', 'suspicious', 'conflicting']).optional(),
  isActive: z.boolean().optional(),
  officialSource: z.string().url().max(1000).optional(),
  applicationUrl: z.string().url().max(1000).optional(),
  reason: z.string().max(500).optional(),
});

export const adminExamSchema = z.object({
  id: z.string().uuid(),
  applicationStart: z.string().datetime().nullable().optional(),
  applicationDeadline: z.string().datetime().nullable().optional(),
  examDate: z.string().datetime().nullable().optional(),
  admitCardDate: z.string().datetime().nullable().optional(),
  resultStatus: z.string().max(40).optional(),
  answerKeyStatus: z.string().max(40).optional(),
  interviewStatus: z.string().max(40).optional(),
  finalResultStatus: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  vacancies: z.number().int().nonnegative().nullable().optional(),
  officialNotification: z.string().url().max(1000).optional(),
  officialApplication: z.string().url().max(1000).optional(),
  reason: z.string().max(500).optional(),
});

/** Either a setting change `{ key, value }` or a feature-flag change `{ flag, enabled }`. */
export const adminConfigSchema = z.union([
  z.object({
    key: z.string().trim().min(1).max(120),
    value: z.string().max(4000),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    flag: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    reason: z.string().max(500).optional(),
  }),
]);

/** TOTP second-factor verification. */
export const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.'),
});
