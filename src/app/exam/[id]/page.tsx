'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeft, Bookmark, CheckCircle2, ExternalLink, Landmark, ShieldAlert } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, ConflictBanner, DeadlineBadge, Disclaimer, EligibilityBadge, SectionHeading, Spinner, SourceBadge, StatusBadge, TrustBadge } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

const STAGE_HINTS: Record<string, string> = {
  notification: 'The official notification has been published. Read it before anything else.',
  application_start: 'The application window is open.',
  application_deadline: 'Applications close on this date. Fee payment may close later.',
  admit_card: 'Admit cards are released ahead of the exam.',
  exam: 'The examination is scheduled for this date.',
  answer_key: 'The provisional answer key is published after the exam.',
  result: 'Results are declared on or around this date.',
  interview: 'Interview or document verification stage.',
  final_result: 'The final selection list is published.',
};

export default function ExamDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tracked, setTracked] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get<any>(`/api/exam/${params.id}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load this examination.'))
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
      await api.post('/api/saved', { examId: params.id });
      setSaved(true);
    }
  };

  const track = async () => {
    const result = await api.post<{ application: { status: string } }>('/api/applications', {
      examId: params.id,
      title: data?.exam?.name ?? '',
      organization: data?.exam?.organization ?? '',
      status: 'to_apply',
    });
    setTracked(result.application.status);
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

  if (error || !data?.exam) {
    return (
      <AppShell>
        <PageHeader title="Examination not found" />
        <Card className="card-pad">
          <p className="text-sm text-ink-700">{error ?? 'This examination record is no longer available.'}</p>
          <Link href="/exams" className="btn-primary mt-3">
            <ArrowLeft className="h-4 w-4" /> Back to exams
          </Link>
        </Card>
      </AppShell>
    );
  }

  const exam = data.exam;
  const opportunity = data.opportunity;
  const timeline: any[] = exam.timeline ?? [];
  const sources: any[] = data.sources ?? [];
  const verification: any[] = data.verification ?? [];

  return (
    <AppShell>
      <PageHeader
        title={exam.name}
        subtitle={`${exam.organization} · ${exam.category.replace(/_/g, ' ')}`}
        actions={
          <>
            <Link href="/exams" className="btn-secondary">
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
            <button onClick={() => void toggleSave()} className={saved ? 'btn-secondary text-brand-700' : 'btn-secondary'}>
              <Bookmark className="h-4 w-4" /> {saved ? 'Saved' : 'Save'}
            </button>
            {exam.officialApplication ? (
              <a href={exam.officialApplication} target="_blank" rel="noreferrer noopener" className="btn-primary">
                {(exam.daysRemaining ?? -1) < 0 ? 'Application closed' : 'Apply now'}
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
              <StatusBadge status={exam.status} />
              <DeadlineBadge daysRemaining={exam.daysRemaining} cta={exam.deadlineCta} formatted={exam.deadlineFormatted} />
              <TrustBadge score={exam.trustScore} status={exam.verificationStatus} official={Boolean(exam.officialNotification)} />
              {exam.vacancies != null ? <Badge tone="neutral">{exam.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
              {opportunity ? <EligibilityBadge status={opportunity.eligibilityStatus} reason={opportunity.eligibilityReason} /> : null}
            </div>

            <dl className="mt-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Notification number', exam.notificationNumber],
                ['Notification date', exam.notificationDate ? new Date(exam.notificationDate).toLocaleDateString('en-IN') : null],
                ['Qualification', (exam.qualification ?? []).join(', ') || null],
                ['Age limit', exam.ageMin != null ? `${exam.ageMin}–${exam.ageMax} years` : null],
                ['Age relaxation', exam.ageRelaxation],
                ['Nationality', exam.nationality],
                ['Experience required', exam.experienceRequired],
                ['Application fee', exam.fee],
                ['Fee deadline', exam.feeDeadline ? new Date(exam.feeDeadline).toLocaleDateString('en-IN') : null],
                ['Correction window', exam.correctionWindow],
                ['Admit card', exam.admitCardDate ? new Date(exam.admitCardDate).toLocaleDateString('en-IN') : null],
                ['Exam date', exam.examDate ? new Date(exam.examDate).toLocaleDateString('en-IN') : null],
                ['Answer key', exam.answerKeyStatus],
                ['Result', exam.resultDate ? new Date(exam.resultDate).toLocaleDateString('en-IN') : null],
                ['Result status', exam.resultStatus],
                ['Interview', exam.interviewStatus],
                ['Final result', exam.finalResultStatus],
                ['Pay scale', exam.payScale],
                ['Exam mode', exam.examMode],
                ['Official website', exam.officialWebsite],
              ]
                .filter(([, value]) => value !== null && value !== undefined && value !== '')
                .map(([label, value]) => (
                  <div key={label as string}>
                    <dt className="text-xs uppercase tracking-wide text-ink-500">{label}</dt>
                    <dd className="mt-0.5 break-words text-ink-900">{value}</dd>
                  </div>
                ))}
            </dl>

            {exam.eligibilityDetails ? (
              <div className="mt-4 border-t border-ink-100 pt-4">
                <p className="label">Eligibility details</p>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{exam.eligibilityDetails}</p>
              </div>
            ) : null}

            {exam.syllabus ? (
              <div className="mt-4">
                <p className="label">Syllabus</p>
                <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{exam.syllabus}</p>
              </div>
            ) : null}

            {(exam.posts ?? []).length ? (
              <div className="mt-4">
                <p className="label">Posts</p>
                <div className="flex flex-wrap gap-1.5">
                  {exam.posts.map((post: string) => (
                    <Badge key={post} tone="neutral">
                      {post}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <p className="muted mt-4 border-t border-ink-100 pt-3 text-xs">
              {exam.lastCheckedAt ? `Last verified ${new Date(exam.lastCheckedAt).toLocaleString('en-IN')}` : 'Never re-verified'}
              {exam.nextVerification ? ` · next check ${new Date(exam.nextVerification).toLocaleDateString('en-IN')}` : ''}
            </p>
          </Card>

          {/* Nine-stage timeline */}
          <Card className="card-pad">
            <SectionHeading icon={Landmark} title="Examination timeline" subtitle={`Stage ${exam.currentStage} of 9 — ${exam.stageLabel}`} />
            <ol className="relative ml-3 space-y-4 border-l-2 border-ink-100 pl-5">
              {timeline.map((stage, index) => {
                const isCurrent = index + 1 === exam.currentStage;
                const isDone = stage.state === 'completed';
                return (
                  <li key={stage.stage} className="relative">
                    <span
                      className={clsx(
                        'absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white',
                        isDone ? 'bg-emerald-500' : isCurrent ? 'bg-brand-600' : stage.state === 'unknown' ? 'bg-ink-300' : 'bg-ink-200',
                      )}
                    >
                      {isDone ? <CheckCircle2 className="h-2.5 w-2.5 text-white" /> : null}
                    </span>
                    <div className={clsx('rounded-lg px-3 py-2', isCurrent && 'bg-brand-50')}>
                      <p className={clsx('text-sm font-medium', isCurrent ? 'text-brand-800' : 'text-ink-900')}>
                        {index + 1}. {stage.label}
                      </p>
                      <p className="muted text-xs">
                        {stage.date ? new Date(stage.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date not published'}
                        {isCurrent ? ' · your current stage' : ''}
                      </p>
                      <p className="muted mt-0.5 text-xs">{STAGE_HINTS[stage.stage] ?? ''}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          {exam.conflicts?.length ? (
            <Card className="card-pad">
              <SectionHeading icon={ShieldAlert} title="Conflicting information" subtitle="Sources disagree — nothing was silently chosen" />
              <ConflictBanner conflicts={exam.conflicts} />
            </Card>
          ) : null}

          <Card className="card-pad">
            <SectionHeading icon={Landmark} title="Sources" subtitle="Where each claim came from" />
            {sources.length === 0 ? (
              <p className="muted">No source records stored for this examination.</p>
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
                      </div>
                    </div>
                    <p className="muted mt-0.5 text-xs">
                      {source.hostname} · {source.claims.length ? source.claims.join(', ') : 'no structured claims'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {verification.length ? (
            <Card className="card-pad">
              <SectionHeading icon={CheckCircle2} title="Verification history" />
              <ul className="space-y-2 text-xs text-ink-700">
                {verification.slice(0, 8).map((run) => (
                  <li key={run.id} className="rounded-lg bg-ink-50 px-3 py-2">
                    <span className="font-medium">{new Date(run.checked_at).toLocaleString('en-IN')}</span> — {run.outcome}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card className="card-pad">
            <SectionHeading icon={Landmark} title="Take action" />
            <div className="space-y-2">
              {exam.officialApplication ? (
                <a href={exam.officialApplication} target="_blank" rel="noreferrer noopener" className="btn-primary w-full">
                  {(exam.daysRemaining ?? -1) < 0
                    ? 'Application closed'
                    : `Apply now${exam.daysRemaining !== null && exam.daysRemaining <= 2 ? ` — closes in ${exam.daysRemaining} day(s)` : ''}`}
                </a>
              ) : (
                <Badge tone="muted" className="w-full justify-center py-2">
                  Application link not verified
                </Badge>
              )}
              {exam.officialNotification ? (
                <a href={exam.officialNotification} target="_blank" rel="noreferrer noopener" className="btn-secondary w-full">
                  Official notification
                </a>
              ) : null}
              <button onClick={() => void toggleSave()} className="btn-secondary w-full">
                <Bookmark className="h-4 w-4" /> {saved ? 'Remove from saved' : 'Save this exam'}
              </button>
              {tracked ? (
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Tracking as <strong>{tracked.replace(/_/g, ' ')}</strong>. <Link href="/applications" className="link">Open tracker</Link>
                </p>
              ) : (
                <button onClick={() => void track()} className="btn-secondary w-full">
                  Add to application tracker
                </button>
              )}
            </div>
          </Card>

          {opportunity ? (
            <Card className="card-pad">
              <SectionHeading icon={Landmark} title="Your eligibility" subtitle="Government eligibility model — qualification-gated" />
              <div className="space-y-2 text-sm">
                <EligibilityBadge status={opportunity.eligibilityStatus} reason={opportunity.eligibilityReason} />
                <p className="muted text-xs leading-relaxed">{opportunity.eligibilityReason}</p>
                <Link href={`/opportunity/${params.id}`} className="btn-secondary w-full">
                  Full match breakdown
                </Link>
              </div>
            </Card>
          ) : null}

          <Disclaimer />
        </div>
      </div>
    </AppShell>
  );
}
