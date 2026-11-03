import { z } from 'zod';
import { runAi } from '@/lib/ai';
import { MATCH_EXPLANATION_SYSTEM } from '@/lib/ai/prompts';
import type { CandidateProfileData } from '@/lib/analysis/profiler';
import type { MatchResult, MatchableRecord } from './matcher';

/**
 * "Why this matches you" generator.
 *
 * The deterministic composer builds the explanation from the same facts the matcher used,
 * so the narrative can never contradict the score. The LLM path rewrites it for fluency but
 * is validated against the same schema and falls back to the composer on any failure.
 */

export interface Explanation {
  summary: string;
  strengths: string[];
  gaps: string[];
  action: string;
  provider: string;
}

type ExplanationPayload = Omit<Explanation, 'provider'>;

const ExplanationSchema = z.object({
  summary: z.string().min(20).max(900),
  strengths: z.array(z.string().max(140)).max(8),
  gaps: z.array(z.string().max(140)).max(8),
  action: z.string().max(300),
});

export async function explainMatch(
  profile: CandidateProfileData,
  record: MatchableRecord,
  match: MatchResult,
  userId?: string | null,
): Promise<Explanation> {
  const deterministic = composeExplanation(profile, record, match);
  const outcome = await runAi<ExplanationPayload>({
    task: 'match_explanation',
    system: MATCH_EXPLANATION_SYSTEM,
    input: {
      candidate: {
        qualification: profile.education.map((e) => `${e.degree}${e.specialization ? ` in ${e.specialization}` : ''}`),
        experienceYears: profile.personal.totalExperienceYears ?? 0,
        location: profile.personal.location ?? null,
        topSkills: profile.skills.slice(0, 12).map((s) => s.canonical),
        careerLevel: profile.careerLevel.name,
        targetRoles: profile.careerPaths.slice(0, 3).map((p) => p.target),
        projects: profile.projects.slice(0, 3).map((p) => p.title),
      },
      opportunity: {
        title: record.title,
        organization: record.organization ?? '',
        requiredSkills: record.skills ?? [],
        qualification: record.qualification ?? [],
        experienceRequired: record.experienceRequired ?? '',
        locations: record.locations ?? [],
      },
      computedMatch: {
        overall: match.overall,
        breakdown: match.breakdown,
        matchedSkills: match.matchedSkills,
        missingSkills: match.missingSkills,
        eligibilityBlockers: match.reasons.filter((r) => r.startsWith('✗')),
      },
    },
    schema: ExplanationSchema,
    fallback: () => deterministic,
    maxTokens: 700,
    temperature: 0.3,
    userId,
  });
  return { ...outcome.data, provider: outcome.provider };
}

export function composeExplanation(
  profile: CandidateProfileData,
  record: MatchableRecord,
  match: MatchResult,
): Explanation {
  const qualification = profile.education[0];
  const qualificationText = qualification
    ? `${qualification.degree}${qualification.specialization ? ` ${qualification.specialization}` : ''} background`
    : 'your qualification';

  const parts: string[] = [];
  if (qualification) parts.push(`Your ${qualificationText}`);
  if (match.matchedSkills.length) {
    parts.push(
      match.matchedSkills.length >= 3
        ? `${match.matchedSkills.slice(0, 3).join(', ')} and related skills`
        : match.matchedSkills.join(' and '),
    );
  }
  const relevantProject = profile.projects.find((project) =>
    project.technologies.some((tech) => match.matchedSkills.includes(tech)),
  );
  if (relevantProject) parts.push(`your ${relevantProject.title} project`);
  const relevantCertification = profile.certifications.find((cert) =>
    cert.skills.some((skill) => match.matchedSkills.includes(skill)),
  );
  if (relevantCertification) parts.push(`your ${relevantCertification.name} certification`);
  const experienceYears = profile.personal.totalExperienceYears ?? 0;
  if (experienceYears > 0 && match.breakdown.experience >= 80) parts.push(`${experienceYears} year(s) of relevant experience`);

  const summary = parts.length
    ? `${capitalise(parts.join(', '))} closely match${parts.length === 1 ? 'es' : ''} what ${record.organization ? record.organization : 'this role'} is asking for in "${record.title}". Overall AI match: ${match.overall}%.`
    : `This role overlaps with your profile at ${match.overall}%, mainly through your ${qualificationText}.`;

  const strengths: string[] = [];
  if (match.breakdown.education >= 85) {
    strengths.push(qualification ? `${qualification.degree}${qualification.specialization ? ` (${qualification.specialization})` : ''} meets the qualification requirement` : 'Qualification requirement met');
  }
  for (const skill of match.matchedSkills.slice(0, 5)) strengths.push(skill);
  if (match.breakdown.location >= 85 && record.locations?.length) strengths.push(`Location matches your preference (${record.locations[0]})`);
  if (match.breakdown.experience >= 85 && experienceYears > 0) strengths.push(`${experienceYears} year(s) of experience aligns with the requirement`);
  if (match.breakdown.role >= 85) strengths.push(`Role aligns with your ${profile.careerPaths[0]?.target ?? 'target'} career path`);

  const gaps: string[] = [];
  for (const skill of match.missingSkills.slice(0, 4)) {
    gaps.push(`${skill} ${record.skills?.includes(skill) ? 'is requested but not found in your resume' : 'would strengthen this application'}`);
  }
  if (match.breakdown.experience < 60 && record.experienceRequired) gaps.push(`${record.experienceRequired} preferred; your resume shows ${experienceYears} year(s)`);
  if (match.eligible === 'probably_eligible') gaps.push('Some eligibility details could not be confirmed from the resume — check the official notification.');

  const action =
    match.eligible === 'not_eligible'
      ? 'Do not apply — a stated requirement is not met. See the eligibility blockers above.'
      : match.overall >= 85
        ? 'Strong fit — apply and reference your matching skills in the first two lines of your CV.'
        : match.overall >= 70
          ? 'Good fit — worth applying, but address the listed gaps in your cover note.'
          : 'Possible fit — apply only if you are willing to close the listed skill gaps first.';

  return {
    summary,
    strengths: strengths.length ? strengths : ['General qualification alignment'],
    gaps,
    action,
    provider: 'heuristic-local',
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
