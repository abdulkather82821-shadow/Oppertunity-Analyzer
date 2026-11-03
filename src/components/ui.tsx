'use client';

import clsx from 'clsx';
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Gauge,
  HelpCircle,
  Info,
  Landmark,
  ListChecks,
  MessageSquare,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Target,
  Upload,
  UserCircle2,
} from 'lucide-react';

/** Shared presentational primitives used across every page. */

export const Card = ({ className, children }: { className?: string; children: React.ReactNode }) => (
  <div className={clsx('card', className)}>{children}</div>
);

export const SectionHeading = ({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) => (
  <div className="mb-3 flex items-start justify-between gap-4">
    <div className="flex items-start gap-2.5">
      {Icon ? (
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div>
        <h2 className="section-title">{title}</h2>
        {subtitle ? <p className="muted mt-0.5">{subtitle}</p> : null}
      </div>
    </div>
    {action}
  </div>
);

type Tone = 'success' | 'warning' | 'caution' | 'danger' | 'info' | 'neutral' | 'muted' | 'brand';

const TONE_CLASS: Record<Tone, string> = {
  success: 'tone-success',
  warning: 'tone-warning',
  caution: 'tone-caution',
  danger: 'tone-danger',
  info: 'tone-info',
  neutral: 'tone-neutral',
  muted: 'tone-muted',
  brand: 'tone-brand',
};

export const Badge = ({
  tone = 'neutral',
  children,
  title,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) => (
  <span className={clsx('badge', TONE_CLASS[tone], className)} title={title}>
    {children}
  </span>
);

export const ScoreBar = ({ score, label }: { score: number; label?: string }) => {
  const tone: Tone = score >= 80 ? 'success' : score >= 65 ? 'info' : score >= 45 ? 'warning' : score >= 25 ? 'caution' : 'danger';
  const colour =
    score >= 80 ? 'bg-emerald-500' : score >= 65 ? 'bg-sky-500' : score >= 45 ? 'bg-amber-500' : score >= 25 ? 'bg-orange-500' : 'bg-red-500';
  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        {label ? <span className="text-xs font-medium text-ink-600">{label}</span> : <span />}
        <span className="text-xs font-semibold text-ink-800 tabular-nums">{Math.round(score)}%</span>
      </div>
      <div className="bar-track">
        <div className={clsx('bar-fill', colour)} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} aria-label={`${label ?? 'score'} ${Math.round(score)} percent`} />
      </div>
    </div>
  );
};

export const StatusBadge = ({ status, label }: { status: string; label?: string }) => {
  const map: Record<string, { tone: Tone; text: string }> = {
    applications_open: { tone: 'success', text: '🟢 Applications Open' },
    closing_soon: { tone: 'caution', text: '🟠 Closing Soon' },
    deadline_today: { tone: 'danger', text: '🔴 Deadline Today' },
    applications_closed: { tone: 'danger', text: '⛔ Application Closed' },
    exam_upcoming: { tone: 'info', text: '📅 Exam Upcoming' },
    admit_card_released: { tone: 'warning', text: '🎫 Admit Card Released' },
    exam_completed: { tone: 'neutral', text: '✅ Exam Completed' },
    result_released: { tone: 'success', text: '📊 Result Released' },
    notification_expected: { tone: 'muted', text: '⏳ Notification Expected' },
    needs_verification: { tone: 'warning', text: '❓ Needs Verification' },
    published: { tone: 'info', text: 'Published' },
    draft: { tone: 'muted', text: 'Draft' },
    expired: { tone: 'muted', text: 'Expired' },
    archived: { tone: 'muted', text: 'Archived' },
  };
  const meta = map[status] ?? { tone: 'neutral' as Tone, text: label ?? status };
  return (
    <Badge tone={meta.tone} title={label ?? status}>
      {meta.text}
    </Badge>
  );
};

export const TrustBadge = ({ score, status, official }: { score: number; status: string; official?: boolean }) => {
  const tone: Tone = status === 'verified' ? 'success' : status === 'conflicting' ? 'caution' : status === 'suspicious' ? 'danger' : 'warning';
  const icon = status === 'verified' ? '🟢' : status === 'conflicting' ? '⚠️' : status === 'suspicious' ? '🔴' : '🟡';
  return (
    <Badge tone={tone} title={`Trust score ${Math.round(score)}/100${official ? ' · official source found' : ''}`}>
      {icon} Trust {Math.round(score)}/100
    </Badge>
  );
};

export const ConfidenceChip = ({ confidence, source, rationale }: { confidence: number; source: string; rationale?: string }) => {
  const inferred = source === 'inferred';
  const tone: Tone = !inferred ? 'success' : confidence >= 0.7 ? 'info' : confidence >= 0.4 ? 'warning' : 'caution';
  return (
    <Badge tone={tone} title={rationale ?? (inferred ? 'Inferred by AI — please confirm' : 'Extracted directly from your resume')}>
      {inferred ? <Sparkles className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
      {Math.round(confidence * 100)}%
      <span className="font-normal opacity-70">{inferred ? 'inferred' : 'resume'}</span>
    </Badge>
  );
};

export const SourceBadge = ({ kind, tier }: { kind: string; tier?: number }) => {
  const map: Record<string, { tone: Tone; text: string }> = {
    official: { tone: 'success', text: 'Official' },
    secondary: { tone: 'info', text: 'Secondary' },
    aggregator: { tone: 'warning', text: 'Aggregator' },
    social: { tone: 'caution', text: 'Social' },
  };
  const meta = map[kind] ?? { tone: 'muted' as Tone, text: kind };
  return (
    <Badge tone={meta.tone} title={`Source tier ${tier ?? '?'}`}>
      {tier ? `Tier ${tier} · ` : ''}
      {meta.text}
    </Badge>
  );
};

export const DeadlineBadge = ({ daysRemaining, cta, formatted }: { daysRemaining: number | null; cta: string; formatted: string }) => {
  if (daysRemaining === null) return <Badge tone="muted">Deadline not published</Badge>;
  const tone: Tone = daysRemaining < 0 ? 'danger' : daysRemaining <= 2 ? 'danger' : daysRemaining <= 7 ? 'caution' : daysRemaining <= 15 ? 'warning' : 'success';
  return (
    <Badge tone={tone} title={`Deadline ${formatted}`}>
      <Clock className="h-3 w-3" />
      {cta}
    </Badge>
  );
};

export const MatchBandBadge = ({ band, label }: { band: string; label: string }) => {
  const tone: Tone = band === 'perfect' ? 'success' : band === 'strong' ? 'info' : band === 'good' ? 'brand' : band === 'possible' ? 'neutral' : band === 'skill_gap' ? 'warning' : 'danger';
  return <Badge tone={tone}>{label}</Badge>;
};

export const EligibilityBadge = ({ status, reason }: { status: string; reason?: string }) => {
  const map: Record<string, { tone: Tone; text: string }> = {
    eligible: { tone: 'success', text: '✅ Eligible' },
    probably_eligible: { tone: 'info', text: '✅ Probably Eligible' },
    partial_eligible: { tone: 'warning', text: '⚠️ Partially Eligible' },
    unknown: { tone: 'muted', text: '❔ Eligibility Unknown' },
    not_eligible: { tone: 'danger', text: '❌ Not Eligible' },
  };
  const meta = map[status] ?? { tone: 'neutral' as Tone, text: status };
  return (
    <Badge tone={meta.tone} title={reason}>
      {meta.text}
    </Badge>
  );
};

export const Spinner = ({ label }: { label?: string }) => (
  <span className="inline-flex items-center gap-2 text-sm text-ink-500">
    <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-brand-600" aria-hidden />
    {label ?? 'Loading…'}
  </span>
);

export const EmptyState = ({
  icon: Icon = Info,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) => (
  <div className="card card-pad flex flex-col items-center gap-2 py-10 text-center">
    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-500">
      <Icon className="h-5 w-5" />
    </span>
    <p className="font-medium text-ink-800">{title}</p>
    {description ? <p className="muted max-w-md">{description}</p> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
);

export const StatCard = ({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  hint?: string;
  tone?: Tone;
  href?: string;
}) => {
  const body = (
    <div className={clsx('card card-pad flex items-start gap-3 transition-shadow', href && 'hover:shadow-md')}>
      <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONE_CLASS[tone])}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
        {hint ? <p className="mt-0.5 truncate text-xs text-ink-500">{hint}</p> : null}
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block">
      {body}
    </a>
  ) : (
    body
  );
};

export const Disclaimer = ({ children }: { children?: React.ReactNode }) => (
  <div className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
    <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />
    <p>
      {children ??
        'This platform is a discovery assistant, not an official authority. Dates, eligibility and vacancy details are compiled from public sources and may be incomplete. Always verify against the official notification before applying.'}
    </p>
  </div>
);

export const ConflictBanner = ({ conflicts }: { conflicts: { field: string; value: string; url: string; isOfficial: boolean }[] }) => {
  if (!conflicts?.length) return null;
  const byField = new Map<string, typeof conflicts>();
  for (const conflict of conflicts) {
    const list = byField.get(conflict.field) ?? [];
    list.push(conflict);
    byField.set(conflict.field, list);
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <ShieldAlert className="h-4 w-4" /> Conflicting information from sources
      </p>
      <p className="mt-1 text-xs text-amber-800">Sources disagree on the following. We do not guess — both values are shown and the official source is marked.</p>
      <div className="mt-2 space-y-2">
        {[...byField.entries()].map(([field, items]) => (
          <div key={field}>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">{field.replace(/_/g, ' ')}</p>
            <ul className="mt-1 space-y-1">
              {items.map((item, index) => (
                <li key={index} className="text-xs text-amber-900">
                  <span className="font-medium">{item.value}</span>
                  <span className="opacity-70"> — </span>
                  <a href={item.url} target="_blank" rel="noreferrer noopener" className="underline">
                    {new URL(item.url).hostname}
                  </a>
                  {item.isOfficial ? <span className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">official</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};

export const icons = {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  Gauge,
  HelpCircle,
  Info,
  Landmark,
  ListChecks,
  MessageSquare,
  Search,
  Shield,
  Sparkles,
  Target,
  Upload,
  UserCircle2,
};
