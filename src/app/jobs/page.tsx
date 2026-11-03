'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw, Search, Target } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import {
  Badge,
  Card,
  DeadlineBadge,
  Disclaimer,
  EligibilityBadge,
  EmptyState,
  MatchBandBadge,
  SectionHeading,
  Spinner,
  StatusBadge,
  TrustBadge,
} from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';

interface Opportunity {
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
  deadlineCta: string;
  deadlineFormatted: string;
  eligibilityStatus: string;
  eligibilityReason: string;
  verificationStatus: string;
  trustScore: number;
  officialSource: string | null;
  applyUrl: string | null;
  explanation: string;
  gaps: string[];
  experienceLevel: string;
  sourceKind: string;
  sourceTier: number | null;
  examStatus: string | null;
  isGovernment: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: string | null;
  vacancies: number | null;
  sourceCount: number;
  isDemo: boolean;
}

const TYPES = ['', 'job', 'internship', 'graduate_job', 'fresher_job', 'experienced_job', 'remote_job', 'hybrid_job', 'contract', 'government_job', 'exam', 'apprenticeship', 'trainee'];
const BANDS = ['', 'perfect', 'strong', 'good', 'possible', 'skill_gap', 'not_eligible'];
const SORTS: { value: string; label: string }[] = [
  { value: 'best_match', label: 'Best match' },
  { value: 'deadline', label: 'Deadline (soonest)' },
  { value: 'trust', label: 'Source trust' },
  { value: 'quality', label: 'Listing quality' },
  { value: 'rank', label: 'AI ranking' },
  { value: 'recent', label: 'Recently added' },
];
const LOCATIONS = ['', 'India', 'Tamil Nadu', 'Chennai', 'Coimbatore', 'Thanjavur', 'Salem', 'Madurai', 'Bengaluru', 'Hyderabad', 'Mumbai', 'Delhi', 'Remote'];

