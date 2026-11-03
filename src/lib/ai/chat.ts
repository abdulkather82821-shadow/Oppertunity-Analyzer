import { z } from 'zod';
import { db, jsonDecode, jsonList } from '@/lib/db';
import { runAi } from '@/lib/ai';
import { CHAT_SYSTEM, DIGEST_SYSTEM, ROADMAP_SYSTEM, RESUME_OPTIMIZER_SYSTEM } from '@/lib/ai/prompts';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import { FAMILY_UPSKILL } from '@/lib/analysis/profiler';
import { describeDeadline, relativeTime } from '@/lib/opportunity/deadline';

/**
 * AI assistant, digest, roadmap and resume-optimiser.
 *
 * All four are grounded: the model is given only the caller's profile and the records that
 * actually exist in their database, and the deterministic fallback answers from that same
 * data. When the model is unavailable the answer is still correct, just plainer.
 */

const ChatSchema = z.object({
  answer: z.string().min(1).max(4000),
  references: z.array(z.object({ kind: z.enum(['opportunity', 'exam', 'profile']), id: z.string(), title: z.string() })).max(12).default([]),
});

export interface ChatReply {
  answer: string;
  references: { kind: string; id: string; title: string }[];
  provider: string;
  usedFallback: boolean;
}

export async function answerQuestion(
  userId: string,
  profile: CandidateProfileData,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
): Promise<ChatReply> {
  const context = await buildAnswerContext(userId, profile, message);

  const outcome = await runAi<{ answer: string; references: { kind: string; id: string; title: string }[] }>({
    task: 'chat',
    system: CHAT_SYSTEM,
    input: {
      question: message,
      conversation: history.slice(-6),
      candidate: compactProfile(profile),
      opportunities: context.opportunities,
      exams: context.exams,
      saved: context.saved,
      applications: context.applications,
      today: new Date().toISOString(),
    },
    schema: ChatSchema,
    fallback: () => deterministicAnswer(message, profile, context),
    maxTokens: 1200,
    temperature: 0.3,
    userId,
  });

  return { answer: outcome.data.answer, references: outcome.data.references ?? [], provider: outcome.provider, usedFallback: outcome.usedFallback };
}

