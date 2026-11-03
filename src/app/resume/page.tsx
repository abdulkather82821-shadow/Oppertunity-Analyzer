'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FileText, Sparkles, Upload, Wand2 } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, Disclaimer, EmptyState, ScoreBar, SectionHeading, Spinner } from '@/components/ui';
import { api, ApiClientError, fmtBytes } from '@/lib/client/api';

interface Resume {
  id: string;
  original_name: string;
  size_bytes: number;
  mime_type: string;
  parse_status: string;
  created_at: string;
}

interface Optimization {
  id: string;
  score: number;
  ats_score: number;
  result: string;
  created_at: string;
  title?: string;
}

interface OptimizationResult {
  score: number;
  atsScore: number;
  missingKeywords: string[];
  missingSkills: string[];
  experienceAlignment: string;
  suggestedBullets: string[];
  keywordCoverage: number;
  verdict: string;
  jobTitle?: string;
  provider?: string;
}

export default function ResumePage() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [history, setHistory] = useState<Optimization[]>([]);
  const [opportunityId, setOpportunityId] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [opportunities, setOpportunities] = useState<{ id: string; title: string; organization: string }[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get<{ resumes: Resume[] }>('/api/resumes').then((data) => setResumes(data.resumes)),
      api.get<{ history: Optimization[] }>('/api/resumes?history=1')
        .then((data) => setHistory((data as any).history ?? []))
        .catch(() => undefined),
      api
        .get<{ opportunities: { id: string; title: string; organization: string }[] }>('/api/opportunities?limit=50&sort=best_match')
        .then((data) => setOpportunities(data.opportunities)),
    ])
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const optimise = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!opportunityId && !jobDescription.trim()) {
      setError('Choose a saved opportunity or paste a job description.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.post<OptimizationResult>('/api/resume-optimizer', {
        opportunityId: opportunityId || undefined,
        jobDescription: jobDescription.trim() || undefined,
      });
      setResult(data);
      load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Optimisation failed.');
    } finally {
      setBusy(false);
    }
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
        title="AI Resume Optimiser"
        subtitle="Compare your resume against a real job description. We suggest wording — we never invent experience."
        actions={
          <Link href="/upload" className="btn-secondary">
            <Upload className="h-4 w-4" /> Upload a new resume
          </Link>
        }
      />

      {resumes.length === 0 ? (
        <EmptyState
          icon={Upload}
          title="No resume on file"
          description="Upload a resume first so the optimiser has something to compare against the job description."
          action={
            <Link href="/upload" className="btn-primary">
              Upload resume
            </Link>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-5">
            <Card className="card-pad">
              <SectionHeading icon={FileText} title="Your resumes" />
              <ul className="divide-y divide-ink-100">
                {resumes.map((resume) => (
                  <li key={resume.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{resume.original_name}</p>
                      <p className="muted text-xs">
                        {fmtBytes(resume.size_bytes)} · {resume.mime_type} · {new Date(resume.created_at).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <a href={`/api/resumes/${resume.id}/download`} className="btn-secondary btn-sm shrink-0">
                      Download
                    </a>
                  </li>
                ))}
              </ul>
              <p className="muted mt-2 text-xs">Your original file is never modified. Optimisation only produces suggestions.</p>
            </Card>

            <Card className="card-pad">
              <SectionHeading icon={Wand2} title="Run an optimisation" />
              <form onSubmit={optimise} className="space-y-3">
                <div>
                  <label className="label" htmlFor="opportunity">Compare against a matched opportunity</label>
                  <select id="opportunity" className="input" value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}>
                    <option value="">— choose one, or paste a description below —</option>
                    {opportunities.map((opportunity) => (
                      <option key={opportunity.id} value={opportunity.id}>
                        {opportunity.title} — {opportunity.organization}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="jd">Or paste a job description</label>
                  <textarea
                    id="jd"
                    rows={7}
                    className="input font-mono text-xs"
                    placeholder="Paste the full job description here…"
                    value={jobDescription}
                    onChange={(event) => setJobDescription(event.target.value)}
                  />
                </div>
                {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
                <button type="submit" disabled={busy} className="btn-primary w-full">
                  {busy ? <Spinner label="Analysing…" /> : <>Analyse my resume</>}
                </button>
              </form>
            </Card>

            {history.length ? (
              <Card className="card-pad">
                <SectionHeading icon={Sparkles} title="Previous optimisations" />
                <ul className="space-y-2">
                  {history.slice(0, 6).map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink-800">{entry.title ?? 'Optimisation'}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone="neutral">ATS {entry.ats_score}</Badge>
                        <span className="text-xs text-ink-500">{new Date(entry.created_at).toLocaleDateString('en-IN')}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>

          <div className="space-y-5">
            {result ? (
              <>
                <Card className="card-pad">
                  <SectionHeading icon={Wand2} title={result.jobTitle ?? 'Optimisation result'} subtitle={`Analysed by ${result.provider ?? 'the rule engine'}`} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ScoreBar score={result.atsScore} label="ATS readability" />
                    <ScoreBar score={result.score} label="Keyword match" />
                  </div>
                  <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2.5 text-sm text-ink-800">{result.verdict}</p>
                  <p className="muted mt-2 text-xs">{result.experienceAlignment}</p>
                </Card>

                <Card className="card-pad">
                  <SectionHeading title="Missing keywords" subtitle="Terms in the job description that do not appear in your resume" />
                  {result.missingKeywords.length === 0 ? (
                    <p className="muted">No missing keywords — your resume already covers the description.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {result.missingKeywords.map((keyword) => (
                        <Badge key={keyword} tone="warning">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="muted mt-3 text-xs">
                    Only add keywords you can genuinely evidence. Padding a resume with terms you cannot discuss in an interview
                    does more harm than good.
                  </p>
                </Card>

                {result.missingSkills.length ? (
                  <Card className="card-pad">
                    <SectionHeading title="Missing skills" />
                    <div className="flex flex-wrap gap-1.5">
                      {result.missingSkills.map((skill) => (
                        <Badge key={skill} tone="caution">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </Card>
                ) : null}

                <Card className="card-pad">
                  <SectionHeading icon={Sparkles} title="Suggested bullet points" subtitle="Rewrite what you already did — do not invent new experience" />
                  <ul className="space-y-2">
                    {result.suggestedBullets.map((bullet, index) => (
                      <li key={index} className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-800">
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </Card>
              </>
            ) : (
              <Card className="card-pad">
                <SectionHeading icon={Wand2} title="No optimisation yet" />
                <p className="muted">
                  Pick one of your matched opportunities or paste a job description, and we will compare it against your resume —
                  missing keywords, ATS readability, and concrete bullet-point rewrites.
                </p>
              </Card>
            )}

            <Disclaimer>
              The optimiser suggests wording for experience you already have. It will never fabricate roles, employers, dates or
              achievements. Always review suggestions before submitting an application.
            </Disclaimer>
          </div>
        </div>
      )}
    </AppShell>
  );
}
