'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Briefcase, Landmark, ScrollText, Sparkles, Target } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, Disclaimer, EmptyState, SectionHeading, Spinner } from '@/components/ui';
import { api } from '@/lib/client/api';

interface Roadmap {
  targetRole: string;
  rationale: string;
  requiredSkills: string[];
  gapSkills: string[];
  courses: { title: string; provider: string; reason: string }[];
  certifications: { name: string; issuer: string; reason: string }[];
  targetJobs: string[];
  governmentExams: string[];
  applicationStrategy: string[];
  nextStep: string;
  timelineWeeks: number;
  provider: string;
  usedFallback: boolean;
  examSuggestions: string[];
}

export default function CareerRoadmapPage() {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Roadmap>('/api/roadmap')
      .then(setRoadmap)
      .catch(() => setError('Could not build a roadmap. Upload a resume first.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Spinner label="Building your career roadmap…" />
        </div>
      </AppShell>
    );
  }

  if (error || !roadmap) {
    return (
      <AppShell>
        <PageHeader title="Career roadmap" />
        <EmptyState
          icon={Target}
          title="No roadmap yet"
          description={error ?? 'Upload a resume so we can build a personalised roadmap.'}
          action={
            <Link href="/upload" className="btn-primary">
              Upload resume
            </Link>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Your personalised career roadmap"
        subtitle={`Target role: ${roadmap.targetRole} · ${roadmap.timelineWeeks}-week plan · built by ${roadmap.provider}`}
        actions={
          <Link href="/jobs" className="btn-primary">
            <Target className="h-4 w-4" /> Find matching jobs
          </Link>
        }
      />

      <Card className="card-pad mb-5">
        <SectionHeading icon={Sparkles} title="Why this target" />
        <p className="text-sm leading-relaxed text-ink-800">{roadmap.rationale}</p>
        <div className="mt-3 rounded-lg bg-brand-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Next step</p>
          <p className="mt-1 text-sm text-ink-900">{roadmap.nextStep}</p>
        </div>
        {roadmap.usedFallback ? (
          <p className="muted mt-3 text-xs">
            Built with the deterministic rule engine because no AI provider is configured. The reasoning comes from your
            profile and the job-family skill model — nothing was invented.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="card-pad">
          <SectionHeading icon={Sparkles} title="Skills to close" subtitle="Gaps between your profile and this target" />
          {roadmap.gapSkills.length === 0 ? (
            <p className="muted">No significant gaps — your profile already covers the core requirements.</p>
          ) : (
            <ul className="space-y-2">
              {roadmap.gapSkills.map((skill) => (
                <li key={skill} className="flex items-center gap-2 text-sm text-ink-800">
                  <Badge tone="warning">gap</Badge>
                  {skill}
                </li>
              ))}
            </ul>
          )}
          {roadmap.requiredSkills.length ? (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="label">All required skills</p>
              <div className="flex flex-wrap gap-1.5">
                {roadmap.requiredSkills.map((skill) => (
                  <Badge key={skill} tone={roadmap.gapSkills.includes(skill) ? 'warning' : 'success'}>
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={BookOpen} title="Courses to take" subtitle="Suggested, not prescriptive — pick what fits your schedule" />
          <ul className="space-y-3">
            {roadmap.courses.map((course) => (
              <li key={course.title} className="rounded-lg border border-ink-200 p-3">
                <p className="text-sm font-medium text-ink-900">{course.title}</p>
                <p className="muted text-xs">{course.provider}</p>
                <p className="muted mt-1 text-xs">{course.reason}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={ScrollText} title="Certifications worth having" />
          <ul className="space-y-3">
            {roadmap.certifications.map((certification) => (
              <li key={certification.name} className="rounded-lg border border-ink-200 p-3">
                <p className="text-sm font-medium text-ink-900">{certification.name}</p>
                <p className="muted text-xs">{certification.issuer}</p>
                <p className="muted mt-1 text-xs">{certification.reason}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Briefcase} title="Target job titles" subtitle="Search these terms directly" />
          <ul className="space-y-2">
            {roadmap.targetJobs.map((job) => (
              <li key={job} className="flex items-center justify-between gap-2 text-sm text-ink-800">
                {job}
                <Link href={`/jobs?q=${encodeURIComponent(job)}`} className="link text-xs">
                  Search <ArrowRight className="inline h-3 w-3" />
                </Link>
              </li>
            ))}
          </ul>

          {roadmap.governmentExams.length ? (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="label">Government exam categories</p>
              <div className="flex flex-wrap gap-1.5">
                {roadmap.governmentExams.map((exam) => (
                  <Badge key={exam} tone="brand">
                    {exam}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <Card className="card-pad mt-5">
        <SectionHeading icon={Landmark} title="Application strategy" />
        <ol className="space-y-2">
          {roadmap.applicationStrategy.map((step, index) => (
            <li key={index} className="flex gap-2.5 text-sm text-ink-800">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </Card>

      {roadmap.examSuggestions.length ? (
        <Card className="card-pad mt-5">
          <SectionHeading icon={Landmark} title="Examinations currently tracked" subtitle="Live records from the database" />
          <div className="flex flex-wrap gap-1.5">
            {roadmap.examSuggestions.map((exam) => (
              <Badge key={exam} tone="neutral">
                {exam}
              </Badge>
            ))}
          </div>
          <Link href="/exams" className="btn-secondary mt-3">
            Open exam calendar
          </Link>
        </Card>
      ) : null}

      <Disclaimer />
    </AppShell>
  );
}