function JobsInner() {
  const params = useSearchParams();
  const [filters, setFilters] = useState({
    q: params.get('q') ?? '',
    type: params.get('type') ?? '',
    experience: params.get('experience') ?? '',
    mode: params.get('mode') ?? '',
    location: params.get('location') ?? '',
    salaryMin: params.get('salaryMin') ?? '',
    salaryMax: params.get('salaryMax') ?? '',
    deadline: params.get('deadline') ?? '',
    band: params.get('band') ?? '',
    sort: params.get('sort') ?? 'best_match',
  });
  const [query, setQuery] = useState(filters.q);
  const [results, setResults] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const buildUrl = useCallback(() => {
    const search = new URLSearchParams();
    if (filters.q) search.set('q', filters.q);
    if (filters.type) search.set('type', filters.type);
    if (filters.experience) search.set('experience', filters.experience);
    if (filters.mode) search.set('mode', filters.mode);
    if (filters.location) search.set('location', filters.location);
    if (filters.salaryMin) search.set('salaryMin', filters.salaryMin);
    if (filters.salaryMax) search.set('salaryMax', filters.salaryMax);
    if (filters.deadline) search.set('deadlineDays', filters.deadline);
    if (filters.band) search.set('band', filters.band);
    search.set('sort', filters.sort);
    search.set('limit', '50');
    return `/api/opportunities?${search.toString()}`;
  }, [filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<{ opportunities: Opportunity[]; total: number; summary: any }>(buildUrl());
      setResults(data.opportunities);
      setTotal(data.total);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not load opportunities.');
    } finally {
      setLoading(false);
    }
  }, [buildUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get<{ saved: { id: string }[] }>('/api/saved').then((data) => setSaved(new Set(data.saved.map((item) => item.id)))).catch(() => undefined);
  }, []);

  const runSearch = async () => {
    setLoading(true);
    setError(null);
    try {
      const job = await api.post<{ searchJobId: string; found: number; stored: number }>('/api/search/run', { maxQueries: 6 });
      setError(null);
      await load();
      setSummary((prev: any) => ({ ...prev, lastSearch: job }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSave = async (id: string) => {
    const next = new Set(saved);
    if (next.has(id)) {
      next.delete(id);
      await api.delete(`/api/saved?id=${id}`);
    } else {
      next.add(id);
      await api.post('/api/saved', { opportunityId: id });
    }
    setSaved(next);
  };

  const set = (key: keyof typeof filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((prev) => ({ ...prev, [key]: event.target.value }));

  const activeFilters = useMemo(
    () => Object.entries(filters).filter(([key, value]) => value && key !== 'sort').length,
    [filters],
  );

  return (
    <AppShell>
      <PageHeader
        title="Job opportunities"
        subtitle={`${total} opportunities matched against your profile`}
        actions={
          <>
            <button onClick={() => void load()} className="btn-secondary">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={() => void runSearch()} disabled={loading} className="btn-primary">
              <Search className="h-4 w-4" /> Search the internet now
            </button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <Card className="card-pad h-fit lg:sticky lg:top-20">
          <SectionHeading icon={Filter} title="Filters" subtitle={activeFilters ? `${activeFilters} active` : undefined} />
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="q">Keyword</label>
              <input
                id="q"
                className="input"
                placeholder="e.g. accountant"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && setFilters((prev) => ({ ...prev, q: query }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="type">Opportunity type</label>
              <select id="type" className="input" value={filters.type} onChange={set('type')}>
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === '' ? 'All types' : type.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="experience">Experience level</label>
              <select id="experience" className="input" value={filters.experience} onChange={set('experience')}>
                <option value="">Any</option>
                <option value="fresher">Fresher</option>
                <option value="entry">Entry (0–2 yrs)</option>
                <option value="mid">Mid (2–5 yrs)</option>
                <option value="senior">Senior (5+ yrs)</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="mode">Work mode</label>
              <select id="mode" className="input" value={filters.mode} onChange={set('mode')}>
                <option value="">Any</option>
                <option value="onsite">On-site</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="location">Location</label>
              <select id="location" className="input" value={filters.location} onChange={set('location')}>
                {LOCATIONS.map((location) => (
                  <option key={location} value={location}>
                    {location === '' ? 'Anywhere' : location}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="salaryMin">Salary min</label>
                <input id="salaryMin" type="number" className="input" placeholder="300000" value={filters.salaryMin} onChange={set('salaryMin')} />
              </div>
              <div>
                <label className="label" htmlFor="salaryMax">Salary max</label>
                <input id="salaryMax" type="number" className="input" placeholder="1200000" value={filters.salaryMax} onChange={set('salaryMax')} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="deadline">Deadline within</label>
              <select id="deadline" className="input" value={filters.deadline} onChange={set('deadline')}>
                <option value="">Any time</option>
                <option value="2">2 days (critical)</option>
                <option value="7">7 days (high)</option>
                <option value="15">15 days (medium)</option>
                <option value="30">30 days</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="band">Match band</label>
              <select id="band" className="input" value={filters.band} onChange={set('band')}>
                {BANDS.map((band) => (
                  <option key={band} value={band}>
                    {band === '' ? 'All bands' : band.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="sort">Sort by</label>
              <select id="sort" className="input" value={filters.sort} onChange={set('sort')}>
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                setFilters({ q: '', type: '', experience: '', mode: '', location: '', salaryMin: '', salaryMax: '', deadline: '', band: '', sort: 'best_match' });
                setQuery('');
              }}
              className="btn-ghost btn-sm w-full"
            >
              Clear filters
            </button>
          </div>
        </Card>

        <div className="space-y-4">
          {summary?.summary ? (
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">🎯 {summary.summary.perfect} perfect</Badge>
              <Badge tone="info">💼 {summary.total} total</Badge>
              <Badge tone="brand">🏛 {summary.summary.government} government</Badge>
              <Badge tone="danger">⏰ {summary.summary.closingSoon} closing soon</Badge>
              {summary.summary.suspicious ? <Badge tone="danger">🔴 {summary.summary.suspicious} suspicious</Badge> : null}
              {summary.summary.conflicting ? <Badge tone="caution">⚠️ {summary.summary.conflicting} conflicting</Badge> : null}
            </div>
          ) : null}

          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          {loading ? (
            <Card className="card-pad flex justify-center py-16">
              <Spinner label="Loading opportunities…" />
            </Card>
          ) : results.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No opportunities match these filters"
              description="Try widening the deadline window, clearing the location filter, or running a fresh internet search."
              action={
                <button onClick={() => void runSearch()} className="btn-primary">
                  <Search className="h-4 w-4" /> Search the internet now
                </button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {results.map((opportunity) => (
                <li key={opportunity.id} className="card card-pad">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={opportunity.isGovernment ? `/exam/${opportunity.id}` : `/opportunity/${opportunity.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">
                        {opportunity.title}
                      </Link>
                      <p className="muted mt-0.5 text-xs">
                        {opportunity.organization}
                        {opportunity.locationSummary ? ` · ${opportunity.locationSummary}` : ''}
                        {opportunity.type ? ` · ${opportunity.type.replace(/_/g, ' ')}` : ''}
                        {opportunity.category ? ` · ${opportunity.category.replace(/_/g, ' ')}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-lg font-semibold tabular-nums text-ink-900">{Math.round(opportunity.finalScore)}%</span>
                      <MatchBandBadge band={opportunity.band} label={opportunity.bandLabel} />
                    </div>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <EligibilityBadge status={opportunity.eligibilityStatus} reason={opportunity.eligibilityReason} />
                    <DeadlineBadge daysRemaining={opportunity.deadlineDays} cta={opportunity.deadlineCta} formatted={opportunity.deadlineFormatted} />
                    <TrustBadge score={opportunity.trustScore} status={opportunity.verificationStatus} official={Boolean(opportunity.officialSource)} />
                    {opportunity.examStatus ? <StatusBadge status={opportunity.examStatus} /> : null}
                    {opportunity.sourceCount > 1 ? <Badge tone="neutral">Found on {opportunity.sourceCount} sources</Badge> : null}
                    {opportunity.vacancies != null ? <Badge tone="neutral">{opportunity.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
                    {opportunity.experienceLevel ? <Badge tone="muted">{opportunity.experienceLevel}</Badge> : null}
                    {opportunity.salaryMin ? (
                      <Badge tone="muted">
                        ₹{opportunity.salaryMin.toLocaleString('en-IN')}
                        {opportunity.salaryMax ? `–${opportunity.salaryMax.toLocaleString('en-IN')}` : ''}
                        {opportunity.salaryPeriod ? ` / ${opportunity.salaryPeriod}` : ''}
                      </Badge>
                    ) : null}
                    {opportunity.isDemo ? <Badge tone="muted">demo</Badge> : null}
                  </div>

                  {opportunity.explanation ? <p className="muted mt-2 text-xs leading-relaxed">{opportunity.explanation}</p> : null}
                  {opportunity.gaps.length ? <p className="mt-1.5 text-xs text-amber-700">Potential gaps: {opportunity.gaps.join(', ')}</p> : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button onClick={() => void toggleSave(opportunity.id)} className={saved.has(opportunity.id) ? 'btn-secondary btn-sm text-brand-700' : 'btn-ghost btn-sm'}>
                      {saved.has(opportunity.id) ? '★ Saved' : '☆ Save'}
                    </button>
                    <Link href={opportunity.isGovernment ? `/exam/${opportunity.id}` : `/opportunity/${opportunity.id}`} className="btn-secondary btn-sm">
                      View details
                    </Link>
                    {opportunity.applyUrl ? (
                      <a href={opportunity.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm">
                        {opportunity.deadlineDays !== null && opportunity.deadlineDays < 0 ? 'Application closed' : 'Apply now'}
                      </a>
                    ) : (
                      <Badge tone="muted" title="No official application link could be verified">
                        Link not verified
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Disclaimer />
        </div>
      </div>
    </AppShell>
  );
}

export default function JobsPage() {
  return (
    <Suspense>
      <JobsInner />
    </Suspense>
  );
}
