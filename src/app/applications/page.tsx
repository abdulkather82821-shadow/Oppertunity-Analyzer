'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, EmptyState, SectionHeading, Spinner } from '@/components/ui';
import { api, fmtDate } from '@/lib/client/api';

const STATUSES = [
  { key: 'interested', label: 'Interested', tone: 'tone-neutral' },
  { key: 'to_apply', label: 'To Apply', tone: 'tone-info' },
  { key: 'applied', label: 'Applied', tone: 'tone-brand' },
  { key: 'test_scheduled', label: 'Test Scheduled', tone: 'tone-warning' },
  { key: 'interview_scheduled', label: 'Interview', tone: 'tone-caution' },
  { key: 'selected', label: 'Selected', tone: 'tone-success' },
  { key: 'rejected', label: 'Rejected', tone: 'tone-danger' },
  { key: 'withdrawn', label: 'Withdrawn', tone: 'tone-muted' },
];

interface Application {
  id: string;
  title: string;
  organization: string;
  status: string;
  appliedAt: string | null;
  testAt: string | null;
  interviewAt: string | null;
  interviewInfo: string;
  resultKnown: string | null;
  notes: string;
  history: { status: string; at: string }[];
  updatedAtAgo: string;
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ title: '', organization: '', status: 'to_apply', notes: '' });
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get<{ applications: Application[]; counts: Record<string, number> }>('/api/applications')
      .then((data) => {
        setApplications(data.applications);
        setCounts(data.counts);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    await api.post('/api/applications', draft);
    setDraft({ title: '', organization: '', status: 'to_apply', notes: '' });
    setAdding(false);
    load();
  };

  const move = async (application: Application, status: string) => {
    await api.post('/api/applications', {
      id: application.id,
      title: application.title,
      organization: application.organization,
      status,
      appliedAt: status === 'applied' && !application.appliedAt ? new Date().toISOString() : application.appliedAt,
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this application from your tracker?')) return;
    await api.delete(`/api/applications?id=${id}`);
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
      <PageHeader
        title="Application tracker"
        subtitle={`${applications.length} application(s) tracked`}
        actions={
          <button onClick={() => setAdding(!adding)} className="btn-primary">
            <Plus className="h-4 w-4" /> Add application
          </button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {STATUSES.map((status) => (
          <Card key={status.key} className="card-pad">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">{status.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">{counts[status.key] ?? 0}</p>
          </Card>
        ))}
      </div>

      {adding ? (
        <Card className="card-pad mb-5">
          <SectionHeading title="Add an application" />
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="title">Role / exam title</label>
              <input id="title" required className="input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="organization">Organisation</label>
              <input id="organization" className="input" value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="status">Status</label>
              <select id="status" className="input" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
                {STATUSES.map((status) => (
                  <option key={status.key} value={status.key}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="notes">Notes</label>
              <input id="notes" className="input" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="btn-primary">
                Save
              </button>
              <button type="button" onClick={() => setAdding(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {applications.length === 0 ? (
        <EmptyState
          title="No applications tracked yet"
          description="Add an application manually, or use “Add to application tracker” on any opportunity card."
          action={
            <Link href="/jobs" className="btn-primary">
              Browse opportunities
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto card">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-ink-200 bg-ink-50">
              <tr>
                <th className="table-th">Role</th>
                <th className="table-th">Status</th>
                <th className="table-th">Applied</th>
                <th className="table-th">Test</th>
                <th className="table-th">Interview</th>
                <th className="table-th">Updated</th>
                <th className="table-th"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {applications.map((application) => (
                <tr key={application.id} className="hover:bg-ink-50/60">
                  <td className="table-td">
                    <p className="font-medium text-ink-900">{application.title}</p>
                    <p className="muted text-xs">{application.organization}</p>
                    {application.notes ? <p className="muted mt-0.5 text-xs italic">{application.notes}</p> : null}
                  </td>
                  <td className="table-td">
                    <select
                      className="input max-w-[150px]"
                      value={application.status}
                      onChange={(event) => void move(application, event.target.value)}
                    >
                      {STATUSES.map((status) => (
                        <option key={status.key} value={status.key}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                    <div className="mt-1">
                      <Badge tone="muted">{application.history.length} change(s)</Badge>
                    </div>
                  </td>
                  <td className="table-td">{fmtDate(application.appliedAt)}</td>
                  <td className="table-td">{fmtDate(application.testAt)}</td>
                  <td className="table-td">
                    {fmtDate(application.interviewAt)}
                    {application.interviewInfo ? <p className="muted text-xs">{application.interviewInfo}</p> : null}
                  </td>
                  <td className="table-td text-xs text-ink-500">{application.updatedAtAgo}</td>
                  <td className="table-td">
                    <button onClick={() => void remove(application.id)} className="btn-ghost btn-sm text-red-600" aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card className="card-pad mt-5">
        <SectionHeading title="Status pipeline" subtitle="Eight stages from interest to outcome" />
        <ol className="flex flex-wrap gap-2">
          {STATUSES.map((status, index) => (
            <li key={status.key} className={clsx('badge', status.tone)}>
              {index + 1}. {status.label}
            </li>
          ))}
        </ol>
      </Card>
    </AppShell>
  );
}
