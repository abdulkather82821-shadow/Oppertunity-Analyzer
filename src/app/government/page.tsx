'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Landmark, Search } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, DeadlineBadge, Disclaimer, EmptyState, SectionHeading, Spinner, StatusBadge, TrustBadge } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

const CATEGORIES = [
  'central_government', 'state_government', 'psu', 'banking', 'railway', 'ssc', 'upsc', 'state_psc',
  'teaching', 'police', 'defence', 'insurance', 'court', 'university', 'research', 'apprenticeship',
];

interface GovOpportunity {
  id: string;
  title: string;
  organization: string;
  type: string;
  category: string;
  locationSummary: string;
  finalScore: number;
  matchScore: number;
  deadlineDays: number | null;
  deadlineCta: string;
  deadlineFormatted: string;
  eligibilityStatus: string;
  eligibilityReason: string;
  verificationStatus: string;
  trustScore: number;
  officialSource: string | null;
  applyUrl: string | null;
  vacancies: number | null;
  examStatus: string | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  examDate: string | null;
  ageMin: number | null;
  ageMax: number | null;
  qualification: string[];
  officialNotification: string | null;
  lastCheckedAt: string | null;
  sourceKind: string;
  sourceTier: number | null;
}

export default function GovernmentPage() {
  const [items, setItems] = useState<GovOpportunity[]>([]);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSearch, setLastSearch] = useState<{ found: number; stored: number; providers: string[] } | null>(null);

  useEffect(() => {
    setLoading(true);
    const search = new URLSearchParams({ type: 'government_job', limit: '80', sort: 'best_match' });
    if (category) search.set('category', category);
    if (status) search.set('status', status);
    api
      .get<{ opportunities: GovOpportunity[]; total: number }>(`/api/opportunities?${search.toString()}`)
      .then((data) => setItems(data.opportunities))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load government opportunities.'))
      .finally(() => setLoading(false));
  }, [category, status]);

  const searchNow = async () => {
    setLoading(true);
    setError(null);
    try {
      const job = await api.post<{ found: number; stored: number; providers: string[] }>('/api/search/run', { maxQueries: 8 });
      setLastSearch(job);
      const data = await api.get<{ opportunities: GovOpportunity[] }>(`/api/opportunities?type=government_job&limit=80&sort=best_match${category ? `&category=${category}` : ''}`);
      setItems(data.opportunities);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const open = items.filter((item) => (item.deadlineDays ?? -1) >= 0);
  const upcoming = items.filter((item) => item.examStatus === 'notification_expected');

  return (
    <AppShell>
      <PageHeader
        title="Government opportunities"
        subtitle="Central, state, PSU, banking, railway and commission recruitments — official sources prioritised"
        actions={
          <button onClick={() => void searchNow()} disabled={loading} className="btn-primary">
            <Search className="h-4 w-4" /> Search government sources
          </button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Applications open', value: open.length, tone: 'success' as const },
          { label: 'Notification expected', value: upcoming.length, tone: 'muted' as const },
          { label: 'Total tracked', value: items.length, tone: 'info' as const },
        ].map((stat) => (
          <Card key={stat.label} className="card-pad">
            <p className="text-xs uppercase tracking-wide text-ink-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{stat.value}</p>
          </Card>
        ))}
      </div>

      <Card className="card-pad mb-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <label className="label" htmlFor="category">Category</label>
            <select id="category" className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="label" htmlFor="status">Status</label>
            <select id="status" className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              <option value="applications_open">Applications open</option>
              <option value="notification_expected">Notification expected</option>
              <option value="applications_closed">Closed</option>
              <option value="needs_verification">Needs verification</option>
            </select>
          </div>
          {lastSearch ? (
            <p className="muted text-xs">
              Last search: {lastSearch.found} found, {lastSearch.stored} stored · {lastSearch.providers.join(', ')}
            </p>
          ) : null}
        </div>
      </Card>

      {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {loading ? (
        <Card className="card-pad flex justify-center py-16">
          <Spinner />
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No government opportunities match this filter"
          description="Government notifications are released on fixed calendars. Run a fresh search, or check the exam calendar for upcoming notifications."
          action={
            <Link href="/exams" className="btn-primary">
              Open exam calendar
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="card card-pad">
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
                <span className="shrink-0 text-lg font-semibold tabular-nums text-ink-900">{Math.round(item.finalScore)}%</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Badge tone="brand">{item.category.replace(/_/g, ' ')}</Badge>
                {item.examStatus ? <StatusBadge status={item.examStatus} /> : null}
                <DeadlineBadge daysRemaining={item.deadlineDays} cta={item.deadlineCta} formatted={item.deadlineFormatted} />
                <TrustBadge score={item.trustScore} status={item.verificationStatus} official={Boolean(item.officialSource)} />
                {item.vacancies != null ? <Badge tone="neutral">{item.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
                {item.ageMin != null ? <Badge tone="muted">Age {item.ageMin}–{item.ageMax}</Badge> : null}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <dt className="text-ink-500">Application window</dt>
                  <dd className="text-ink-800">
                    {item.applicationStart ? new Date(item.applicationStart).toLocaleDateString('en-IN') : 'Unknown'} →{' '}
                    {item.applicationDeadline ? new Date(item.applicationDeadline).toLocaleDateString('en-IN') : 'Unknown'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-500">Exam date</dt>
                  <dd className="text-ink-800">{item.examDate ? new Date(item.examDate).toLocaleDateString('en-IN') : 'Not published'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-ink-500">Eligibility</dt>
                  <dd className="text-ink-800">
                    {item.qualification.length ? item.qualification.join(', ') : 'Not published'}
                    {item.eligibilityReason ? ` — ${item.eligibilityReason}` : ''}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link href={`/opportunity/${item.id}`} className="btn-secondary btn-sm">
                  Full details
                </Link>
                {item.officialNotification ? (
                  <a href={item.officialNotification} target="_blank" rel="noreferrer noopener" className="btn-ghost btn-sm">
                    Official notification
                  </a>
                ) : null}
                {item.applyUrl ? (
                  <a href={item.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm">
                    {(item.deadlineDays ?? -1) < 0 ? 'Application closed' : 'Apply now'}
                  </a>
                ) : (
                  <Badge tone="muted">Apply link not verified</Badge>
                )}
              </div>

              <p className="muted mt-2 text-[11px]">
                Source: {item.sourceKind}
                {item.sourceTier ? ` (tier ${item.sourceTier})` : ''}
                {item.lastCheckedAt ? ` · last checked ${new Date(item.lastCheckedAt).toLocaleDateString('en-IN')}` : ' · never re-verified'}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Disclaimer />
    </AppShell>
  );
}

