'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2, Landmark, Search, Shield, Sparkles, Target, Upload } from 'lucide-react';
import { api, ApiClientError, type MeResponse } from '@/lib/client/api';

const FLOW = [
  { step: 'Resume', label: 'Upload your resume', detail: 'PDF, DOCX or TXT. Stored encrypted; the original is never modified.' },
  { step: 'AI Profile', label: 'Structured profile', detail: 'Skills, education, experience and certifications — with confidence on every inferred field.' },
  { step: 'Internet Search', label: 'Live opportunity search', detail: 'Queries generated from your profile against live sources and official government portals.' },
  { step: 'Matching', label: 'Eligibility-aware scoring', detail: 'Education, skill, experience, location, role and industry components — explained, not opaque.' },
  { step: 'Deadlines', label: 'Deadline tracking', detail: 'Days remaining, urgency bands, closing-soon and deadline-today alerts in IST.' },
  { step: 'Exams', label: 'Exam status', detail: 'Nine-stage timeline from notification to final result — never guessed.' },
];

const FEATURES = [
  { icon: Target, title: '⭐ Perfect Opportunities', text: 'Your top matches are surfaced first, with an explicit reason for every recommendation.' },
  { icon: Landmark, title: 'Government Exam Intelligence', text: 'UPSC, SSC, IBPS, RRB, SBI and State PSCs with eligibility checks and official notification links.' },
  { icon: Shield, title: 'Source verification', text: 'Conflicting dates are flagged side by side. Nothing is silently chosen for you.' },
  { icon: Sparkles, title: 'Skill gap analysis', text: 'What you already match, what is missing, and a personalised path to close it.' },
];

export default function LandingPage() {
  const router = useRouter();
  const [stats, setStats] = useState<{ opportunities: number; exams: number; sources: number } | null>(null);

  useEffect(() => {
    api
      .get<MeResponse>('/api/auth/me')
      .then((me) => {
        if (me.user) router.replace(me.hasProfile ? '/dashboard' : '/upload');
      })
      .catch(() => undefined);
    api
      .get<{ opportunities: number; exams: number; sources: number }>('/api/stats')
      .then((counts) => setStats(counts.opportunities > 0 ? counts : null))
      .catch(() => undefined);
  }, [router]);

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Target className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight text-ink-900">Opportunity Analyzer AI</p>
              <p className="text-[11px] leading-tight text-ink-500">Upload Your Resume. Discover Your Next Opportunity.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-secondary btn-sm">
              Sign in
            </Link>
            <Link href="/register" className="btn-primary btn-sm">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <span className="badge tone-brand mx-auto">AI Career Intelligence Platform</span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink-900 sm:text-5xl">
          Upload Your Resume. <span className="text-brand-600">Discover Your Next Opportunity.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-ink-600">
          Opportunity Analyzer AI reads your resume, builds a structured profile, searches live sources for jobs and government
          examinations you are actually eligible for, and tracks every deadline until the application closes.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className="btn-primary px-6 py-3 text-base">
            <Upload className="h-4 w-4" /> Upload your resume
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/login" className="btn-secondary px-6 py-3 text-base">
            I already have an account
          </Link>
        </div>
        {stats ? (
          <p className="mt-6 text-sm text-ink-500">
            {stats.opportunities.toLocaleString('en-IN')} opportunities · {stats.exams} government examinations · {stats.sources} tracked sources
          </p>
        ) : null}
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="text-center text-lg font-semibold text-ink-900">How it works</h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FLOW.map((item, index) => (
            <li key={item.step} className="card card-pad">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{index + 1}</span>
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">{item.step}</span>
              </div>
              <p className="mt-2.5 font-medium text-ink-900">{item.label}</p>
              <p className="muted mt-1 leading-relaxed">{item.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-ink-200 bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-ink-200 p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <feature.icon className="h-4 w-4" />
                </span>
                <p className="mt-3 font-medium text-ink-900">{feature.title}</p>
                <p className="muted mt-1 leading-relaxed">{feature.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              { title: 'We never invent data', text: 'If a date, vacancy count or salary cannot be verified, it is shown as Unknown rather than guessed.' },
              { title: 'Conflicts are surfaced', text: 'When two sources disagree, you see both values and which one is official.' },
              { title: 'Your resume stays private', text: 'Encrypted at rest, never published, never sold, and deletable at any time.' },
            ].map((item) => (
              <div key={item.title} className="flex gap-2.5 rounded-lg bg-ink-50 p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-ink-900">{item.title}</p>
                  <p className="muted mt-0.5 text-xs leading-relaxed">{item.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-center text-xs text-ink-500">
        <p>
          <strong className="text-ink-700">Accuracy disclaimer:</strong> this platform is a discovery assistant, not an official authority.
          Always verify against the official notification before applying.
        </p>
      </footer>
    </div>
  );
}

export const runtime = 'nodejs';
void ApiClientError;
void Search;
