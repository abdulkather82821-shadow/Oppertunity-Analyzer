'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, LogOut, Shield, Trash2, UserCircle2 } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, Disclaimer, SectionHeading, Spinner } from '@/components/ui';
import { api, ApiClientError, type MeResponse } from '@/lib/client/api';
import { browserPermission, requestBrowserPermission, type BrowserPermission } from '@/lib/client/browser-notifications';

const LOCATIONS = ['India', 'Tamil Nadu', 'Chennai', 'Coimbatore', 'Thanjavur', 'Salem', 'Madurai', 'Bengaluru', 'Hyderabad', 'Mumbai', 'Delhi', 'Remote'];
const JOB_TYPES = ['job', 'internship', 'graduate_job', 'fresher_job', 'remote_job', 'hybrid_job', 'contract', 'government_job', 'exam', 'apprenticeship', 'trainee'];
const WEIGHTS: { key: string; label: string }[] = [
  { key: 'skill', label: 'Skill match' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'experience', label: 'Experience' },
  { key: 'role', label: 'Role relevance' },
  { key: 'location', label: 'Location' },
  { key: 'industry', label: 'Industry' },
  { key: 'salary', label: 'Salary' },
  { key: 'careerGrowth', label: 'Career growth' },
];
const DEFAULT_WEIGHTS: Record<string, number> = { skill: 30, qualification: 20, experience: 15, role: 15, location: 5, industry: 5, salary: 5, careerGrowth: 5 };

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [settings, setSettings] = useState<any>({
    preferredLocations: ['India'],
    preferredJobTypes: [],
    salaryMin: null,
    salaryMax: null,
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    dateFormat: 'en-IN',
    notifyDeadline: true,
    notifyNewMatch: true,
    notifyExam: true,
    notifyBrowser: false,
    notifyEmail: false,
    digestDaily: true,
    digestWeekly: false,
    scoringWeights: DEFAULT_WEIGHTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumes, setResumes] = useState<any[]>([]);
  const [defaultWeights, setDefaultWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS);
  const [emailInfo, setEmailInfo] = useState<{ available: boolean; provider: string | null; reason: string | null } | null>(null);
  const [browserState, setBrowserState] = useState<BrowserPermission>('default');
  const [browserNote, setBrowserNote] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<MeResponse>('/api/auth/me'),
      api.get<any>('/api/settings'),
      api.get<{ resumes: any[] }>('/api/resumes'),
      // Only used to learn whether this server can actually send email.
      api.get<{ email: { available: boolean; provider: string | null; reason: string | null } }>('/api/notifications').catch(() => null),
    ])
      .then(([meData, settingsData, resumeData, notificationData]) => {
        setMe(meData);
        if (notificationData) setEmailInfo(notificationData.email);
        setBrowserState(browserPermission());
        const serverDefaults = settingsData.defaults?.scoringWeights ?? DEFAULT_WEIGHTS;
        setDefaultWeights(serverDefaults);
        if (settingsData.settings) setSettings((prev: any) => ({ ...prev, ...settingsData.settings, scoringWeights: { ...serverDefaults, ...(settingsData.settings.scoringWeights ?? {}) } }));
        else setSettings((prev: any) => ({ ...prev, scoringWeights: serverDefaults }));
        setResumes(resumeData.resumes);
      })
      .catch((err) => setError(err instanceof ApiClientError ? err.message : 'Could not load settings.'))
      .finally(() => setLoading(false));
  }, []);

  /** Switching browser alerts on must actually obtain permission; otherwise the toggle would lie. */
  const toggleSetting = async (key: string, checked: boolean) => {
    if (key === 'notifyBrowser' && checked) {
      const permission = await requestBrowserPermission();
      setBrowserState(permission);
      if (permission !== 'granted') {
        setBrowserNote(
          permission === 'unsupported'
            ? 'This browser does not support notifications.'
            : 'Permission was not granted, so browser notifications stay off. You can allow them in your browser settings.',
        );
        setSettings((prev: any) => ({ ...prev, notifyBrowser: false }));
        return;
      }
      setBrowserNote(null);
    }
    setSettings((prev: any) => ({ ...prev, [key]: checked }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch('/api/settings', settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const deleteResume = async (id: string) => {
    if (!confirm('Delete this resume permanently? The extracted text and profile derived from it will remain until you delete your account.')) return;
    await api.delete(`/api/resumes/${id}`);
    setResumes(resumes.filter((resume) => resume.id !== id));
  };

  const deleteAccount = async () => {
    if (!confirm('Delete your account and ALL associated data permanently? This cannot be undone.')) return;
    if (!confirm('Are you certain? Resumes, profile, saved items, applications and feedback will all be erased.')) return;
    try {
      await api.delete('/api/account');
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not delete your account.');
    }
  };

  const logout = async () => {
    await api.post('/api/auth/logout');
    router.push('/login');
    router.refresh();
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

  const total = Object.values(settings.scoringWeights as Record<string, number>).reduce((sum, value) => sum + value, 0);

  return (
    <AppShell>
      <PageHeader
        title="Settings"
        subtitle="Preferences, notifications, scoring weights and data controls"
        actions={
          <button onClick={() => void save()} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        }
      />

      {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="card-pad">
          <SectionHeading icon={UserCircle2} title="Account" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Name</dt>
              <dd className="text-ink-900">{me?.user?.name || 'Not set'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Email</dt>
              <dd className="text-ink-900">{me?.user?.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Role</dt>
              <dd className="text-ink-900">{me?.user?.roleLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Two-factor</dt>
              <dd className="text-ink-900">{me?.user?.mfaRequired ? 'Required for this role' : 'Not required'}</dd>
            </div>
          </dl>
          <button onClick={() => void logout()} className="btn-secondary mt-4 w-full">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </Card>

        <Card className="card-pad">
          <SectionHeading title="Preferences" />
          <div className="space-y-4">
            <div>
              <p className="label">Preferred locations</p>
              <div className="flex flex-wrap gap-1.5">
                {LOCATIONS.map((location) => (
                  <button
                    key={location}
                    type="button"
                    onClick={() => setSettings({ ...settings, preferredLocations: toggle(settings.preferredLocations, location) })}
                    className={`badge ${settings.preferredLocations.includes(location) ? 'tone-brand' : 'tone-neutral'}`}
                  >
                    {location}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Preferred opportunity types</p>
              <div className="flex flex-wrap gap-1.5">
                {JOB_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSettings({ ...settings, preferredJobTypes: toggle(settings.preferredJobTypes, type) })}
                    className={`badge ${settings.preferredJobTypes.includes(type) ? 'tone-brand' : 'tone-neutral'}`}
                  >
                    {type.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="salaryMin">Minimum salary (₹/yr)</label>
                <input
                  id="salaryMin"
                  type="number"
                  className="input"
                  value={settings.salaryMin ?? ''}
                  onChange={(event) => setSettings({ ...settings, salaryMin: event.target.value ? Number(event.target.value) : null })}
                />
              </div>
              <div>
                <label className="label" htmlFor="salaryMax">Maximum salary (₹/yr)</label>
                <input
                  id="salaryMax"
                  type="number"
                  className="input"
                  value={settings.salaryMax ?? ''}
                  onChange={(event) => setSettings({ ...settings, salaryMax: event.target.value ? Number(event.target.value) : null })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="timezone">Timezone</label>
                <input id="timezone" className="input" value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="dateFormat">Date format</label>
                <select id="dateFormat" className="input" value={settings.dateFormat} onChange={(event) => setSettings({ ...settings, dateFormat: event.target.value })}>
                  <option value="en-IN">31 Dec 2026 (Indian)</option>
                  <option value="en-GB">31/12/2026</option>
                  <option value="en-US">12/31/2026</option>
                </select>
              </div>
            </div>
          </div>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Bell} title="Notifications" />
          <div className="space-y-2.5">
            {[
              ['notifyDeadline', 'Deadline reminders', 'Before an application window closes'],
              ['notifyNewMatch', 'New high matches', 'When a strong new opportunity appears'],
              ['notifyExam', 'Exam updates', 'Admit cards, results and stage changes'],
              [
                'notifyBrowser',
                'Browser notifications',
                me?.features?.browserNotifications === false
                  ? 'Turned off by the administrator.'
                  : browserState === 'unsupported'
                  ? 'This browser does not support notifications.'
                  : browserState === 'denied'
                    ? 'Blocked — allow notifications for this site in your browser settings first.'
                    : browserState === 'granted'
                      ? 'Shown while the app is open in a tab. (Not background push.)'
                      : 'You will be asked for permission when you switch this on. Shown while the app is open in a tab.',
              ],
              [
                'notifyEmail',
                'Email notifications',
                emailInfo === null || emailInfo.available
                  ? 'Deadline reminders and digests to your account email.'
                  : 'Not available: this server has no email provider configured. Alerts still appear in the app.',
              ],
              ['digestDaily', 'Daily digest', '“Today\'s Opportunities” every morning'],
              ['digestWeekly', 'Weekly digest', 'A summary every Monday'],
            ].map(([key, label, hint]) => {
              const unavailable =
                (key === 'notifyEmail' && emailInfo !== null && !emailInfo.available) ||
                (key === 'notifyBrowser' && (me?.features?.browserNotifications === false || browserState === 'unsupported' || browserState === 'denied'));
              return (
                <label
                  key={key as string}
                  className={`flex items-start justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2.5 ${unavailable ? 'opacity-70' : ''}`}
                >
                  <span>
                    <span className="block text-sm font-medium text-ink-800">{label as string}</span>
                    <span className={`block text-xs ${unavailable ? 'text-amber-700' : 'muted'}`}>{hint as string}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-brand-600"
                    disabled={unavailable}
                    checked={Boolean(settings[key as string]) && !unavailable}
                    onChange={(event) => void toggleSetting(key as string, event.target.checked)}
                  />
                </label>
              );
            })}
            {browserNote ? <p className="text-xs text-amber-700">{browserNote}</p> : null}
          </div>
        </Card>

        <Card className="card-pad">
          <SectionHeading title="Matching weights" subtitle={`Total ${total} — they are normalised automatically`} />
          <div className="space-y-3">
            {WEIGHTS.map((weight) => (
              <div key={weight.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-sm text-ink-700" htmlFor={`weight-${weight.key}`}>
                    {weight.label}
                  </label>
                  <span className="text-xs tabular-nums text-ink-500">{settings.scoringWeights[weight.key] ?? 0}</span>
                </div>
                <input
                  id={`weight-${weight.key}`}
                  type="range"
                  min={0}
                  max={40}
                  className="w-full accent-brand-600"
                  value={settings.scoringWeights[weight.key] ?? 0}
                  onChange={(event) =>
                    setSettings({ ...settings, scoringWeights: { ...settings.scoringWeights, [weight.key]: Number(event.target.value) } })
                  }
                />
              </div>
            ))}
          </div>
          <button onClick={() => setSettings({ ...settings, scoringWeights: defaultWeights })} className="btn-ghost btn-sm mt-3">
            Reset to defaults
          </button>
          <p className="muted mt-2 text-xs">Government examinations always use the separate eligibility-focused model, regardless of these weights.</p>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Shield} title="Integrations" subtitle="Configured via environment variables" />
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">AI provider</dt>
              <dd className="text-ink-900">
                {me?.integrations.ai.configured ? (
                  <Badge tone="success">
                    {me.integrations.ai.provider} · {me.integrations.ai.model}
                  </Badge>
                ) : (
                  <Badge tone="warning">heuristic fallback</Badge>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Search</dt>
              <dd className="text-ink-900">
                {me?.integrations.search.live ? <Badge tone="success">{me.integrations.search.mode.join(', ')}</Badge> : <Badge tone="warning">offline catalogue</Badge>}
              </dd>
            </div>
          </dl>
          <p className="muted mt-3 text-xs">
            Without an AI key the platform still runs: profiling, matching, eligibility and ranking all have deterministic paths.
            Set <code className="rounded bg-ink-100 px-1">AI_API_KEY</code> and <code className="rounded bg-ink-100 px-1">SEARCH_API_KEY</code> to enable live providers.
          </p>
        </Card>

        <Card className="card-pad border-red-200">
          <SectionHeading icon={Trash2} title="Your data" subtitle="Encrypted at rest, never shared publicly" />
          {resumes.length ? (
            <ul className="divide-y divide-ink-100">
              {resumes.map((resume) => (
                <li key={resume.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm text-ink-800">{resume.original_name}</span>
                  <button onClick={() => void deleteResume(resume.id)} className="btn-ghost btn-sm text-red-600">
                    Delete resume
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No resumes on file.</p>
          )}
          <Link href="/upload" className="btn-secondary mt-3 w-full">
            Manage resumes
          </Link>
          <button onClick={() => void deleteAccount()} className="btn-danger mt-2 w-full">
            <Trash2 className="h-4 w-4" /> Delete my account
          </button>
          <p className="muted mt-2 text-xs">
            Removes your resumes from disk, then every row owned by your account, and revokes all sessions. This cannot be undone.
          </p>
        </Card>
      </div>

      <Disclaimer />
    </AppShell>
  );
}
