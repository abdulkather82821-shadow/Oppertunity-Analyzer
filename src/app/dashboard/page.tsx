'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Briefcase, CalendarClock, Clock, FileText, Landmark, MessageSquare, ScrollText, Sparkles, Target, Upload, Wand2 } from 'lucide-react';
import { AppShell, PageHeader, useMe } from '@/components/app-shell';
import {
  Badge,
  Card,
  ConflictBanner,
  DeadlineBadge,
  Disclaimer,
  EligibilityBadge,
  EmptyState,
  MatchBandBadge,
  ScoreBar,
  SectionHeading,
  Spinner,
  StatCard,
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
  deadlineLabel: string;
  deadlineCta: string;
  deadlineFormatted: string;
  eligibilityStatus: string;
  eligibilityReason: string;
  verificationStatus: string;
  trustScore: number;
  officialSource: string | null;
  applyUrl: string | null;
  explanation: string;
  strengths: string[];
  gaps: string[];
  skills: string[];
  experienceLevel: string;
  sourceKind: string;
  sourceTier: number | null;
  examStatus: string | null;
  isGovernment: boolean;
  isDemo: boolean;
  lastCheckedAt: string | null;
  duplicateCount: number;
  sourceCount: number;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: string | null;
  vacancies: number | null;
  applicationStart: string | null;
  applicationDeadline: string | null;
  examDate: string | null;
}

interface ExamSummary {
  id: string;
  name: string;
  organization: string;
  category: string;
  status: string;
  applicationStart: string | null;
  applicationDeadline: string | null;
  examDate: string | null;
  daysRemaining: number | null;
  deadlineLabel: string;
  deadlineCta: string;
  deadlineFormatted: string;
  vacancies: number | null;
  trustScore: number;
  verificationStatus: string;
  officialNotification: string | null;
  currentStage: number;
  stageLabel: string;
  timeline: { stage: string; label: string; date: string | null; state: 'completed' | 'current' | 'upcoming' | 'unknown' }[];
  conflicts: { field: string; value: string; url: string; isOfficial: boolean }[];
}

interface Digest {
  headline: string;
  topJobs: string[];
  topGovernment: string[];
  topExams: string[];
  closingSoon: string[];
  newlyOpened: string[];
  bestMatch: { title: string; reason: string };
  oneThingToDoToday: string;
  provider: string;
}

interface SkillGap {
  name: string;
  level: string;
  category: string;
  demand: number;
  demandLabel: string;
  impact: 'critical' | 'high' | 'medium';
  impactLabel: string;
  impactScore: number;
  evidence: string;
  source: string;
}

interface RoadmapSummary {
  targetRole: string;
  rationale: string;
  gapSkills: string[];
  courses: { title: string; provider: string; reason: string }[];
  certifications: { name: string; issuer: string; reason: string }[];
  targetJobs: string[];
  governmentExams: string[];
  applicationStrategy: string[];
  nextStep: string;
  provider: string;
}

