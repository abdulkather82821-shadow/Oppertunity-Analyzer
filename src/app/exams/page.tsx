'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, ConflictBanner, DeadlineBadge, Disclaimer, EmptyState, Spinner, StatusBadge, TrustBadge } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

const CATEGORIES = ['all', 'central', 'state', 'banking', 'ssc', 'upsc', 'rrb', 'teaching', 'defence', 'psu', 'insurance', 'court', 'university', 'research', 'apprenticeship'];

interface Exam {
  id: string;
  name: string;
  organization: string;
  category: string;
  status: string;
  applicationStart: string | null;
  applicationDeadline: string | null;
  examDate: string | null;
  resultDate: string | null;
  daysRemaining: number | null;
  deadlineLabel: string;
  deadlineCta: string;
  deadlineFormatted: string;
  qualification: string[];
  ageMin: number | null;
  ageMax: number | null;
  vacancies: number | null;
  fee: string | null;
  trustScore: number;
  verificationStatus: string;
  officialNotification: string | null;
  officialApplication: string | null;
  currentStage: number;
  stageLabel: string;
  timeline: { stage: string; label: string; date: string | null; state: 'completed' | 'current' | 'upcoming' | 'unknown' }[];
  conflicts: { field: string; value: string; url: string; isOfficial: boolean }[];
  lastCheckedAt: string | null;
}

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const search = new URLSearchParams({ limit: '60' });
    if (category !== 'all') search.set('category', category);
    if (status) search.set('status', status);
    api
      .get<{ exams: Exam[]; total: number }>(`/api/exams?${search.toString()}`)
      .then((data) => setExams(data.exams))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load examinations.'))
      .finally(() => setLoading(false));
  }, [category, status]);

  const counts = exams.reduce<Record<string, number>>((accumulator, exam) => {
    accumulator[exam.status] = (accumulator[exam.status] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <AppShell>
      <PageHeader
        title="Government examination calendar"
        subtitle="Nine-stage tracking from notification to final result. Statuses are derived from published dates — never guessed."
        actions={
          <Link href="/government" className="btn-secondary">
            <Search className="h-4 w-4" /> Government jobs
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {Object.entries(counts).map(([key, value]) => (
          <button key={key} onClick={() => setStatus(status === key ? '' : key)} className={`badge ${status === key ? 'tone-brand' : 'tone-neutral'}`}>
            {key.replace(/_/g, ' ')} · {value}
          </button>
        ))}
      </div>

      <Card className="card-pad mb-5">
        <label className="label" htmlFor="category">Category</label>
        <select id="category" className="input max-w-xs" value={category} onChange={(event) => setCategory(event.target.value)}>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item === 'all' ? 'All categories' : item.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </Card>

      {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <Card className="card-pad flex justify-center py-16">
          <Spinner />
        </Card>
      ) : exams.length === 0 ? (
        <EmptyState icon={ScrollText} title="No examinations match this filter" description="Try another category, or clear the status filter." />
      ) : (
        <ul className="space-y-3">
          {exams.map((exam) => (
            <li key={exam.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/exam/${exam.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">
                    {exam.name}
                  </Link>
                  <p className="muted mt-0.5 text-xs">
                    {exam.organization} · {exam.category.replace(/_/g, ' ')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <StatusBadge status={exam.status} />
                  <TrustBadge score={exam.trustScore} status={exam.verificationStatus} official={Boolean(exam.officialNotification)} />
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <DeadlineBadge daysRemaining={exam.daysRemaining} cta={exam.deadlineCta} formatted={exam.deadlineFormatted} />
                {exam.vacancies != null ? <Badge tone="neutral">{exam.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
                {exam.ageMin != null ? <Badge tone="muted">Age {exam.ageMin}–{exam.ageMax}</Badge> : null}
                {exam.fee ? <Badge tone="muted">Fee {exam.fee}</Badge> : null}
              </div>

              <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-ink-500">Application</dt>
                  <dd className="text-ink-800">
                    {exam.applicationStart ? new Date(exam.applicationStart).toLocaleDateString('en-IN') : 'Unknown'} →{' '}
                    {exam.applicationDeadline ? new Date(exam.applicationDeadline).toLocaleDateString('en-IN') : 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500">Exam date</dt>
                  <dd className="text-ink-800">{exam.examDate ? new Date(exam.examDate).toLocaleDateString('en-IN') : 'Not published'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Result</dt>
                  <dd className="text-ink-800">{exam.resultDate ? new Date(exam.resultDate).toLocaleDateString('en-IN') : 'Not published'}</dd>
                </div>
                <div>
                  <dt className="text-ink-500">Qualification</dt>
                  <dd className="text-ink-800">{exam.qualification.length ? exam.qualification.join(', ') : 'Not published'}</dd>
                </div>
              </dl>

              <StageTimeline timeline={exam.timeline} current={exam.currentStage} />

              {exam.conflicts.length ? <div className="mt-3"><ConflictBanner conflicts={exam.conflicts} /></div> : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={`/exam/${exam.id}`} className="btn-secondary btn-sm">
                  Full details & timeline
                </Link>
                {exam.officialNotification ? (
                  <a href={exam.officialNotification} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm">
                    Official notification
                  </a>
                ) : (
                  <Badge tone="muted">Notification link not verified</Badge>
                )}
                {exam.officialApplication ? (
                  <a href={exam.officialApplication} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm">
                    {(exam.daysRemaining ?? -1) < 0 ? 'Application closed' : 'Apply now'}
                  </a>
                ) : null}
              </div>

              <p className="muted mt-2 text-[11px]">
                {exam.lastCheckedAt ? `Last verified ${new Date(exam.lastCheckedAt).toLocaleDateString('en-IN')}` : 'Never re-verified'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Disclaimer />
    </AppShell>
  );
}

function StageTimeline({ timeline, current }: { timeline: Exam['timeline']; current: number }) {
  return (
    <div className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Stage {current} of 9 — {timeline[current - 1]?.label ?? 'unknown'}
      </p>
      <ol className="grid gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        {timeline.map((stage, index) => (
          <li key={stage.stage} className="flex items-center gap-1.5 text-[11px]">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                stage.state === 'completed' ? 'bg-emerald-500' : stage.state === 'current' ? 'bg-brand-600' : stage.state === 'unknown' ? 'bg-ink-300' : 'bg-ink-200'
              }`}
            />
            <span className={stage.state === 'current' ? 'font-semibold text-ink-900' : 'text-ink-600'}>
              {index + 1}. {stage.label}
            </span>
            {stage.date ? <span className="text-ink-400">{new Date(stage.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
