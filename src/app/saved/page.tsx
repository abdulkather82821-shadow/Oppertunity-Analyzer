'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bookmark, Target } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, DeadlineBadge, EligibilityBadge, EmptyState, MatchBandBadge, Spinner, TrustBadge } from '@/components/ui';
import { api } from '@/lib/client/api';

export default function SavedPage() {
  const [saved, setSaved] = useState<any[]>([]);
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api
      .get<{ saved: any[]; exams: any[] }>('/api/saved')
      .then((data) => {
        setSaved(data.saved);
        setExams(data.exams);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async (savedId: string) => {
    await api.delete(`/api/saved?id=${savedId}`);
    load();
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

  return (
    <AppShell>
      <PageHeader title="Saved opportunities" subtitle={`${saved.length + exams.length} item(s) on your shortlist`} />

      {saved.length === 0 && exams.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="Nothing saved yet"
          description="Save opportunities and exams from their cards to build a shortlist you can work through."
          action={
            <Link href="/jobs" className="btn-primary">
              <Target className="h-4 w-4" /> Browse opportunities
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {saved.map((item) => (
            <li key={item.savedId} className="card card-pad">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/opportunity/${item.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">
                    {item.title}
                  </Link>
                  <p className="muted mt-0.5 text-xs">
                    {item.organization}
                    {item.locationSummary ? ` · ${item.locationSummary}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-lg font-semibold tabular-nums text-ink-900">{Math.round(item.finalScore)}%</span>
                  <MatchBandBadge band={item.band} label={item.bandLabel} />
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <EligibilityBadge status={item.eligibilityStatus} reason={item.eligibilityReason} />
                <DeadlineBadge daysRemaining={item.deadlineDays} cta={item.deadlineCta} formatted={item.deadlineFormatted} />
                <TrustBadge score={item.trustScore} status={item.verificationStatus} official={Boolean(item.officialSource)} />
                {item.note ? <Badge tone="muted">Note: {item.note}</Badge> : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={`/opportunity/${item.id}`} className="btn-secondary btn-sm">
                  View details
                </Link>
                {item.applyUrl ? (
                  <a href={item.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm">
                    {(item.deadlineDays ?? -1) < 0 ? 'Application closed' : 'Apply now'}
                  </a>
                ) : null}
                <button onClick={() => void remove(item.savedId)} className="btn-ghost btn-sm text-red-600">
                  Remove
                </button>
              </div>
            </li>
          ))}

          {exams.map((exam) => (
            <li key={exam.id} className="card card-pad">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/exam/${exam.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">
                    {exam.name}
                  </Link>
                  <p className="muted mt-0.5 text-xs">
                    {exam.organization} · {exam.category.replace(/_/g, ' ')}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-ink-500">{exam.status.replace(/_/g, ' ')}</span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <DeadlineBadge daysRemaining={exam.daysRemaining} cta={exam.deadlineCta} formatted={exam.deadlineFormatted} />
                {exam.vacancies != null ? <Badge tone="neutral">{exam.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
                <TrustBadge score={exam.trustScore} status={exam.verificationStatus} official={Boolean(exam.officialNotification)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
