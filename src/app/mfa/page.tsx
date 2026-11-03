'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiClientError } from '@/lib/client/api';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Card, SectionHeading } from '@/components/ui';

/**
 * Two-factor enrolment and verification.
 *
 * Privileged roles cannot reach admin actions until their *session* is second-factor
 * verified. This page is where that happens: enrol to get a secret, scan it in any TOTP
 * app, then submit the 6-digit code.
 */
export default function MfaPage() {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .get<{ user: { mfaRequired: boolean } }>('/api/auth/me')
      .then((me) => setMfaRequired(me.user?.mfaRequired ?? false))
      .catch(() => undefined);
  }, []);

  const enrol = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ secret: string; otpauthUri: string }>('/api/auth/mfa/enroll');
      setSecret(result.secret);
      setOtpauth(result.otpauthUri);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not start enrolment.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/auth/mfa/verify', { code });
      setDone(true);
      setTimeout(() => router.push('/admin'), 600);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Two-factor verification"
        subtitle={
          mfaRequired
            ? 'Your role requires a second factor before administrative actions are permitted. Verification applies to this session only.'
            : 'Your role does not require a second factor, but you can enrol one here.'
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="card-pad">
          <SectionHeading icon={KeyRound} title="1. Enrol your authenticator" />
          {secret ? (
            <div className="space-y-3">
              <p className="muted text-sm">
                Add this secret to any TOTP app (Google Authenticator, Authy, 1Password, FreeOTP):
              </p>
              <code className="block break-all rounded-lg bg-ink-100 px-3 py-2 font-mono text-sm text-ink-900">{secret}</code>
              {otpauth ? (
                <div>
                  <p className="label">Or open this URI on the same device</p>
                  <code className="block break-all rounded-lg bg-ink-100 px-3 py-2 font-mono text-[11px] text-ink-700">{otpauth}</code>
                </div>
              ) : null}
              <p className="muted text-xs">
                Store the secret somewhere safe. Re-enrolling replaces it and invalidates your existing app entry.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="muted text-sm">
                You do not have a second factor enrolled on this account yet. Enrolment generates a TOTP secret that is
                stored encrypted on the server.
              </p>
              <button onClick={() => void enrol()} disabled={busy} className="btn-primary">
                {busy ? 'Generating…' : 'Generate a secret'}
              </button>
            </div>
          )}
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={ShieldCheck} title="2. Verify a code" />
          {done ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Verified. Taking you to the admin panel…
            </p>
          ) : (
            <form onSubmit={verify} className="space-y-3">
              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
              <div>
                <label className="label" htmlFor="code">
                  6-digit code
                </label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  className="input max-w-[180px] font-mono text-lg tracking-[0.4em]"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                />
              </div>
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary">
                {busy ? 'Verifying…' : 'Verify and continue'}
              </button>
              <p className="muted text-xs">
                Codes are valid for 30 seconds. Verification is rate-limited, so repeated guesses will be temporarily
                blocked.
              </p>
            </form>
          )}
        </Card>
      </div>

      <Card className="card-pad mt-5">
        <SectionHeading title="Why this is required" />
        <p className="text-sm leading-relaxed text-ink-700">
          Roles with administrative permissions can change other users&apos; roles, edit live opportunity data, alter
          platform configuration and read the audit trail. Those actions are gated behind a second factor that is verified
          per session — a compromised password alone is not enough. Every privileged action is written to an immutable
          audit log with the actor, the previous value and the new value.
        </p>
      </Card>
    </AppShell>
  );
}
