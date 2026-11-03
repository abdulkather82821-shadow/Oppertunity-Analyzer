'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, FileText, Landmark, Loader2, Sparkles, Target, Upload, X } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, ConfidenceChip, DeadlineBadge, EligibilityBadge, EmptyState, MatchBandBadge, ScoreBar, SectionHeading, Spinner, SourceBadge, TrustBadge } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';
import { STEP_LABELS } from '@/lib/pipeline/steps';

const STEP_ORDER = STEP_LABELS.map((step) => step.key);
const STEP_LABEL = new Map(STEP_LABELS.map((step) => [step.key, step.label]));

interface StepState {
  step: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  detail?: string;
  at?: string;
}

/** A step exactly as the API reports it (`search_jobs.steps`): identified by `key`, not `step`. */
interface ApiStep {
  key: string;
  label?: string;
  status: StepState['status'];
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

interface ProfileResponse {
  profile: {
    careerLevel: { name: string; confidence: number; source: string; rationale: string };
    jobFamilies: { name: string; confidence: number; source: string; rationale: string }[];
    strongestSkills: { name: string; confidence: number; source: string; rationale: string }[];
    missingSkills: { name: string; confidence: number; source: string; rationale: string }[];
    careerPaths: { target: string; confidence: number; source: string; rationale: string }[];
    governmentCategories: { name: string; confidence: number; source: string; rationale: string }[];
    examCategories: { name: string; confidence: number; source: string; rationale: string }[];
  };
  education: { degree: string; institution: string; graduationYear: number | null; specialization: string | null }[];
  experiences: { company: string; jobTitle: string; startDate: string | null }[];
  skills: { name: string; canonical: string; category: string; confidence: number; source?: string }[];
  certifications: { name: string; issuer?: string | null }[];
  projects: { title: string }[];
  resume: { id: string; original_name: string; size_bytes: number; parse_status: string; created_at: string };
  warnings: { field: string; code: string; message: string }[];
  analysisProvider: string;
  analysisFallbackUsed: number;
}

interface SearchResponse {
  searchJobId: string;
  status: string;
  progress: number;
  steps: ApiStep[];
  found: number;
  stored: number;
  matched?: number;
  duplicates: number;
  conflicts: number;
  queries: string[];
  providers: string[];
  error: string | null;
}

interface MatchSummary {
  id: string;
  title: string;
  organization: string;
  type: string;
  category: string;
  locationSummary: string;
  matchScore: number;
  finalScore: number;
  band: string;
  bandLabel: string;
  deadlineDays: number | null;
  deadlineLabel: string;
  deadlineCta: string;
  deadlineFormatted: string;
  eligibilityStatus: string;
  eligibilityReason: string;
  verificationStatus: string;
  trustScore: number;
  officialSource: string | null;
  explanation: string;
  strengths: string[];
  gaps: string[];
  skills: string[];
  experienceLevel: string;
  sourceKind: string;
  sourceTier: number | null;
  examStatus: string | null;
  isGovernment: boolean;
}

function AnalyzeInner() {
  const params = useSearchParams();
  const [steps, setSteps] = useState<StepState[]>(() => STEP_ORDER.map((step) => ({ step, status: 'pending' })));
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [stats, setStats] = useState<{ opportunities: number; exams: number } | null>(null);
  const [phase, setPhase] = useState<'loading' | 'profiling' | 'searching' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [searchJobId, setSearchJobId] = useState<string | null>(params.get('jobId'));
  const started = useRef(false);

  const applySteps = useCallback((incoming: (ApiStep | StepState)[] | undefined | null) => {
    if (!incoming?.length) return;
    // The server identifies a step by `key`; the local placeholders use `step`. Matching only on
    // `step` left every server-reported step "pending" for ever, however far the run had got.
    const normalised: StepState[] = incoming.map((entry) =>
      'key' in entry
        ? { step: entry.key, status: entry.status, detail: entry.detail, at: entry.finishedAt ?? entry.startedAt }
        : entry,
    );
    setSteps(STEP_ORDER.map((step) => normalised.find((entry) => entry.step === step) ?? { step, status: 'pending' as const }));
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        setPhase('profiling');
        applySteps(STEP_ORDER.map((step) => ({ step, status: 'pending' as const })));

        // 1. Profile must exist before anything can be searched against.
        const profileData = await api.get<ProfileResponse>('/api/profile');
        setProfile(profileData);
        applySteps(
          STEP_ORDER.map((step) => ({
            step,
            status: ['resume_uploaded', 'extracting_text', 'understanding_education', 'identifying_skills', 'analysing_experience', 'building_profile'].includes(step)
              ? ('done' as const)
              : ('pending' as const),
          })),
        );

        // 2. If a job id arrived in the URL we are resuming a run that is already in flight.
        let job: SearchResponse | null = null;
        if (searchJobId) {
          job = await poll(searchJobId, applySteps);
        } else {
          setPhase('searching');
          // Start in the background and follow the job's own step log: each step shows the status
          // the server actually recorded, at the moment it is recorded.
          const started = await api.post<{ searchJobId: string }>('/api/search/run', { maxQueries: 18, background: true });
          setSearchJobId(started.searchJobId);
          job = await poll(started.searchJobId, applySteps);
        }
        setSearch(job);
        applySteps(job.steps);

        // 3. Load the ranked results for this profile.
        const [result, counts] = await Promise.all([
          api.get<{ opportunities: MatchSummary[]; total: number }>('/api/opportunities?limit=20&sort=best_match'),
          api.get<{ opportunities: number; exams: number }>('/api/stats'),
        ]);
        setMatches(result.opportunities);
        setStats(counts);
        setPhase('done');
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'Analysis failed.');
        setPhase('error');
      }
    })();
  }, [applySteps, searchJobId]);

  const completed = steps.filter((step) => step.status === 'done').length;
  const progress = Math.round((completed / STEP_ORDER.length) * 100);

  return (
    <AppShell>
      <PageHeader
        title="Analysing your profile"
        subtitle="Every step below reports its own real status. Nothing is marked complete until it actually finished."
        actions={
          phase === 'done' ? (
            <>
              <Link href="/dashboard" className="btn-primary">
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/jobs" className="btn-secondary">
                Browse all jobs
              </Link>
            </>
          ) : null
        }
      />

      {error ? (
        <Card className="card-pad mb-5 border-red-200 bg-red-50">
          <p className="flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
          <Link href="/upload" className="btn-secondary mt-3">
            <Upload className="h-4 w-4" /> Upload a resume
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-5">
          <Card className="card-pad">
            <SectionHeading icon={Sparkles} title="Analysis progress" subtitle={phase === 'done' ? 'Pipeline complete' : `${progress}% complete`} />
            <div className="bar-track mb-4">
              <div className="bar-fill bg-brand-600" style={{ width: `${progress}%` }} />
            </div>
            <ol className="space-y-1.5">
              {steps.map((entry) => (
                <li key={entry.step} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 shrink-0">
                    {entry.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : entry.status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                    ) : entry.status === 'failed' ? (
                      <X className="h-4 w-4 text-red-500" />
                    ) : entry.status === 'skipped' ? (
                      <CircleDashed className="h-4 w-4 text-ink-300" />
                    ) : (
                      <CircleDashed className="h-4 w-4 text-ink-300" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className={clsx('leading-tight', entry.status === 'pending' ? 'text-ink-400' : 'text-ink-800')}>
                      {STEP_LABEL.get(entry.step) ?? entry.step}
                    </p>
                    {entry.detail ? <p className="mt-0.5 text-xs text-ink-500">{entry.detail}</p> : null}
                  </div>
                  {entry.status === 'skipped' ? <Badge tone="muted" className="ml-auto">skipped</Badge> : null}
                </li>
              ))}
            </ol>

            {search ? (
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-ink-100 pt-4 text-sm sm:grid-cols-5">
                {[
                  { label: 'Found', value: search.found },
                  { label: 'New / updated', value: search.stored },
                  { label: 'Already known', value: search.matched ?? 0 },
                  { label: 'Merged dupes', value: search.duplicates },
                  { label: 'Conflicts', value: search.conflicts },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-xs uppercase tracking-wide text-ink-500">{item.label}</p>
                    <p className="text-lg font-semibold tabular-nums text-ink-900">{item.value}</p>
                  </div>
                ))}
              </div>
            ) : null}

            {search?.error ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {search.error}
              </p>
            ) : null}
          </Card>

          {profile?.warnings.length ? (
            <Card className="card-pad">
              <SectionHeading icon={AlertTriangle} title="What we could not read" subtitle="Reported rather than guessed" />
              <ul className="space-y-2">
                {profile.warnings.map((warning, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-ink-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>
                      <span className="font-medium">{warning.field}:</span> {warning.message}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {profile ? (
            <Card className="card-pad">
              <SectionHeading
                icon={FileText}
                title="Your AI career profile"
                subtitle={
                  profile.analysisFallbackUsed
                    ? `Built with ${profile.analysisProvider} — heuristic fallback in use, so confidence reflects pattern matching only.`
                    : `Built with ${profile.analysisProvider}`
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="label">Career level</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium capitalize text-ink-900">{profile.profile.careerLevel.name.replace(/_/g, ' ')}</span>
                    <ConfidenceChip confidence={profile.profile.careerLevel.confidence} source={profile.profile.careerLevel.source} rationale={profile.profile.careerLevel.rationale} />
                  </div>
                </div>
                <div>
                  <p className="label">Highest qualification</p>
                  <p className="text-sm text-ink-900">
                    {profile.education[0]?.degree ?? 'Unknown'}
                    {profile.education[0]?.graduationYear ? ` · ${profile.education[0].graduationYear}` : ''}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="label">Best-fit job families</p>
                  <div className="flex flex-wrap gap-2">
                    {profile.profile.jobFamilies.slice(0, 6).map((family) => (
                      <span key={family.name} className="inline-flex items-center gap-1.5">
                        <Badge tone="brand">{family.name.replace(/_/g, ' ')}</Badge>
                        <ConfidenceChip confidence={family.confidence} source={family.source} rationale={family.rationale} />
                      </span>
                    ))}
                    {profile.profile.jobFamilies.length === 0 ? <span className="muted text-sm">No job family could be inferred.</span> : null}
                  </div>
                </div>
                <div>
                  <p className="label">Strongest skills</p>
                  <ul className="space-y-1.5">
                    {profile.profile.strongestSkills.slice(0, 8).map((skill) => (
                      <li key={skill.name} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-ink-800">{skill.name}</span>
                        <ConfidenceChip confidence={skill.confidence} source={skill.source} rationale={skill.rationale} />
                      </li>
                    ))}
                    {profile.profile.strongestSkills.length === 0 ? <li className="muted text-sm">No skills detected on the resume.</li> : null}
                  </ul>
                </div>
                <div>
                  <p className="label">Missing for your target roles</p>
                  <ul className="space-y-1.5">
                    {profile.profile.missingSkills.slice(0, 8).map((skill) => (
                      <li key={skill.name} className="text-sm text-ink-800">
                        {skill.name}
                      </li>
                    ))}
                    {profile.profile.missingSkills.length === 0 ? <li className="muted text-sm">No significant gaps detected.</li> : null}
                  </ul>
                  <Link href="/skills" className="link mt-2 inline-block text-xs">
                    View full skill gap analysis
                  </Link>
                </div>
              </div>

              <div className="mt-4 border-t border-ink-100 pt-4">
                <p className="label">Government categories worth watching</p>
                <div className="flex flex-wrap gap-2">
                  {profile.profile.governmentCategories.slice(0, 8).map((category) => (
                    <Badge key={category.name} tone="neutral">
                      {category.name.replace(/_/g, ' ')} · {Math.round(category.confidence * 100)}%
                    </Badge>
                  ))}
                  {profile.profile.governmentCategories.length === 0 ? <span className="muted text-sm">None inferred.</span> : null}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="card-pad">
              <Spinner label="Building your profile…" />
            </Card>
          )}

          <Card className="card-pad">
            <SectionHeading
              icon={Target}
              title="⭐ Your perfect opportunities"
              subtitle={matches.length ? `${matches.length} ranked matches from ${search?.found ?? 0} opportunities found` : undefined}
              action={<Link href="/jobs" className="btn-secondary btn-sm">See all</Link>}
            />
            {phase !== 'done' && matches.length === 0 ? (
              <Spinner label="Matching opportunities against your profile…" />
            ) : matches.length === 0 ? (
              <EmptyState
                icon={Target}
                title="No matches yet"
                description="We could not find opportunities matching this profile right now. Check the search providers in Settings, or broaden your location preferences."
                action={
                  <Link href="/settings" className="btn-secondary mt-1">
                    Open settings
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-3">
                {matches.slice(0, 6).map((match) => (
                  <li key={match.id} className="rounded-lg border border-ink-200 p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link href={match.isGovernment ? `/exam/${match.id}` : `/opportunity/${match.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-700">
                          {match.title}
                        </Link>
                        <p className="muted mt-0.5 truncate text-xs">
                          {match.organization}
                          {match.locationSummary ? ` · ${match.locationSummary}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-base font-semibold tabular-nums text-ink-900">{Math.round(match.finalScore)}%</span>
                        <MatchBandBadge band={match.band} label={match.bandLabel} />
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <EligibilityBadge status={match.eligibilityStatus} reason={match.eligibilityReason} />
                      <DeadlineBadge daysRemaining={match.deadlineDays} cta={match.deadlineCta} formatted={match.deadlineFormatted} />
                      <TrustBadge score={match.trustScore} status={match.verificationStatus} official={Boolean(match.officialSource)} />
                      <SourceBadge kind={match.sourceKind} tier={match.sourceTier ?? undefined} />
                      {match.experienceLevel ? <Badge tone="muted">{match.experienceLevel}</Badge> : null}
                      {match.isGovernment && match.examStatus ? <Badge tone="info">{match.examStatus.replace(/_/g, ' ')}</Badge> : null}
                    </div>
                    {match.explanation ? <p className="muted mt-2 text-xs leading-relaxed">{match.explanation}</p> : null}
                    {match.gaps.length ? (
                      <p className="mt-1.5 text-xs text-amber-700">Gaps: {match.gaps.join(', ')}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {search?.queries.length ? (
            <Card className="card-pad">
              <SectionHeading icon={Landmark} title="Search queries generated from your resume" subtitle={`Not hard-coded — built from your skills, qualifications and locations${search.providers?.length ? ` · searched via ${search.providers.join(', ')}` : ''}`} />
              <ul className="grid gap-2 sm:grid-cols-2">
                {search.queries.slice(0, 18).map((query, index) => (
                  <li key={index} className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-700">
                    <span className="font-medium">{query}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {stats ? (
            <Card className="card-pad">
              <SectionHeading icon={CheckCircle2} title="Database summary" />
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="label">Opportunities</p>
                  <p className="text-xl font-semibold tabular-nums text-ink-900">{stats.opportunities}</p>
                </div>
                <div>
                  <p className="label">Government exams</p>
                  <p className="text-xl font-semibold tabular-nums text-ink-900">{stats.exams}</p>
                </div>
              </div>
              <div className="mt-3">
                <ScoreBar score={progress} label="Pipeline completion" />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

/**
 * Polls a running search job until it finishes. The step list is replaced wholesale on every
 * tick so a step can never appear complete before the server reports it.
 */
async function poll(jobId: string, applySteps: (steps: ApiStep[]) => void): Promise<SearchResponse> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = await api.get<SearchResponse>(`/api/search/status/${jobId}`);
    applySteps(status.steps);
    if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') return status;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  const final = await api.get<SearchResponse>(`/api/search/status/${jobId}`);
  return { ...final, error: final.error ?? 'Search did not finish within the allotted time.' };
}

export default function AnalyzePage() {
  return (
    <Suspense>
      <AnalyzeInner />
    </Suspense>
  );
}