export default function DashboardPage() {
  const { me } = useMe();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [perfect, setPerfect] = useState<Opportunity[]>([]);
  const [recommended, setRecommended] = useState<Opportunity[]>([]);
  const [closingSoon, setClosingSoon] = useState<Opportunity[]>([]);
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [gaps, setGaps] = useState<SkillGap[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapSummary | null>(null);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<any>('/api/opportunities?limit=60&sort=best_match');
        setSummary(data.summary);
        setPerfect(data.opportunities.filter((o: Opportunity) => o.band === 'perfect' || o.band === 'strong').slice(0, 8));
        setRecommended(data.opportunities.slice(0, 8));
        setClosingSoon(data.opportunities.filter((o: Opportunity) => o.deadlineDays !== null && o.deadlineDays >= 0 && o.deadlineDays <= 7).slice(0, 8));
        const savedData = await api.get<{ saved: Opportunity[] }>('/api/saved');
        setSaved(new Set(savedData.saved.map((item) => item.id)));
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'Could not load your dashboard.');
      } finally {
        setLoading(false);
      }

      api.get<{ exams: ExamSummary[] }>('/api/exams?limit=12').then((data) => setExams(data.exams)).catch(() => undefined);
      api.get<{ gaps: SkillGap[] }>('/api/profile/gaps').then((data) => setGaps(data.gaps.slice(0, 8))).catch(() => undefined);
      api.get<RoadmapSummary>('/api/roadmap').then(setRoadmap).catch(() => undefined);
      api.get<Digest>('/api/digest').then(setDigest).catch(() => undefined);
    })();
  }, []);

  const toggleSave = async (opportunity: Opportunity) => {
    const next = new Set(saved);
    if (next.has(opportunity.id)) {
      next.delete(opportunity.id);
      await api.delete(`/api/saved?id=${opportunity.id}`);
    } else {
      next.add(opportunity.id);
      await api.post('/api/saved', { opportunityId: opportunity.id });
    }
    setSaved(next);
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Spinner label="Loading your dashboard…" />
        </div>
      </AppShell>
    );
  }

  if (!me?.hasProfile) {
    return (
      <AppShell>
        <PageHeader title="Your dashboard" />
        <EmptyState
          icon={Upload}
          title="Upload your resume to get started"
          description="We analyse your resume, search live sources for opportunities you are eligible for, and track every deadline until the window closes."
          action={
            <Link href="/upload" className="btn-primary">
              <Upload className="h-4 w-4" /> Upload resume
            </Link>
          }
        />
      </AppShell>
    );
  }

  const perfectCount = summary?.summary?.perfect ?? perfect.length;

  return (
    <AppShell>
      <PageHeader
        title={`Hello${me.user?.name ? `, ${me.user.name.split(' ')[0]}` : ''} 👋`}
        subtitle={digest?.headline ?? 'Your personalised career intelligence at a glance.'}
        actions={
          <>
            <Link href="/chat" className="btn-secondary">
              <MessageSquare className="h-4 w-4" /> Ask the assistant
            </Link>
            <Link href="/jobs" className="btn-primary">
              <Target className="h-4 w-4" /> What should I apply for today?
            </Link>
          </>
        }
      />

      {error ? (
        <Card className="card-pad mb-5 border-red-200 bg-red-50">
          <p className="flex items-start gap-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        </Card>
      ) : null}

      {/* Six summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={Target} label="🎯 Perfect Matches" value={perfectCount} hint="90%+ match & open" tone="success" href="/jobs?band=perfect" />
        <StatCard icon={Briefcase} label="💼 Jobs Found" value={summary?.total ?? 0} hint="across all sources" tone="info" href="/jobs" />
        <StatCard icon={Landmark} label="🏛 Government" value={summary?.government ?? 0} hint="official portals" tone="brand" href="/government" />
        <StatCard icon={ScrollText} label="📝 Exams" value={summary?.exams ?? 0} hint="tracked examinations" tone="neutral" href="/exams" />
        <StatCard icon={Clock} label="⏰ Closing Soon" value={summary?.closingSoon ?? closingSoon.length} hint="within 7 days" tone="danger" href="/jobs?deadline=7" />
        <StatCard icon={FileText} label="⭐ Saved" value={summary?.saved ?? saved.size} hint="your shortlist" tone="warning" href="/saved" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {/* ⭐ Perfect opportunities */}
          <Card className="card-pad">
            <SectionHeading
              icon={Target}
              title="⭐ Perfect Opportunities"
              subtitle="Highest-scoring matches that you appear eligible for and can still apply to"
              action={
                <Link href="/jobs?sort=best_match" className="btn-secondary btn-sm">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            {perfect.length === 0 ? (
              <EmptyState icon={Target} title="No perfect matches yet" description="Nothing currently scores above 90% for your profile. Your recommended list below is the next best thing." />
            ) : (
              <ul className="space-y-3">
                {perfect.map((opportunity) => (
                  <OpportunityRow key={opportunity.id} opportunity={opportunity} saved={saved.has(opportunity.id)} onSave={() => void toggleSave(opportunity)} />
                ))}
              </ul>
            )}
          </Card>

          {/* Recommended */}
          <Card className="card-pad">
            <SectionHeading
              icon={Sparkles}
              title="Recommended for you"
              subtitle="Ranked by fit, eligibility, source trust and deadline relevance"
              action={
                <Link href="/jobs" className="btn-secondary btn-sm">
                  Browse all jobs
                </Link>
              }
            />
            <ul className="space-y-3">
              {recommended.map((opportunity) => (
                <OpportunityRow key={opportunity.id} opportunity={opportunity} saved={saved.has(opportunity.id)} onSave={() => void toggleSave(opportunity)} compact />
              ))}
            </ul>
          </Card>

          {/* Deadline alerts */}
          <Card className="card-pad">
            <SectionHeading icon={Bell} title="⏰ Deadline alerts" subtitle="Applications closing within the next 7 days" />
            {closingSoon.length === 0 ? (
              <p className="muted">Nothing closes in the next 7 days. We will alert you as new deadlines approach.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {closingSoon.map((opportunity) => (
                  <li key={opportunity.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link href={opportunity.isGovernment ? `/exam/${opportunity.id}` : `/opportunity/${opportunity.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-700">
                        {opportunity.title}
                      </Link>
                      <p className="muted text-xs">{opportunity.organization}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <DeadlineBadge daysRemaining={opportunity.deadlineDays} cta={opportunity.deadlineCta} formatted={opportunity.deadlineFormatted} />
                      {opportunity.applyUrl ? (
                        <a href={opportunity.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm">
                          Apply now
                        </a>
                      ) : (
                        <Badge tone="muted">Link not verified</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {/* Exam tracker */}
          <Card className="card-pad">
            <SectionHeading
              icon={ScrollText}
              title="📝 Exam tracker"
              subtitle="Nine-stage timeline, never a guessed status"
              action={
                <Link href="/exams" className="btn-secondary btn-sm">
                  All exams
                </Link>
              }
            />
            {exams.length === 0 ? (
              <Spinner label="Loading examinations…" />
            ) : (
              <ul className="space-y-3">
                {exams.slice(0, 5).map((exam) => (
                  <li key={exam.id} className="rounded-lg border border-ink-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/exam/${exam.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-700">
                          {exam.name}
                        </Link>
                        <p className="muted text-xs">{exam.organization}</p>
                      </div>
                      <StatusBadge status={exam.status} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <DeadlineBadge daysRemaining={exam.daysRemaining} cta={exam.deadlineCta} formatted={exam.deadlineFormatted} />
                      {exam.vacancies != null ? <Badge tone="neutral">{exam.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
                      <TrustBadge score={exam.trustScore} status={exam.verificationStatus} official={Boolean(exam.officialNotification)} />
                    </div>
                    <ExamTimeline timeline={exam.timeline} current={exam.currentStage} />
                    {exam.conflicts.length ? <ConflictBanner conflicts={exam.conflicts} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Skill gap */}
          <Card className="card-pad">
            <SectionHeading
              icon={Sparkles}
              title="🧩 Skill gap"
              subtitle="What your target roles ask for that is not in your resume"
              action={
                <Link href="/skills" className="btn-secondary btn-sm">
                  Details
                </Link>
              }
            />
            {gaps.length === 0 ? (
              <p className="muted">No significant gaps detected for your current target roles.</p>
            ) : (
              <ul className="space-y-2.5">
                {gaps.map((gap) => (
                  <li key={gap.name}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-ink-800">{gap.name}</span>
                      <Badge tone={gap.impact === 'critical' ? 'danger' : gap.impact === 'high' ? 'caution' : 'warning'}>{gap.impactLabel}</Badge>
                    </div>
                    <ScoreBar score={gap.impactScore} label={`${gap.demand} roles ask for this`} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Career path */}
          <Card className="card-pad">
            <SectionHeading
              icon={Wand2}
              title="🧭 Career path"
              subtitle={roadmap ? `Target: ${roadmap.targetRole}` : 'Building your roadmap…'}
              action={
                <Link href="/career-roadmap" className="btn-secondary btn-sm">
                  Full roadmap
                </Link>
              }
            />
            {roadmap ? (
              <div className="space-y-3">
                <p className="text-sm leading-relaxed text-ink-700">{roadmap.rationale}</p>
                {roadmap.gapSkills.length ? (
                  <div>
                    <p className="label">Close these gaps first</p>
                    <div className="flex flex-wrap gap-1.5">
                      {roadmap.gapSkills.slice(0, 6).map((skill) => (
                        <Badge key={skill} tone="warning">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-lg bg-brand-50 px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Next step</p>
                  <p className="mt-1 text-sm text-ink-800">{roadmap.nextStep}</p>
                </div>
              </div>
            ) : (
              <Spinner />
            )}
          </Card>

          {/* Today's digest */}
          {digest ? (
            <Card className="card-pad">
              <SectionHeading icon={CalendarClock} title="📰 Today's Opportunities" subtitle={`Generated by ${digest.provider}`} />
              <div className="space-y-3 text-sm">
                <div className="rounded-lg bg-amber-50 px-3 py-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">One thing to do today</p>
                  <p className="mt-1 text-ink-800">{digest.oneThingToDoToday}</p>
                </div>
                {digest.bestMatch.title ? (
                  <div>
                    <p className="label">Best match</p>
                    <p className="font-medium text-ink-900">{digest.bestMatch.title}</p>
                    <p className="muted text-xs">{digest.bestMatch.reason}</p>
                  </div>
                ) : null}
                {digest.closingSoon.length ? (
                  <div>
                    <p className="label">Closing soon</p>
                    <ul className="space-y-1">
                      {digest.closingSoon.map((line, index) => (
                        <li key={index} className="text-xs text-ink-700">
                          • {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {digest.newlyOpened.length ? (
                  <div>
                    <p className="label">Newly opened</p>
                    <ul className="space-y-1">
                      {digest.newlyOpened.map((line, index) => (
                        <li key={index} className="text-xs text-ink-700">
                          • {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          <Disclaimer />
        </div>
      </div>
    </AppShell>
  );
}

function OpportunityRow({ opportunity, saved, onSave, compact }: { opportunity: Opportunity; saved: boolean; onSave: () => void; compact?: boolean }) {
  return (
    <li className="rounded-lg border border-ink-200 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={opportunity.isGovernment ? `/exam/${opportunity.id}` : `/opportunity/${opportunity.id}`} className="text-sm font-medium text-ink-900 hover:text-brand-700">
            {opportunity.title}
          </Link>
          <p className="muted mt-0.5 truncate text-xs">
            {opportunity.organization}
            {opportunity.locationSummary ? ` · ${opportunity.locationSummary}` : ''}
            {opportunity.type ? ` · ${opportunity.type.replace(/_/g, ' ')}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-base font-semibold tabular-nums text-ink-900">{Math.round(opportunity.finalScore)}%</span>
          <MatchBandBadge band={opportunity.band} label={opportunity.bandLabel} />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <EligibilityBadge status={opportunity.eligibilityStatus} reason={opportunity.eligibilityReason} />
        <DeadlineBadge daysRemaining={opportunity.deadlineDays} cta={opportunity.deadlineCta} formatted={opportunity.deadlineFormatted} />
        <TrustBadge score={opportunity.trustScore} status={opportunity.verificationStatus} official={Boolean(opportunity.officialSource)} />
        {opportunity.sourceCount > 1 ? <Badge tone="neutral">Found on {opportunity.sourceCount} sources</Badge> : null}
        {opportunity.vacancies != null ? <Badge tone="neutral">{opportunity.vacancies.toLocaleString('en-IN')} vacancies</Badge> : null}
        {opportunity.experienceLevel ? <Badge tone="muted">{opportunity.experienceLevel}</Badge> : null}
        {opportunity.isDemo ? <Badge tone="muted">demo record</Badge> : null}
      </div>

      {compact ? null : opportunity.explanation ? (
        <p className="muted mt-2 text-xs leading-relaxed">{opportunity.explanation}</p>
      ) : null}

      {compact ? null : (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button onClick={onSave} className={saved ? 'btn-secondary btn-sm text-brand-700' : 'btn-ghost btn-sm'}>
            {saved ? '★ Saved' : '☆ Save'}
          </button>
          <Link href={opportunity.isGovernment ? `/exam/${opportunity.id}` : `/opportunity/${opportunity.id}`} className="btn-secondary btn-sm">
            View details
          </Link>
          {opportunity.applyUrl ? (
            <a href={opportunity.applyUrl} target="_blank" rel="noreferrer noopener" className="btn-primary btn-sm">
              Apply now
            </a>
          ) : (
            <Badge tone="muted" title="No official application link could be verified">
              Link not verified
            </Badge>
          )}
        </div>
      )}
    </li>
  );
}

function ExamTimeline({ timeline, current }: { timeline: ExamSummary['timeline']; current: number }) {
  return (
    <div className="mt-3 border-t border-ink-100 pt-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
        Stage {current} of 9 — {timeline[current - 1]?.label ?? 'unknown'}
      </p>
      <div className="flex items-center gap-1">
        {timeline.map((stage, index) => (
          <div key={stage.stage} className="group relative flex-1" title={`${stage.label}${stage.date ? ` · ${new Date(stage.date).toLocaleDateString('en-IN')}` : ''}`}>
            <div
              className={`h-1.5 rounded-full ${
                stage.state === 'completed' ? 'bg-emerald-500' : stage.state === 'current' ? 'bg-brand-600' : stage.state === 'unknown' ? 'bg-ink-200' : 'bg-ink-100'
              }`}
            />
          </div>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink-500">
        {timeline.filter((stage) => stage.state === 'unknown').length
          ? `${timeline.filter((stage) => stage.state === 'unknown').length} stage date(s) not yet published`
          : 'All published stage dates shown'}
      </p>
    </div>
  );
}
