'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Activity, AlertTriangle, Database, GitMerge, ScrollText, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, EmptyState, SectionHeading, Spinner, StatusBadge, TrustBadge } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/api';
import type { MeResponse } from '@/lib/client/api';

type Tab = 'overview' | 'users' | 'opportunities' | 'exams' | 'quality' | 'audit' | 'config';

const TABS: { key: Tab; label: string; permission: string }[] = [
  { key: 'overview', label: 'Overview', permission: 'system.read' },
  { key: 'users', label: 'Users & roles', permission: 'user.read' },
  { key: 'opportunities', label: 'Opportunities', permission: 'opportunity.read_all' },
  { key: 'exams', label: 'Exams', permission: 'exam.read' },
  { key: 'quality', label: 'Data quality', permission: 'opportunity.read_all' },
  { key: 'audit', label: 'Audit log', permission: 'audit.read' },
  { key: 'config', label: 'Configuration', permission: 'system.read' },
];

export default function AdminPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [denied, setDenied] = useState(false);
  const [needsMfa, setNeedsMfa] = useState(false);

  useEffect(() => {
    api
      .get<MeResponse>('/api/auth/me')
      .then((data) => {
        setMe(data);
        if (!data.user.permissions.includes('system.read') && !data.user.permissions.includes('audit.read')) setDenied(true);
      })
      .catch(() => setDenied(true));
  }, []);

  // The server gates privileged reads behind a second factor. Detect that specific refusal
  // and route to enrolment/verification instead of reporting a generic permission error.
  useEffect(() => {
    if (!me || denied) return;
    api
      .get('/api/admin/overview')
      .then(() => undefined)
      .catch((err) => {
        if (err instanceof ApiClientError && err.code === 'mfa_required') setNeedsMfa(true);
      });
  }, [me, denied]);

  if (needsMfa) {
    return (
      <AppShell>
        <PageHeader title="Administration" />
        <EmptyState
          icon={ShieldCheck}
          title="Two-factor verification required"
          description="Your role can reach administrative data, but privileged actions require a second factor verified on this session. Enrol or verify to continue."
          action={
            <Link href="/mfa" className="btn-primary">
              <ShieldCheck className="h-4 w-4" /> Verify with your authenticator
            </Link>
          }
        />
      </AppShell>
    );
  }

  if (denied) {
    return (
      <AppShell>
        <PageHeader title="Administration" />
        <EmptyState
          icon={ShieldCheck}
          title="You do not have access to this area"
          description="Administrative panels are restricted by role. Your account does not carry the required permissions, and the server enforces this independently of the UI."
        />
      </AppShell>
    );
  }

  if (!me) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  const visible = TABS.filter((item) => me.user.permissions.includes(item.permission));

  return (
    <AppShell>
      <PageHeader title="Administration" subtitle={`Signed in as ${me.user.roleLabel} · ${me.user.permissions.length} permissions`} />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {visible.map((item) => (
          <button key={item.key} onClick={() => setTab(item.key)} className={clsx('badge', tab === item.key ? 'tone-brand' : 'tone-neutral')}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? <Overview /> : null}
      {tab === 'users' ? <Users /> : null}
      {tab === 'opportunities' ? <Opportunities /> : null}
      {tab === 'exams' ? <Exams /> : null}
      {tab === 'quality' ? <Quality /> : null}
      {tab === 'audit' ? <Audit /> : null}
      {tab === 'config' ? <Config /> : null}
    </AppShell>
  );
}

function Overview() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api.get('/api/admin/overview').then(setData).catch(() => undefined);
  }, []);
  if (!data) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="card-pad">
          <p className="text-xs uppercase tracking-wide text-ink-500">Stale records</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink-900">{data.freshness.staleRecords}</p>
          <p className="muted text-xs">not verified in 72h</p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs uppercase tracking-wide text-ink-500">Expired but active</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink-900">{data.freshness.expiredButActive}</p>
          <p className="muted text-xs">deadline passed, still listed</p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs uppercase tracking-wide text-ink-500">Duplicate groups</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink-900">{data.duplicateGroups.length}</p>
          <p className="muted text-xs">need review</p>
        </Card>
        <Card className="card-pad">
          <p className="text-xs uppercase tracking-wide text-ink-500">Open data issues</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink-900">{data.dataQuality.reduce((sum: number, row: any) => sum + row.count, 0)}</p>
          <p className="muted text-xs">across all kinds</p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="card-pad">
          <SectionHeading icon={UsersIcon} title="Users by role" />
          <table className="w-full">
            <tbody className="divide-y divide-ink-100">
              {data.users.map((row: any) => (
                <tr key={`${row.role}-${row.status}`}>
                  <td className="table-td capitalize">{row.role}</td>
                  <td className="table-td">{row.status}</td>
                  <td className="table-td text-right tabular-nums">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Database} title="Verification status" />
          <table className="w-full">
            <tbody className="divide-y divide-ink-100">
              {data.verification.map((row: any) => (
                <tr key={row.status}>
                  <td className="table-td">{row.status.replace(/_/g, ' ')}</td>
                  <td className="table-td text-right tabular-nums">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Activity} title="Search failures" subtitle="Provider health" />
          {data.searchFailures.length === 0 ? (
            <p className="muted">No search failures recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.searchFailures.map((row: any) => (
                <li key={`${row.provider}-${row.status}`} className="flex justify-between gap-2">
                  <span className="text-ink-800">
                    {row.provider} · {row.status}
                  </span>
                  <span className="tabular-nums text-ink-500">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Activity} title="AI usage" />
          {data.aiUsage.length === 0 ? (
            <p className="muted">No AI calls recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.aiUsage.map((row: any) => (
                <li key={`${row.provider}-${row.status}`} className="flex justify-between gap-2">
                  <span className="text-ink-800">
                    {row.provider} · {row.status}
                  </span>
                  <span className="tabular-nums text-ink-500">
                    {row.calls} calls · {row.tokensIn + row.tokensOut} tokens
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="card-pad lg:col-span-2">
          <SectionHeading icon={ShieldCheck} title="Security events" />
          {data.securityEvents.length === 0 ? (
            <p className="muted">No security events recorded.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.securityEvents.map((row: any) => (
                <Badge key={row.event} tone="neutral">
                  {row.event} · {row.count}
                </Badge>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<any>('/api/admin/users')
      .then((data) => {
        setRows(data.users);
        setRoles(data.roles);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load users.'));
  }, []);

  useEffect(load, [load]);

  const changeRole = async (user: any, role: string) => {
    setBusy(user.id);
    setError(null);
    try {
      const privileged = ['admin', 'super_admin', 'analyst'].includes(role);
      await api.patch('/api/admin/users', { userId: user.id, role, confirm: privileged, reason: 'role change from admin panel' });
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not change role.');
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (user: any, status: string) => {
    setBusy(user.id);
    setError(null);
    try {
      await api.patch('/api/admin/users', { userId: user.id, status, reason: 'status change from admin panel' });
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not change status.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="card-pad">
      <SectionHeading icon={UsersIcon} title="Users & role management" subtitle="Every change is audited and revokes the target's sessions" />
      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-b border-ink-200 bg-ink-50">
            <tr>
              <th className="table-th">User</th>
              <th className="table-th">Role</th>
              <th className="table-th">Status</th>
              <th className="table-th">Sessions</th>
              <th className="table-th">Last login</th>
              <th className="table-th"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((user) => (
              <tr key={user.id} className="hover:bg-ink-50/60">
                <td className="table-td">
                  <p className="font-medium text-ink-900">{user.name || '—'}</p>
                  <p className="muted text-xs">{user.email}</p>
                </td>
                <td className="table-td">
                  <select className="input max-w-[150px]" value={user.role} disabled={busy === user.id} onChange={(event) => void changeRole(user, event.target.value)}>
                    {roles.map((role) => (
                      <option key={role.key} value={role.key}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="table-td">
                  <Badge tone={user.status === 'active' ? 'success' : user.status === 'suspended' ? 'danger' : 'muted'}>{user.status}</Badge>
                </td>
                <td className="table-td tabular-nums">{user.activeSessions}</td>
                <td className="table-td text-xs text-ink-500">{user.last_login_at ? new Date(user.last_login_at).toLocaleString('en-IN') : 'never'}</td>
                <td className="table-td">
                  {user.status === 'active' ? (
                    <button onClick={() => void setStatus(user, 'suspended')} disabled={busy === user.id} className="btn-ghost btn-sm text-red-600">
                      Suspend
                    </button>
                  ) : (
                    <button onClick={() => void setStatus(user, 'active')} disabled={busy === user.id} className="btn-ghost btn-sm text-emerald-700">
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-3 text-xs">
        Escalation protection: you cannot change your own role, only a super admin can grant or remove privileged roles, and
        privileged changes require explicit confirmation.
      </p>
    </Card>
  );
}

function Opportunities() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [verification, setVerification] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    if (verification) search.set('verification', verification);
    api
      .get<any>(`/api/admin/opportunities?${search.toString()}`)
      .then((data) => setRows(data.opportunities))
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load opportunities.'));
  }, [q, verification]);

  useEffect(load, [load]);

  const patch = async (id: string, body: any) => {
    setError(null);
    try {
      await api.patch('/api/admin/opportunities', { id, ...body, reason: 'admin correction' });
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Update failed.');
    }
  };

  return (
    <Card className="card-pad">
      <SectionHeading icon={Database} title="Opportunity moderation" subtitle="Correct records, re-verify, or archive" />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search title or organisation" value={q} onChange={(event) => setQ(event.target.value)} />
        <select className="input max-w-[180px]" value={verification} onChange={(event) => setVerification(event.target.value)}>
          <option value="">All verification</option>
          <option value="verified">Verified</option>
          <option value="needs_verification">Needs verification</option>
          <option value="conflicting">Conflicting</option>
          <option value="suspicious">Suspicious</option>
        </select>
      </div>
      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="border-b border-ink-200 bg-ink-50">
            <tr>
              <th className="table-th">Title</th>
              <th className="table-th">Type</th>
              <th className="table-th">Status</th>
              <th className="table-th">Verification</th>
              <th className="table-th">Deadline</th>
              <th className="table-th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-ink-50/60">
                <td className="table-td">
                  <p className="font-medium text-ink-900">{row.title}</p>
                  <p className="muted text-xs">{row.organization}</p>
                  {row.is_demo ? <Badge tone="muted">demo</Badge> : null}
                </td>
                <td className="table-td text-xs">{row.type?.replace(/_/g, ' ')}</td>
                <td className="table-td">
                  <StatusBadge status={row.status} />
                </td>
                <td className="table-td">
                  <select
                    className="input max-w-[150px]"
                    value={row.verification_status}
                    onChange={(event) => void patch(row.id, { verificationStatus: event.target.value })}
                  >
                    <option value="verified">verified</option>
                    <option value="needs_verification">needs_verification</option>
                    <option value="conflicting">conflicting</option>
                    <option value="suspicious">suspicious</option>
                  </select>
                  <div className="mt-1">
                    <TrustBadge score={Number(row.trust_score ?? 0)} status={row.verification_status} official={Boolean(row.official_source)} />
                  </div>
                </td>
                <td className="table-td text-xs">{row.application_deadline ? new Date(row.application_deadline).toLocaleDateString('en-IN') : '—'}</td>
                <td className="table-td">
                  <button onClick={() => void patch(row.id, { isActive: false })} className="btn-ghost btn-sm text-red-600">
                    Archive
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Exams() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<any>('/api/admin/exams').then((data) => setRows(data.exams)).catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load exams.'));
  }, []);

  useEffect(load, [load]);

  const patch = async (id: string, body: any) => {
    setError(null);
    try {
      await api.patch('/api/admin/exams', { id, ...body, reason: 'admin correction' });
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Update failed.');
    }
  };

  return (
    <Card className="card-pad">
      <SectionHeading icon={ScrollText} title="Examination moderation" subtitle="Analysts and admins only — recruiters are blocked" />
      {error ? <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead className="border-b border-ink-200 bg-ink-50">
            <tr>
              <th className="table-th">Examination</th>
              <th className="table-th">Status</th>
              <th className="table-th">Application window</th>
              <th className="table-th">Exam date</th>
              <th className="table-th">Vacancies</th>
              <th className="table-th">Last verified</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-ink-50/60">
                <td className="table-td">
                  <p className="font-medium text-ink-900">{row.exam_name}</p>
                  <p className="muted text-xs">{row.organization}</p>
                </td>
                <td className="table-td">
                  <StatusBadge status={row.status} />
                </td>
                <td className="table-td text-xs">
                  <input
                    type="date"
                    className="input mb-1"
                    value={row.application_start ? row.application_start.slice(0, 10) : ''}
                    onChange={(event) => void patch(row.id, { applicationStart: event.target.value ? new Date(event.target.value).toISOString() : null })}
                  />
                  <input
                    type="date"
                    className="input"
                    value={row.application_deadline ? row.application_deadline.slice(0, 10) : ''}
                    onChange={(event) => void patch(row.id, { applicationDeadline: event.target.value ? new Date(event.target.value).toISOString() : null })}
                  />
                </td>
                <td className="table-td">
                  <input
                    type="date"
                    className="input"
                    value={row.exam_date ? row.exam_date.slice(0, 10) : ''}
                    onChange={(event) => void patch(row.id, { examDate: event.target.value ? new Date(event.target.value).toISOString() : null })}
                  />
                </td>
                <td className="table-td">
                  <input
                    type="number"
                    className="input max-w-[100px]"
                    value={row.vacancies ?? ''}
                    onChange={(event) => void patch(row.id, { vacancies: event.target.value ? Number(event.target.value) : null })}
                  />
                </td>
                <td className="table-td text-xs text-ink-500">{row.last_verified ? new Date(row.last_verified).toLocaleDateString('en-IN') : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Quality() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<any>('/api/admin/data-quality').then(setData).catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load data quality.'));
  }, []);

  useEffect(load, [load]);

  const resolve = async (issueId: string) => {
    await api.post('/api/admin/data-quality', { issueId, reason: 'reviewed in admin panel' });
    load();
  };

  const merge = async (mergeInto: string, mergeFrom: string[]) => {
    setError(null);
    try {
      await api.post('/api/admin/data-quality', { mergeInto, mergeFrom, reason: 'duplicate merge from admin panel' });
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Merge failed.');
    }
  };

  if (!data) return <Spinner />;

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <Card className="card-pad">
        <SectionHeading icon={AlertTriangle} title="Open data quality issues" subtitle={`${data.issues.length} unresolved`} />
        {data.issues.length === 0 ? (
          <p className="muted">No open issues.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.issues.map((issue: any) => (
              <li key={issue.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900">{issue.title ?? issue.exam_name ?? 'Record'}</p>
                  <p className="muted text-xs">
                    {issue.kind.replace(/_/g, ' ')} · {issue.severity} · {new Date(issue.created_at).toLocaleDateString('en-IN')}
                  </p>
                  <p className="muted mt-0.5 text-xs">{issue.detail}</p>
                </div>
                <button onClick={() => void resolve(issue.id)} className="btn-secondary btn-sm shrink-0">
                  Resolve
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="card-pad">
        <SectionHeading icon={GitMerge} title="Duplicate groups" subtitle={`${data.duplicateGroups.length} group(s) detected live`} />
        {data.duplicateGroups.length === 0 ? (
          <p className="muted">No duplicate groups detected.</p>
        ) : (
          <ul className="space-y-3">
            {data.duplicateGroups.map((group: any) => (
              <li key={group.key} className="rounded-lg border border-ink-200 p-3">
                <p className="text-sm font-medium text-ink-900">
                  {group.representative.title} — {group.representative.organization}
                </p>
                <p className="muted text-xs">
                  {group.sourceCount} source(s) · key {group.key}
                </p>
                <ul className="mt-2 space-y-1">
                  {group.members.map((member: any) => (
                    <li key={member.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-700">
                        {member.title} · {member.organization} · trust {Math.round(member.trustScore)}
                      </span>
                      {member.isRepresentative ? <Badge tone="brand">canonical</Badge> : null}
                    </li>
                  ))}
                </ul>
                {group.conflicts.length ? <p className="mt-1 text-xs text-amber-700">Conflicting fields: {group.conflicts.join(', ')}</p> : null}
                <button
                  onClick={() => void merge(group.representative.id, group.members.filter((member: any) => !member.isRepresentative).map((member: any) => member.id))}
                  className="btn-secondary btn-sm mt-2"
                >
                  Merge into canonical
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="card-pad">
          <SectionHeading title="Needs re-verification" subtitle={`${data.stale.length} record(s) past their next check`} />
          {data.stale.length === 0 ? (
            <p className="muted">Nothing is overdue.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.stale.map((row: any) => (
                <li key={row.id} className="flex justify-between gap-2">
                  <span className="truncate text-ink-800">{row.title}</span>
                  <span className="shrink-0 text-xs text-ink-500">{row.last_verified ? new Date(row.last_verified).toLocaleDateString('en-IN') : 'never'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="card-pad">
          <SectionHeading title="Missing official source" subtitle={`${data.missingOfficialSource.length} record(s)`} />
          {data.missingOfficialSource.length === 0 ? (
            <p className="muted">Every active record has an official source.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {data.missingOfficialSource.map((row: any) => (
                <li key={row.id} className="flex justify-between gap-2">
                  <span className="truncate text-ink-800">{row.title}</span>
                  <span className="shrink-0 text-xs text-ink-500">{row.verification_status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Audit() {
  const [data, setData] = useState<any>(null);
  const [action, setAction] = useState('');
  useEffect(() => {
    const search = action ? `?action=${encodeURIComponent(action)}` : '';
    api.get<any>(`/api/admin/audit${search}`).then(setData).catch(() => undefined);
  }, [action]);
  if (!data) return <Spinner />;

  return (
    <div className="space-y-5">
      <Card className="card-pad">
        <SectionHeading icon={ShieldCheck} title="Audit log" subtitle={`${data.total} immutable entries`} />
        <select className="input max-w-xs mb-3" value={action} onChange={(event) => setAction(event.target.value)}>
          <option value="">All actions</option>
          {data.actions.map((row: any) => (
            <option key={row.action} value={row.action}>
              {row.action} ({row.count})
            </option>
          ))}
        </select>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-ink-200 bg-ink-50">
              <tr>
                <th className="table-th">When</th>
                <th className="table-th">Actor</th>
                <th className="table-th">Action</th>
                <th className="table-th">Resource</th>
                <th className="table-th">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {data.entries.map((entry: any) => (
                <tr key={entry.id}>
                  <td className="table-td text-xs text-ink-500">{entry.createdAtAgo}</td>
                  <td className="table-td text-xs">
                    {entry.actor_email ?? 'system'}
                    {entry.actor_role ? <span className="muted"> · {entry.actor_role}</span> : null}
                  </td>
                  <td className="table-td text-xs font-medium">{entry.action}</td>
                  <td className="table-td text-xs">
                    {entry.resource_type}
                    {entry.resource_id ? <span className="muted"> · {entry.resource_id.slice(0, 8)}</span> : null}
                  </td>
                  <td className="table-td text-xs text-ink-600">
                    {entry.previous_value || entry.new_value ? (
                      <span className="font-mono text-[11px]">
                        {entry.previous_value ? `${String(entry.previous_value).slice(0, 60)} → ` : ''}
                        {entry.new_value ? String(entry.new_value).slice(0, 60) : ''}
                      </span>
                    ) : (
                      entry.reason || '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="card-pad">
        <SectionHeading icon={ShieldCheck} title="Security events" />
        {data.security.length === 0 ? (
          <p className="muted">No security events recorded.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {data.security.map((row: any) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink-800">
                  <Badge tone="neutral">{row.event}</Badge> <span className="muted ml-1.5">{row.detail}</span>
                </span>
                <span className="shrink-0 text-xs text-ink-500">{row.createdAtAgo}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Config() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<any>('/api/admin/config'));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not load configuration.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFlag = async (flag: string, enabled: boolean) => {
    setError(null);
    try {
      await api.put('/api/admin/config', { flag, enabled, reason: 'feature flag changed from the admin panel' });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not change the feature flag.');
    }
  };

  if (!data) return error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : <Spinner />;

  const categories: string[] = [...new Set<string>(data.settings.map((setting: any) => setting.category))];

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <Card className="card-pad">
        <SectionHeading title="Environment" subtitle="Secrets are never returned to the browser — only whether they are set" />
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data.envSummary).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2 rounded-lg bg-ink-50 px-3 py-2">
              <dt className="text-ink-500">{key}</dt>
              <dd className="text-ink-900">{String(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={data.ai.configured ? 'success' : 'warning'}>AI: {data.ai.provider ?? 'heuristic fallback'}</Badge>
          <Badge tone={data.search.live ? 'success' : 'warning'}>Search: {data.search.mode.join(', ')}</Badge>
        </div>
      </Card>

      {categories.map((category) => (
        <Card key={category} className="card-pad">
          <SectionHeading title={`${category.charAt(0).toUpperCase()}${category.slice(1)} settings`} subtitle="Saved values take effect within seconds. Each change is audited with its previous value." />
          <div className="divide-y divide-ink-100">
            {data.settings
              .filter((setting: any) => setting.category === category)
              .map((setting: any) => (
                <SettingRow key={setting.key} setting={setting} onSaved={load} onError={setError} />
              ))}
          </div>
        </Card>
      ))}

      <Card className="card-pad">
        <SectionHeading title="Feature flags" subtitle="Super admin only — audited" />
        <div className="divide-y divide-ink-100">
          {data.featureFlags.map((flag: any) => (
            <div key={flag.key} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-900">{flag.label}</p>
                <p className="muted text-xs">{flag.description}</p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-400">{flag.key}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={flag.enabled}
                aria-label={`${flag.label}: ${flag.enabled ? 'on' : 'off'}`}
                onClick={() => void toggleFlag(flag.key, !flag.enabled)}
                className={flag.enabled ? 'btn-primary btn-sm shrink-0' : 'btn-secondary btn-sm shrink-0'}
              >
                {flag.enabled ? 'On' : 'Off'}
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SettingRow({ setting, onSaved, onError }: { setting: any; onSaved: () => Promise<void>; onError: (message: string | null) => void }) {
  const [value, setValue] = useState<string>(setting.value);
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(setting.value), [setting.value]);
  const dirty = value !== setting.value;

  const save = async () => {
    setBusy(true);
    onError(null);
    try {
      await api.put('/api/admin/config', { key: setting.key, value, reason: 'changed from the admin panel' });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiClientError ? err.message : 'Could not save this setting.');
    } finally {
      setBusy(false);
    }
  };

  const id = `setting-${setting.key}`;
  const input =
    setting.type === 'enum' || setting.type === 'bool' ? (
      <select id={id} className="input max-w-[220px]" value={value} disabled={setting.locked} onChange={(event) => setValue(event.target.value)}>
        {(setting.type === 'bool' ? ['true', 'false'] : setting.options).map((option: string) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : setting.type === 'weights' ? (
      <textarea id={id} className="input h-20 max-w-md font-mono text-xs" value={value} disabled={setting.locked} onChange={(event) => setValue(event.target.value)} />
    ) : (
      <input
        id={id}
        className="input max-w-md"
        value={value}
        disabled={setting.locked}
        inputMode={setting.type === 'int' ? 'numeric' : undefined}
        onChange={(event) => setValue(event.target.value)}
      />
    );

  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-ink-900">
          {setting.label}
        </label>
        <p className="muted text-xs">{setting.description}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
          <span className="font-mono">{setting.key}</span>
          {setting.min !== null && setting.max !== null ? <span>range {setting.min}–{setting.max}</span> : null}
          <Badge tone={setting.source === 'environment' ? 'warning' : setting.source === 'database' ? 'info' : 'muted'}>
            {setting.source === 'environment' ? `fixed by ${setting.envVar}` : setting.source === 'database' ? 'set here' : 'default'}
          </Badge>
        </p>
        {setting.locked ? (
          <p className="mt-1 text-xs text-amber-700">Set by an environment variable, which takes precedence. Change or remove {setting.envVar} to edit it here.</p>
        ) : null}
      </div>
      <div className="flex items-start gap-2">
        {input}
        <button type="button" className="btn-primary btn-sm" disabled={!dirty || busy || setting.locked} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