async function buildAnswerContext(userId: string, profile: CandidateProfileData, message: string) {
  const lower = message.toLowerCase();
  const wantsGovernment = /gov|govt|government|ssc|upsc|ibps|rrb|bank|railway|psu|exam/.test(lower);
  const wantsClosing = /clos|deadline|this week|today|tomorrow|urgent|last date/.test(lower);
  const wantsFresher = /fresher|freshers|entry|no experience|intern/.test(lower);
  const wantsSaved = /saved|bookmark/.test(lower);
  const wantsApplications = /applied|application|tracker|status/.test(lower);

  const conditions: string[] = ['o.is_active = 1'];
  const params: unknown[] = [];
  if (wantsGovernment) conditions.push("o.type IN ('government_job','exam')");
  if (wantsFresher) conditions.push('(o.is_fresher_friendly = 1 OR COALESCE(o.experience_min_years, 0) = 0)');
  if (wantsClosing) {
    conditions.push('o.application_deadline IS NOT NULL');
    conditions.push('o.application_deadline >= ?');
    params.push(new Date().toISOString());
    conditions.push('o.application_deadline <= ?');
    params.push(new Date(Date.now() + 10 * 86_400_000).toISOString());
  }
  const location = profile.personal.location;
  if (location && /near|location|chennai|coimbatore|thanjavur|salem|madurai|bengaluru|hyderabad|mumbai|delhi/.test(lower)) {
    conditions.push('LOWER(o.locations) LIKE LOWER(?)');
    params.push(`%${location}%`);
  }

  const opportunities = (await db.query<any>(
    `SELECT id, title, organization, type, category, locations, application_deadline, application_start,
            status, final_score, match_score, trust_score, verification_status, official_source, salary,
            experience_required, skills, qualification
       FROM opportunities o WHERE ${conditions.join(' AND ')}
      ORDER BY o.final_score DESC LIMIT 15`,
    params,
  )).map((row: any) => ({
    id: row.id,
    title: row.title,
    organization: row.organization,
    type: row.type,
    category: row.category,
    locations: jsonList<string>(row.locations),
    deadline: describeDeadline(row.application_deadline, row.application_start).formatted,
    daysRemaining: describeDeadline(row.application_deadline, row.application_start).daysRemaining,
    status: row.status,
    score: Math.round(Number(row.final_score ?? 0)),
    trust: Math.round(Number(row.trust_score ?? 0)),
    verification: row.verification_status,
    officialSource: row.official_source || null,
    salary: row.salary || 'Unknown',
    experience: row.experience_required || 'Unknown',
    skills: jsonList<string>(row.skills).slice(0, 8),
  }));

  const exams = (await db.query<any>(
    `SELECT id, exam_name, organization, category, status, application_start, application_deadline,
            exam_date, vacancies, age_min, age_max, qualification, degree_levels, official_application
       FROM government_exams WHERE is_active = 1
      ORDER BY CASE status WHEN 'applications_open' THEN 0 WHEN 'closing_soon' THEN 1 WHEN 'notification_expected' THEN 2 ELSE 3 END LIMIT 12`,
  )).map((row: any) => ({
    id: row.id,
    name: row.exam_name,
    organization: row.organization,
    category: row.category,
    status: row.status,
    deadline: describeDeadline(row.application_deadline, row.application_start).formatted,
    daysRemaining: describeDeadline(row.application_deadline, row.application_start).daysRemaining,
    examDate: row.exam_date,
    vacancies: row.vacancies,
    age: row.age_min != null ? `${row.age_min}–${row.age_max}` : 'Unknown',
    qualification: jsonList<string>(row.qualification),
    officialApplication: row.official_application || null,
  }));

  const saved = wantsSaved
    ? (await db.query<any>(
        `SELECT s.opportunity_id, s.exam_id, o.title, e.exam_name FROM saved_opportunities s
           LEFT JOIN opportunities o ON o.id = s.opportunity_id
           LEFT JOIN government_exams e ON e.id = s.exam_id WHERE s.user_id = ? LIMIT 20`,
        [userId],
      )).map((row: any) => ({ title: row.title ?? row.exam_name, opportunityId: row.opportunity_id, examId: row.exam_id }))
    : [];

  const applications = wantsApplications
    ? (await db.query<any>('SELECT title, organization, status, updated_at FROM applications WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20', [userId])).map(
        (row: any) => ({ title: row.title, organization: row.organization, status: row.status, updatedAgo: relativeTime(row.updated_at) }),
      )
    : [];

  return { opportunities, exams, saved, applications };
}

type AnswerContext = Awaited<ReturnType<typeof buildAnswerContext>>;

/**
 * Deterministic answer path. Selects the right records with the same rules the UI uses and
 * explains the reasoning — so an offline deployment still answers "which job should I apply
 * for first?" truthfully instead of returning nothing.
 */
