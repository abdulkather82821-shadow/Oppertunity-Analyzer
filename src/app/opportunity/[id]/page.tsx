'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Bookmark, Briefcase, CheckCircle2, ExternalLink, FileText, Landmark, ShieldAlert, Sparkles, Target } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import {
  Badge,
  Card,
  ConflictBanner,
  DeadlineBadge,
  Disclaimer,
  EligibilityBadge,
  MatchBandBadge,
  ScoreBar,
  SectionHeading,
  Spinner,
  SourceBadge,
  StatusBadge,
  TrustBadge,
} from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

export default function OpportunityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tracked, setTracked] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/opportunity/${params.id}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load this opportunity.'))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    api.get<{ saved: { id: string }[] }>('/api/saved').then((res) => setSaved(res.saved.some((item) => item.id === params.id))).catch(() => undefined);
  }, [params.id]);

  const toggleSave = async () => {
    if (saved) {
      await api.delete(`/api/saved?id=${params.id}`);
      setSaved(false);
    } else {
      await api.post('/api/saved', { opportunityId: params.id });
      setSaved(true);
    }
  };

  const track = async (status = 'to_apply') => {
    const result = await api.post<{ application: { id: string; status: string } }>('/api/applications', {
      opportunityId: params.id,
      title: data?.opportunity?.title ?? '',
      organization: data?.opportunity?.organization ?? '',
      status,
      appliedAt: status === 'applied' ? new Date().toISOString() : null,
    });
    setTracked(result.application.status);
    router.refresh();
  };

  const sendFeedback = async (verdict: string) => {
    await api.post('/api/feedback', { opportunityId: params.id, verdict });
    setFeedbackSent(verdict);
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (error || !data?.opportunity) {
    return (
      <AppShell>
        <PageHeader title="Opportunity not found" />
        <Card className="card-pad">
          <p className="text-sm text-ink-700">{error ?? 'This opportunity is no longer available.'}</p>
          <Link href="/jobs" className="btn-primary mt-3">
            <ArrowLeft className="h-4 w-4" /> Back to jobs
          </Link>
        </Card>
      </AppShell>
    );
  }

  const o = data.opportunity;
  const exam = data.exam;
  const sources: any[] = data.sources ?? [];
  const duplicates: any[] = data.duplicates ?? [];
  const verification: any[] = data.verification ?? [];
  // Eligibility and overall fit are separate components of the score breakdown; the API sends
  // them in `scoreBreakdown` (0–100), not as a nested `eligibility` object.
  const eligibilityPart = (o.scoreBreakdown ?? []).find((part: any) => part.key === 'eligibility');
  const eligibilityScore: number | null = eligibilityPart ? Math.round(eligibilityPart.score) : null;

  return (
    <AppShell>
      <PageHeader
        title={o.title}
        subtitle={`${o.organization}${o.locationSummary ? ` · ${o.locationSummary}` : ''}`}
        actions={
          <>
            <Link href="/jobs" className="btn-secondary">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
            <button onClick={() => void toggleSave()} className={saved ? 'btn-secondary text-brand-700' : 'btn-secondary'}>
              <Bookmark className="h-4 w-4" /> {saved ? 'Saved' : 'Save'}
            </button>
            {o.applyUrl ? (
              <a href={o.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary">
                {o.deadlineDays !== null && o.deadlineDays < 0 ? 'Application closed' : 'Apply now'}
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : null}
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card className="card-pad">
            <div className="flex flex-wrap items-center gap-1.5">
              <MatchBandBadge band={o.band} label={o.bandLabel} />
              <EligibilityBadge status={o.eligibilityStatus} reason={o.eligibilityReason} />
              <DeadlineBadge daysRemaining={o.deadlineDays} cta={o.deadlineCta} formatted={o.deadlineFormatted} />
              <StatusBadge status={o.status} />
              <TrustBadge score={o.trustScore} status={o.verificationStatus} official={Boolean(o.officialSource)} />
              <SourceBadge kind={o.sourceKind} tier={o.sourceTier ?? undefined} />
              {o.sourceCount > 1 ? <Badge tone="neutral">Found on {o.sourceCount} sources</Badge> : null}
              {o.isDemo ? <Badge tone="muted">demo record</Badge> : null}
            </div>

            <dl className="mt-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Type', o.type?.replace(/_/g, ' ') ?? 'Unknown'],
                ['Category', o.category?.replace(/_/g, ' ') ?? 'Unknown'],
                ['Locations', o.locationSummary || 'Unknown'],
                ['Experience', o.experienceLevel || 'Unknown'],
                ['Vacancies', o.vacancies != null ? o.vacancies.toLocaleString('en-IN') : 'Unknown'],
                ['Salary', o.salaryMin ? `₹${o.salaryMin.toLocaleString('en-IN')}${o.salaryMax ? `–${o.salaryMax.toLocaleString('en-IN')}` : ''}${o.salaryPeriod ? ` / ${o.salaryPeriod}` : ''}` : 'Not published'],
                ['Application opens', o.applicationStart ? new Date(o.applicationStart).toLocaleDateString('en-IN') : 'Unknown'],
                ['Application closes', o.applicationDeadline ? new Date(o.applicationDeadline).toLocaleDateString('en-IN') : 'Unknown'],
                ['Exam date', o.examDate ? new Date(o.examDate).toLocaleDateString('en-IN') : 'Not published'],
                ['Age limit', o.ageMin != null ? `${o.ageMin}–${o.ageMax} years` : 'Not published'],
                ['Application fee', o.applicationFee ?? 'Not published'],
                ['Selection process', (o.selectionProcess ?? []).join(' → ') || 'Not published'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
                  <dd className="mt-0.5 text-ink-900">{value}</dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-ink-500">Qualification</dt>
                <dd className="mt-0.5 text-ink-900">{(o.qualification ?? []).join(', ') || 'Not published'}</dd>
              </div>
            </dl>

            {o.description ? (
              <div className="mt-4 border-t border-ink-100 pt-4">
                <p className="label">Description</p>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{o.description}</p>
              </div>
            ) : (
              <p className="muted mt-4 border-t border-ink-100 pt-4 text-sm">No description was published by the source.</p>
            )}

            {(o.skills ?? []).length ? (
              <div className="mt-4">
                <p className="label">Skills requested</p>
                <div className="flex flex-wrap gap-1.5">
                  {o.skills.map((skill: string) => (
                    <Badge key={skill} tone="neutral">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          {/* Why this job */}
          <Card className="card-pad">
            <SectionHeading icon={Target} title="Why this job?" subtitle="Explainable matching — no black-box score" />
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <div>
                <ScoreBar score={o.finalScore} label="Overall match" />
                <p className="muted mt-2 text-xs">
                  {o.personalised
                    ? `Eligibility ${eligibilityScore ?? '—'}${eligibilityScore === null ? '' : '%'} · Fit ${o.matchScore}%`
                    : 'Upload a resume to see a personal fit score.'}
                </p>
              </div>
              <div className="space-y-3">
                {o.explanation ? <p className="text-sm leading-relaxed text-ink-800">{o.explanation}</p> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="label">Strengths</p>
                    <ul className="space-y-1">
                      {(o.strengths ?? []).map((strength: string) => (
                        <li key={strength} className="flex gap-1.5 text-sm text-ink-700">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          {strength}
                        </li>
                      ))}
                      {(o.strengths ?? []).length === 0 ? <li className="muted text-sm">No specific strengths identified.</li> : null}
                    </ul>
                  </div>
                  <div>
                    <p className="label">Potential gaps</p>
                    <ul className="space-y-1">
                      {(o.gaps ?? []).map((gap: string) => (
                        <li key={gap} className="flex gap-1.5 text-sm text-ink-700">
                          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                          {gap}
                        </li>
                      ))}
                      {(o.gaps ?? []).length === 0 ? <li className="muted text-sm">No gaps detected against the published requirements.</li> : null}
                    </ul>
                  </div>
                </div>
                {(o.scoreBreakdown ?? []).map((component: any) => (
                  <ScoreBar key={component.key} score={component.score} label={`${component.label} · ${(component.contribution * 100).toFixed(1)} pts · ${component.evidence}`} />
                ))}
              </div>
            </div>
          </Card>

          {/* Conflicts */}
          {o.conflicts?.length ? (
            <Card className="card-pad">
              <SectionHeading icon={ShieldAlert} title="Conflicting information" subtitle="Sources disagree — both values are shown" />
              <ConflictBanner conflicts={o.conflicts} />
            </Card>
          ) : null}

          {/* Sources */}
          <Card className="card-pad">
            <SectionHeading icon={Landmark} title="Source transparency" subtitle="Every claim, where it came from, and when it was checked" />
            {sources.length === 0 ? (
              <p className="muted">No source records were stored for this listing.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {sources.map((source) => (
                  <li key={source.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a href={source.url} target="_blank" rel="noreferrer noopener" className="link text-sm">
                        {source.title || new URL(source.url).hostname}
                      </a>
                      <div className="flex items-center gap-1.5">
                        <SourceBadge kind={source.sourceKind} tier={source.tier ?? undefined} />
                        {source.isOfficial ? <Badge tone="success">official</Badge> : null}
                        {source.claims.length ? <Badge tone="neutral">{source.claims.length} claim(s)</Badge> : null}
                      </div>
                    </div>
                    <p className="muted mt-0.5 text-xs">
                      {source.hostname} · {source.claims.length ? `claims: ${source.claims.join(', ')}` : 'no structured claims'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {o.officialSource ? (
              <p className="mt-3 text-xs text-ink-600">
                Authoritative source:{' '}
                <a href={o.officialSource} target="_blank" rel="noreferrer noopener" className="link">
                  {new URL(o.officialSource).hostname}
                </a>
              </p>
            ) : (
              <p className="mt-3 text-xs text-amber-700">No official source could be verified for this listing. Treat the details as unconfirmed.</p>
            )}
          </Card>

          {/* Duplicates */}
          {duplicates.length ? (
            <Card className="card-pad">
              <SectionHeading icon={Briefcase} title={`Found on ${o.sourceCount} sources`} subtitle="Merged into this record — no double counting" />
              <ul className="divide-y divide-ink-100">
                {duplicates.map((duplicate) => (
                  <li key={duplicate.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-ink-800">{duplicate.title}</p>
                      <p className="muted text-xs">{duplicate.organization}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <TrustBadge score={duplicate.trustScore} status={duplicate.verificationStatus} official={Boolean(duplicate.officialSource)} />
                      {duplicate.isRepresentative ? <Badge tone="brand">canonical</Badge> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Verification history */}
          {verification.length ? (
            <Card className="card-pad">
              <SectionHeading icon={FileText} title="Verification history" />
              <ul className="space-y-2 text-xs text-ink-700">
                {verification.slice(0, 8).map((run) => (
                  <li key={run.id} className="rounded-lg bg-ink-50 px-3 py-2">
                    <span className="font-medium">{new Date(run.checked_at).toLocaleString('en-IN')}</span> — {run.outcome}
                    {run.checked_fields ? ` · fields: ${JSON.parse(run.checked_fields).join(', ')}` : ''}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          {/* Action panel */}
          <Card className="card-pad">
            <SectionHeading icon={Target} title="Take action" />
            <div className="space-y-2">
              {o.applyUrl ? (
                <a href={o.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary w-full">
                  {(o.deadlineDays ?? -1) < 0 ? 'Application closed' : `Apply now${o.deadlineDays !== null && o.deadlineDays <= 2 ? ` — deadline in ${o.deadlineDays} day(s)` : ''}`}
                </a>
              ) : (
                <Badge tone="muted" className="w-full justify-center py-2">
                  No verified application link
                </Badge>
              )}
              <button onClick={() => void toggleSave()} className="btn-secondary w-full">
                <Bookmark className="h-4 w-4" /> {saved ? 'Remove from saved' : 'Save for later'}
              </button>
              {tracked ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Tracking as <strong>{tracked.replace(/_/g, ' ')}</strong>. <Link href="/applications" className="link">Open tracker</Link>
                </p>
              ) : (
                <button onClick={() => void track('to_apply')} className="btn-secondary w-full">
                  Add to application tracker
                </button>
              )}
              <Link href="/resume" className="btn-ghost w-full">
                Optimise my resume for this role
              </Link>
            </div>
          </Card>

          {/* Exam card when this is a government exam */}
          {exam ? (
            <Card className="card-pad">
              <SectionHeading icon={Landmark} title="Examination details" />
              <dl className="space-y-2 text-sm">
                {[
                  ['Notification number', exam.notificationNumber],
                  ['Notification date', exam.notificationDate],
                  ['Total vacancies', exam.totalVacancies],
                  ['Pay scale', exam.payScale],
                  ['Nationality', exam.nationality],
                  ['Experience required', exam.experienceRequired],
                  ['Admit card', exam.admitCardDate],
                  ['Answer key', exam.answerKeyStatus],
                  ['Interview', exam.interviewStatus],
                  ['Final result', exam.finalResultStatus],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between gap-3">
                    <dt className="text-ink-500">{label}</dt>
                    <dd className="text-right text-ink-900">{value ?? 'Unknown'}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/exam/${params.id}`} className="btn-secondary mt-3 w-full">
                Full exam timeline
              </Link>
            </Card>
          ) : null}

          {/* Feedback loop */}
          <Card className="card-pad">
            <SectionHeading icon={Sparkles} title="Was this relevant?" subtitle="Your feedback adjusts future rankings" />
            <div className="flex flex-wrap gap-2">
              {[
                { verdict: 'relevant', label: '👍 Relevant' },
                { verdict: 'not_relevant', label: '👎 Not relevant' },
                { verdict: 'already_applied', label: 'Already applied' },
                { verdict: 'not_eligible', label: 'Not eligible' },
                { verdict: 'wrong_information', label: '⚠️ Wrong info' },
              ].map((option) => (
                <button
                  key={option.verdict}
                  onClick={() => void sendFeedback(option.verdict)}
                  className={feedbackSent === option.verdict ? 'btn-secondary btn-sm text-brand-700' : 'btn-ghost btn-sm'}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {feedbackSent ? <p className="muted mt-2 text-xs">Thanks — recorded as “{feedbackSent.replace(/_/g, ' ')}”.</p> : null}
          </Card>

          <Disclaimer />
        </div>
      </div>
    </AppShell>
  );
}
