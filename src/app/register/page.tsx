'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Target } from 'lucide-react';
import { api, ApiClientError } from '@/lib/client/api';
import type { MeResponse } from '@/lib/client/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', name: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post<MeResponse>('/api/auth/register', form);
      router.replace('/upload');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Registration failed.');
      setBusy(false);
    }
  };

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Target className="h-5 w-5" />
          </span>
          <h1 className="mt-3 text-xl font-semibold text-ink-900">Create your account</h1>
          <p className="muted mt-1">Every new account starts as a Candidate with no elevated permissions.</p>
        </div>

        <form onSubmit={submit} className="card card-pad space-y-4">
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div>
            <label className="label" htmlFor="name">Full name</label>
            <input id="name" className="input" value={form.name} onChange={set('name')} maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required className="input" value={form.email} onChange={set('email')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="new-password" required minLength={12} className="input" value={form.password} onChange={set('password')} />
            </div>
            <div>
              <label className="label" htmlFor="confirm">Confirm</label>
              <input id="confirm" type="password" autoComplete="new-password" required className="input" value={form.confirm} onChange={set('confirm')} />
            </div>
          </div>
          <p className="muted text-xs leading-relaxed">
            At least 12 characters with upper and lower case, a number and a symbol. Your resume is encrypted at rest and never
            shared publicly — you can delete it at any time from Settings.
          </p>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Creating account…' : 'Create account'}
          </button>
          <p className="text-center text-xs text-ink-500">
            Already registered? <Link href="/login" className="link">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