function deterministicAnswer(
  message: string,
  profile: CandidateProfileData,
  context: AnswerContext,
): { answer: string; references: { kind: string; id: string; title: string }[] } {
  const lower = message.toLowerCase();
  const references: { kind: string; id: string; title: string }[] = [];

  if (/which (job|opportunity|one) should i apply|apply (for )?first|best (job|match|opportunity)|what should i apply/i.test(lower)) {
    const open = context.opportunities.filter((o) => o.daysRemaining !== null && o.daysRemaining >= 0);
    const top = [...open].sort((a, b) => b.score - a.score).slice(0, 3);
    if (!top.length) {
      return {
        answer:
          'Right now none of your matched opportunities have an open application window. The strongest matches in your database are either closed or not yet open — I have listed the next ones to watch below rather than recommending something you cannot apply to.',
        references: context.opportunities.slice(0, 3).map((o) => ({ kind: 'opportunity', id: o.id, title: o.title })),
      };
    }
    const lines = top.map(
      (opportunity, index) =>
        `${index + 1}. ${opportunity.title}${opportunity.organization ? ` — ${opportunity.organization}` : ''} · AI match ${opportunity.score}% · ${
          opportunity.daysRemaining === 0 ? 'closes today' : `closes in ${opportunity.daysRemaining} day(s)`
        }${opportunity.verification === 'conflicting' ? ' · ⚠️ conflicting source dates' : ''}`,
    );
    top.forEach((opportunity) => references.push({ kind: 'opportunity', id: opportunity.id, title: opportunity.title }));
    return {
      answer: `Based on your ${profile.education[0]?.degree ?? 'qualification'} profile and current deadlines, apply in this order:\n\n${lines.join(
        '\n',
      )}\n\nStart with #1 — it has the highest match and the nearest deadline. Confirm the deadline on the official source before submitting.`,
      references,
    };
  }

  if (/eligible|eligibility|am i qualified/i.test(lower)) {
    const target = context.exams[0];
    if (!target) return { answer: 'I could not find an examination record to check eligibility against.', references: [] };
    const degree = profile.highestDegreeLevel || 'unknown';
    return {
      answer: `For ${target.name}: the stated qualification is ${target.qualification.join(', ') || 'not published'} and the age band is ${target.age}. Your profile shows a ${degree}-level qualification${
        profile.personal.ageYears ? ` and an age of ${profile.personal.ageYears}` : ' with no date of birth on the resume'
      }. ${
        profile.personal.ageYears
          ? 'Open the exam page for the full rule-by-rule eligibility check.'
          : 'I cannot confirm the age limit without a date of birth — add it in your profile or read the official notification.'
      } The official notification is always authoritative.`,
      references: [{ kind: 'exam', id: target.id, title: target.name }],
    };
  }

  if (/clos|deadline|this week|today|tomorrow|urgent/i.test(lower)) {
    const closing = context.opportunities
      .filter((o) => o.daysRemaining !== null && o.daysRemaining >= 0 && o.daysRemaining <= 10)
      .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0));
    if (!closing.length) return { answer: 'Nothing in your matched set closes in the next 10 days.', references: [] };
    closing.slice(0, 5).forEach((o) => references.push({ kind: 'opportunity', id: o.id, title: o.title }));
    return {
      answer: `Closing soon:\n\n${closing
        .slice(0, 5)
        .map((o) => `• ${o.title}${o.organization ? ` — ${o.organization}` : ''} · ${o.daysRemaining === 0 ? 'closes today' : `${o.daysRemaining} day(s) left`} (deadline ${o.deadline})`)
        .join('\n')}`,
      references,
    };
  }

  if (/what government|government (jobs|exams)|which exams/i.test(lower)) {
    const eligible = context.exams.filter((exam) => exam.status === 'applications_open' || exam.status === 'closing_soon' || exam.status === 'notification_expected');
    if (!eligible.length) return { answer: 'No government examinations are currently open or expected in your database.', references: [] };
    eligible.slice(0, 5).forEach((exam) => references.push({ kind: 'exam', id: exam.id, title: exam.name }));
    return {
      answer: `Government opportunities relevant to your ${profile.fieldsOfStudy[0] ?? 'qualification'} background:\n\n${eligible
        .slice(0, 5)
        .map((exam) => `• ${exam.name} (${exam.organization}) — ${exam.status.replace(/_/g, ' ')}${exam.daysRemaining !== null && exam.daysRemaining >= 0 ? `, ${exam.daysRemaining} day(s) left` : ''}`)
        .join('\n')}\n\nAlways confirm eligibility against the official notification.`,
      references,
    };
  }

  if (/skill|missing|gap|what should i learn/i.test(lower)) {
    const gaps = profile.missingSkills.slice(0, 6).map((s) => s.name);
    return {
      answer: gaps.length
        ? `Skills frequently requested for your target roles that are not in your resume:\n\n${gaps.map((g) => `• ${g}`).join(
            '\n',
          )}\n\nThese are inferred from the roles you match, not taken from your document — add any you genuinely have.`
        : 'No significant skill gaps were detected for your current target roles.',
      references: [],
    };
  }

  if (/why.*(match|score|\d+%)/i.test(lower)) {
    const best = context.opportunities[0];
    if (!best) return { answer: 'No matched opportunities are available to explain.', references: [] };
    return {
      answer: `${best.title} scores ${best.score}% because the scoring model combines your skill overlap, qualification match, experience alignment, role relevance, location, source trust and deadline relevance. Open the opportunity page to see the exact breakdown and the calculation.`,
      references: [{ kind: 'opportunity', id: best.id, title: best.title }],
    };
  }

  const summary = [
    `Your profile: ${profile.education[0]?.degree ?? 'no qualification detected'}${
      profile.personal.totalExperienceYears ? `, ${profile.personal.totalExperienceYears} year(s) experience` : ', no dated experience'
    }${profile.personal.location ? `, ${profile.personal.location}` : ''}.`,
    context.opportunities.length ? `I am tracking ${context.opportunities.length} matched opportunities and ${context.exams.length} examinations for you.` : 'No matched opportunities yet — run a search from your dashboard.',
    context.opportunities[0] ? `Highest match right now: ${context.opportunities[0].title} (${context.opportunities[0].score}%).` : '',
    'Ask me things like "Which job should I apply for first?", "What closes this week?" or "What skills am I missing?"',
  ].filter(Boolean);
  if (context.opportunities[0]) references.push({ kind: 'opportunity', id: context.opportunities[0].id, title: context.opportunities[0].title });

  return { answer: summary.join('\n\n'), references };
}

