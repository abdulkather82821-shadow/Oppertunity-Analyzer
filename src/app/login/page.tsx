'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Target } from 'lucide-react';
import { api, ApiClientError } from '@/lib/client/api';
import type { MeResponse } from '@/lib/client/api';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<MeResponse>('/api/auth/login', { email, password });
      router.replace(params.get('next') || (me.hasProfile ? '/dashboard' : '/upload'));
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Sign in failed.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Target className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-xl font-semibold text-ink-900">Welcome back</h1>
          <p className="muted mt-1">Sign in to continue your opportunity search.</p>
        </div>

        <form onSubmit={submit} className="card card-pad space-y-4">
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-ink-500">
            No account? <Link href="/register" className="link">Create one</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