export function compactProfile(profile: CandidateProfileData) {
  return {
    name: profile.personal.name,
    qualification: profile.education.map((e) => `${e.degree}${e.specialization ? ` (${e.specialization})` : ''}${e.graduationYear ? ` ${e.graduationYear}` : ''}`),
    highestDegreeLevel: profile.highestDegreeLevel,
    experienceYears: profile.personal.totalExperienceYears ?? 0,
    careerLevel: profile.careerLevel.name,
    location: profile.personal.location,
    preferredLocations: profile.personal.preferredLocations,
    topSkills: profile.skills.slice(0, 20).map((s) => s.canonical),
    missingSkills: profile.missingSkills.slice(0, 8).map((s) => s.name),
    jobFamilies: profile.jobFamilies.slice(0, 6).map((f) => `${f.name} (${Math.round(f.confidence * 100)}%)`),
    targetRoles: profile.careerPaths.slice(0, 4).map((c) => c.target),
    governmentCategories: profile.governmentCategories.slice(0, 5).map((g) => g.name),
  };
}

// --------------------------------------------------------------------------
// Daily digest
// --------------------------------------------------------------------------

const DigestSchema = z.object({
  headline: z.string().max(300),
  topJobs: z.array(z.string()).max(6).default([]),
  topGovernment: z.array(z.string()).max(6).default([]),
  topExams: z.array(z.string()).max(6).default([]),
  closingSoon: z.array(z.string()).max(6).default([]),
  newlyOpened: z.array(z.string()).max(6).default([]),
  bestMatch: z.object({ title: z.string(), reason: z.string() }),
  oneThingToDoToday: z.string().max(300),
});

export interface Digest {
  headline: string;
  topJobs: string[];
  topGovernment: string[];
  topExams: string[];
  closingSoon: string[];
  newlyOpened: string[];
  bestMatch: { title: string; reason: string; id?: string };
  oneThingToDoToday: string;
  generatedAt: string;
  provider: string;
  records: { jobs: any[]; government: any[]; exams: any[] };
}

export async function buildDigest(userId: string, profile: CandidateProfileData): Promise<Digest> {
  const now = new Date();
  const [jobs, government, exams, closing, opened] = await Promise.all([
    db.query<any>(
      `SELECT id, title, organization, final_score, application_deadline, application_start, salary, verification_status
         FROM opportunities WHERE is_active = 1 AND type IN ('job','internship','apprenticeship','graduate_job','contract')
        ORDER BY final_score DESC LIMIT 5`,
    ),
    db.query<any>(
      `SELECT id, title, organization, final_score, application_deadline, application_start, verification_status
         FROM opportunities WHERE is_active = 1 AND type IN ('government_job','exam')
        ORDER BY final_score DESC LIMIT 5`,
    ),
    db.query<any>(
      `SELECT id, exam_name, organization, status, application_deadline, application_start, exam_date, vacancies
         FROM government_exams WHERE is_active = 1
        ORDER BY CASE status WHEN 'applications_open' THEN 0 WHEN 'closing_soon' THEN 1 WHEN 'notification_expected' THEN 2 ELSE 3 END LIMIT 5`,
    ),
    db.query<any>(
      `SELECT id, title, organization, application_deadline FROM opportunities
        WHERE is_active = 1 AND application_deadline IS NOT NULL AND application_deadline >= ? AND application_deadline <= ?
        ORDER BY application_deadline ASC LIMIT 5`,
      [now.toISOString(), new Date(now.getTime() + 7 * 86_400_000).toISOString()],
    ),
    db.query<any>(
      `SELECT id, title, organization, first_discovered FROM opportunities
        WHERE is_active = 1 AND first_discovered >= ? ORDER BY first_discovered DESC LIMIT 5`,
      [new Date(now.getTime() - 3 * 86_400_000).toISOString()],
    ),
  ]);

  const line = (row: any, extra = '') => {
    const deadline = describeDeadline(row.application_deadline, row.application_start);
    return `${row.title}${row.organization ? ` — ${row.organization}` : ''} · ${deadline.cta}${extra}`;
  };

  const outcome = await runAi<{
    headline: string;
    topJobs: string[];
    topGovernment: string[];
    topExams: string[];
    closingSoon: string[];
    newlyOpened: string[];
    bestMatch: { title: string; reason: string };
    oneThingToDoToday: string;
  }>({
    task: 'digest',
    system: DIGEST_SYSTEM,
    input: {
      candidate: compactProfile(profile),
      today: now.toISOString(),
      jobs: jobs.map((row: any) => line(row, ` · match ${Math.round(Number(row.final_score))}%`)),
      government: government.map((row: any) => line(row)),
      exams: exams.map((row: any) => `${row.exam_name} (${row.organization}) — ${row.status.replace(/_/g, ' ')} · ${describeDeadline(row.application_deadline, row.application_start).cta}`),
      closingSoon: closing.map((row: any) => line(row)),
      newlyOpened: opened.map((row: any) => `${row.title}${row.organization ? ` — ${row.organization}` : ''}`),
    },
    schema: DigestSchema,
    fallback: () => ({
      headline: `${jobs.length + government.length + exams.length} opportunities tracked for you today.`,
      topJobs: jobs.map((row: any) => line(row, ` · match ${Math.round(Number(row.final_score))}%`)),
      topGovernment: government.map((row: any) => line(row)),
      topExams: exams.map((row: any) => `${row.exam_name} (${row.organization}) — ${row.status.replace(/_/g, ' ')}`),
      closingSoon: closing.map((row: any) => line(row)),
      newlyOpened: opened.map((row: any) => `${row.title}${row.organization ? ` — ${row.organization}` : ''}`),
      bestMatch: jobs[0]
        ? { title: jobs[0].title, reason: `Highest match at ${Math.round(Number(jobs[0].final_score))}%.` }
        : { title: 'No matched jobs yet', reason: 'Upload a resume and run a search to get matches.' },
      oneThingToDoToday: closing[0]
        ? `Apply to ${closing[0].title} — it closes ${describeDeadline(closing[0].application_deadline, null).formatted}.`
        : jobs[0]
          ? `Start your application for ${jobs[0].title}.`
          : 'Upload or refresh your resume so the search engine has an accurate profile.',
    }),
    maxTokens: 1200,
    temperature: 0.3,
    userId,
  });

  return {
    ...outcome.data,
    generatedAt: now.toISOString(),
    provider: outcome.provider,
    records: { jobs, government, exams },
  };
}

// --------------------------------------------------------------------------
// Career roadmap
// --------------------------------------------------------------------------

const RoadmapSchema = z.object({
  targetRole: z.string(),
  rationale: z.string(),
  requiredSkills: z.array(z.string()).max(20).default([]),
  gapSkills: z.array(z.string()).max(20).default([]),
  courses: z.array(z.object({ title: z.string(), provider: z.string(), reason: z.string() })).max(10).default([]),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string(), reason: z.string() })).max(10).default([]),
  targetJobs: z.array(z.string()).max(10).default([]),
  governmentExams: z.array(z.string()).max(10).default([]),
  applicationStrategy: z.array(z.string()).max(10).default([]),
  nextStep: z.string(),
  timelineWeeks: z.number().min(1).max(156).default(12),
});

export async function buildRoadmap(userId: string, profile: CandidateProfileData) {
  const topFamily = profile.jobFamilies[0]?.name ?? 'your target field';
  const upskill = FAMILY_UPSKILL[topFamily] ?? [];
  const target = profile.careerPaths[0]?.target ?? `${topFamily} professional`;

  const outcome = await runAi<z.infer<typeof RoadmapSchema>>({
    task: 'roadmap',
    system: ROADMAP_SYSTEM,
    input: {
      candidate: compactProfile(profile),
      topFamily,
      careerPaths: profile.careerPaths,
      strongestSkills: profile.strongestSkills,
      missingSkills: profile.missingSkills.map((s) => s.name),
      governmentCategories: profile.governmentCategories.map((g) => g.name),
      examCategories: profile.examCategories.map((e) => e.name),
      certificationsHeld: profile.certifications.map((c) => c.name),
    },
    schema: RoadmapSchema,
    fallback: () => deterministicRoadmap(profile, target, topFamily, upskill),
    maxTokens: 1600,
    temperature: 0.3,
    userId,
  });

  const examSuggestions = (await db.query<any>(
    `SELECT exam_name, organization, status FROM government_exams WHERE is_active = 1 LIMIT 12`,
  )).map((row: any) => `${row.exam_name} (${row.organization})`);

  return { ...outcome.data, provider: outcome.provider, usedFallback: outcome.usedFallback, examSuggestions };
}

function deterministicRoadmap(
  profile: CandidateProfileData,
  target: string,
  topFamily: string,
  upskill: { skill: string; course: string; certification: string }[],
): z.infer<typeof RoadmapSchema> {
  const gaps = profile.missingSkills.slice(0, 5).map((s) => s.name);
  const relevantUpskill = upskill.filter((u) => gaps.includes(u.skill));
  const courses = (relevantUpskill.length ? relevantUpskill : upskill).slice(0, 3).map((u) => ({
    title: u.course,
    provider: 'Self-paced (Coursera / Udemy / provider of your choice)',
    reason: `Closes the ${u.skill} gap requested by ${topFamily} roles.`,
  }));
  const certifications = (relevantUpskill.length ? relevantUpskill : upskill).slice(0, 3).map((u) => ({
    name: u.certification,
    issuer: 'Issuing body',
    reason: `Recognised credential that evidences ${u.skill}.`,
  }));

  return {
    targetRole: target,
    rationale: `Your strongest alignment is with ${topFamily} (${Math.round((profile.jobFamilies[0]?.confidence ?? 0) * 100)}% confidence) based on ${
      profile.strongestSkills.slice(0, 3).join(', ') || 'your qualification'
    }.`,
    requiredSkills: profile.careerPaths[0]?.requiredSkills ?? [],
    gapSkills: gaps,
    courses: courses.length ? courses : [{ title: 'Targeted upskilling in your strongest job family', provider: 'Self-paced', reason: 'No specific gap detected yet.' }],
    certifications,
    targetJobs: profile.careerPaths.slice(0, 4).map((p) => p.target),
    governmentExams: profile.examCategories.slice(0, 4).map((e) => e.name),
    applicationStrategy: [
      profile.careerLevel.name === 'fresher'
        ? 'Prioritise fresher-friendly and graduate-trainee roles; apply broadly in the first two weeks.'
        : 'Target roles matching your current experience band first, then stretch one level up.',
      'Apply to any government examination whose notification is currently open — deadlines are unforgiving.',
      `Close the ${gaps.slice(0, 2).join(' and ') || 'top'} skill gap(s) before the next application round.`,
      'Track every application in the tracker so nothing is submitted twice or forgotten.',
    ],
    nextStep: gaps.length
      ? `Improve ${gaps[0]}${gaps[1] ? ` and ${gaps[1]}` : ''}, then apply for ${target} roles.`
      : `Apply for ${target} roles now — your profile already covers the core requirements.`,
    timelineWeeks: gaps.length ? 8 : 3,
  };
}

// --------------------------------------------------------------------------
// Resume optimiser
// --------------------------------------------------------------------------

const OptimizerSchema = z.object({
  score: z.number().min(0).max(100),
  atsScore: z.number().min(0).max(100),
  missingKeywords: z.array(z.string()).max(20).default([]),
  missingSkills: z.array(z.string()).max(20).default([]),
  experienceAlignment: z.string(),
  suggestedBullets: z.array(z.string()).max(10).default([]),
  keywordCoverage: z.number().min(0).max(1).default(0),
  verdict: z.string(),
});

export async function optimiseResume(userId: string, profile: CandidateProfileData, resumeText: string, job: { title: string; description: string; skills: string[]; qualification: string[]; experienceRequired: string }) {
  const requiredKeywords = extractKeywords(`${job.title} ${job.description} ${job.skills.join(' ')}`);
  const resumeLower = resumeText.toLowerCase();
  const missingKeywords = requiredKeywords.filter((keyword) => !resumeLower.includes(keyword.toLowerCase()));
  const coverage = requiredKeywords.length ? 1 - missingKeywords.length / requiredKeywords.length : 0;

  const atsScore = Math.round(
    Math.min(
      100,
      coverage * 55 +
        (/\b(achievement|achieved|improved|increased|reduced)\b/i.test(resumeText) ? 12 : 0) +
        (resumeText.length > 1200 ? 10 : 4) +
        (/[•\-*]\s/.test(resumeText) ? 8 : 0) +
        (/\b(20\d{2}|19\d{2})\b/.test(resumeText) ? 8 : 0) +
        (/\d+%|\d+\.\d+%|₹\s?\d/.test(resumeText) ? 7 : 0),
    ),
  );

  const outcome = await runAi<z.infer<typeof OptimizerSchema>>({
    task: 'resume_optimization',
    system: RESUME_OPTIMIZER_SYSTEM,
    input: {
      candidate: compactProfile(profile),
      resumeExcerpt: resumeText.slice(0, 6000),
      job,
      computed: { missingKeywords: missingKeywords.slice(0, 20), keywordCoverage: Number(coverage.toFixed(2)), atsScore },
    },
    schema: OptimizerSchema,
    fallback: () => ({
      score: Math.round(coverage * 100),
      atsScore,
      missingKeywords: missingKeywords.slice(0, 20),
      missingSkills: job.skills.filter((skill) => !resumeLower.includes(skill.toLowerCase())).slice(0, 12),
      experienceAlignment: job.experienceRequired
        ? `The role asks for ${job.experienceRequired}. Your resume shows ${profile.personal.totalExperienceYears ?? 0} year(s).`
        : 'The role does not state an experience requirement.',
      suggestedBullets: buildSuggestedBullets(profile, missingKeywords.slice(0, 4)),
      keywordCoverage: Number(coverage.toFixed(2)),
      verdict:
        coverage >= 0.7
          ? 'Strong keyword coverage — tighten the wording and submit.'
          : coverage >= 0.4
            ? 'Partial coverage — add the missing keywords you genuinely have experience with.'
            : 'Low coverage — this role may not be the best fit, or your resume needs substantial retargeting.',
    }),
    maxTokens: 1400,
    temperature: 0.3,
    userId,
  });

  return { ...outcome.data, provider: outcome.provider, usedFallback: outcome.usedFallback, requiredKeywords };
}

function buildSuggestedBullets(profile: CandidateProfileData, keywords: string[]): string[] {
  const bullets: string[] = [];
  const recent = profile.experience[0];
  if (recent && keywords[0]) {
    bullets.push(`Reframe your ${recent.jobTitle} role around ${keywords[0]} — describe the task, the tool and the measurable outcome.`);
  }
  if (keywords[1]) bullets.push(`Add a bullet that names ${keywords[1]} explicitly; ATS parsers match the exact term.`);
  if (profile.projects[0]) bullets.push(`Move "${profile.projects[0].title}" into your experience section with quantified results.`);
  bullets.push('Replace duty statements ("responsible for…") with achievement statements that start with a verb and end with a number.');
  bullets.push('Mirror the job title in your professional headline so the match is unambiguous.');
  return bullets.filter(Boolean).slice(0, 6);
}

function extractKeywords(text: string): string[] {
  const stop = new Set([
    'the','and','for','with','you','your','our','are','will','have','has','this','that','from','about','into','their','they','was','were','all','can','must','should','who','whom','what','when','where','which','than','then','also','more','most','other','such','only','just','very','any','some','job','role','work','team','company','candidate','applicant','responsibilities','requirements','description','years','year','experience','minimum','preferred','good','strong','excellent','ability','knowledge','understanding','familiar','well','including','including','etc','per','month','year','salary','location','apply','now','please','note','kindly','looking','join','us','we','is','of','to','in','on','at','by','as','be','it','an','a','or','if','do','does','not','no','so','up','out','over','under','between','within','across','during','after','before','while','both','each','every','own','same','new','one','two','three',
  ]);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word));
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word]) => word);
}

export { jsonDecode, relativeTime, describeDeadline };
