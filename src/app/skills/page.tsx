'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Sparkles, TrendingUp } from 'lucide-react';
import { AppShell, PageHeader } from '@/components/app-shell';
import { Badge, Card, ConfidenceChip, Disclaimer, EmptyState, ScoreBar, SectionHeading, Spinner } from '@/components/ui';
import { api } from '@/lib/client/api';

interface Profile {
  careerLevel: { name: string; confidence: number; source: string; rationale: string };
  jobFamilies: { name: string; confidence: number; source: string; rationale: string }[];
  strongestSkills: { name: string; confidence: number; source: string; rationale: string }[];
  missingSkills: { name: string; confidence: number; source: string; rationale: string }[];
  transferableSkills: { name: string; confidence: number; source: string; rationale: string }[];
  careerPaths: { target: string; confidence: number; rationale: string; requiredSkills: string[] }[];
}

interface SkillRow {
  name: string;
  level: string;
  category: string;
  source: string;
  matchedCanonical: string | null;
}

interface Gap {
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

const LEVEL_TONE: Record<string, 'success' | 'info' | 'warning' | 'neutral'> = {
  advanced: 'success',
  proficient: 'success',
  intermediate: 'info',
  beginner: 'warning',
  unknown: 'neutral',
};

export default function SkillsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('all');

  useEffect(() => {
    (async () => {
      try {
        const [profileData, skillData] = await Promise.all([api.get<any>('/api/profile'), api.get<{ skills: SkillRow[] }>('/api/profile/skills')]);
        setProfile(profileData.profile);
        setSkills(skillData.skills);
      } catch {
        /* profile missing — the empty state handles it */
      } finally {
        setLoading(false);
      }
      api.get<{ gaps: Gap[] }>('/api/profile/gaps').then((data) => setGaps(data.gaps)).catch(() => undefined);
    })();
  }, []);

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </AppShell>
    );
  }

  if (!profile) {
    return (
      <AppShell>
        <PageHeader title="Skill gap analysis" />
        <EmptyState title="No profile yet" description="Upload a resume so we can analyse your skills against the roles you match." />
      </AppShell>
    );
  }

  const categories = ['all', ...new Set(skills.map((skill) => skill.category))];
  const visible = category === 'all' ? skills : skills.filter((skill) => skill.category === category);
  const grouped = visible.reduce<Record<string, SkillRow[]>>((accumulator, skill) => {
    (accumulator[skill.category] ??= []).push(skill);
    return accumulator;
  }, {});

  return (
    <AppShell>
      <PageHeader
        title="Skill gap analysis"
        subtitle={`${skills.length} skill(s) on your resume · ${gaps.length} gap(s) against your target roles`}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="card-pad">
          <SectionHeading icon={CheckCircle2} title="Your strongest skills" subtitle="What already matches your target roles" />
          <ul className="space-y-2">
            {profile.strongestSkills.map((skill) => (
              <li key={skill.name} className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink-800">{skill.name}</span>
                <ConfidenceChip confidence={skill.confidence} source={skill.source} rationale={skill.rationale} />
              </li>
            ))}
            {profile.strongestSkills.length === 0 ? <li className="muted text-sm">No skills detected on the resume.</li> : null}
          </ul>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={AlertTriangle} title="Missing skills" subtitle="Requested by roles you match, absent from your resume" />
          <ul className="space-y-2">
            {profile.missingSkills.map((skill) => (
              <li key={skill.name} className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink-800">{skill.name}</span>
                <ConfidenceChip confidence={skill.confidence} source={skill.source} rationale={skill.rationale} />
              </li>
            ))}
            {profile.missingSkills.length === 0 ? <li className="muted text-sm">No significant gaps detected.</li> : null}
          </ul>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={TrendingUp} title="Transferable skills" subtitle="Skills that carry across into adjacent roles" />
          <ul className="space-y-2">
            {profile.transferableSkills.map((skill) => (
              <li key={skill.name} className="flex items-center justify-between gap-2">
                <div>
                  <span className="text-sm text-ink-800">{skill.name}</span>
                  <p className="muted text-xs">{skill.rationale}</p>
                </div>
                <ConfidenceChip confidence={skill.confidence} source={skill.source} />
              </li>
            ))}
            {profile.transferableSkills.length === 0 ? <li className="muted text-sm">None inferred.</li> : null}
          </ul>
        </Card>

        <Card className="card-pad">
          <SectionHeading icon={Sparkles} title="Career paths" subtitle="Ranked by fit to your profile" />
          <ul className="space-y-3">
            {profile.careerPaths.map((path) => (
              <li key={path.target}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-900">{path.target}</span>
                  <span className="text-xs tabular-nums text-ink-500">{Math.round(path.confidence * 100)}%</span>
                </div>
                <ScoreBar score={path.confidence * 100} />
                {path.requiredSkills.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {path.requiredSkills.slice(0, 8).map((skill) => (
                      <Badge key={skill} tone={skills.some((mine) => mine.matchedCanonical?.toLowerCase() === skill.toLowerCase()) ? 'success' : 'warning'}>
                        {skill}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="card-pad mt-5">
        <SectionHeading icon={AlertTriangle} title="Prioritised skill gaps" subtitle="Ranked by how often your target roles ask for them" />
        {gaps.length === 0 ? (
          <p className="muted">No gaps detected. Your profile covers the requirements of the roles you match.</p>
        ) : (
          <ul className="space-y-4">
            {gaps.map((gap) => (
              <li key={gap.name}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink-900">{gap.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{gap.demandLabel}</Badge>
                    <Badge tone={gap.impact === 'critical' ? 'danger' : gap.impact === 'high' ? 'caution' : 'warning'}>{gap.impactLabel}</Badge>
                  </div>
                </div>
                <ScoreBar score={gap.impactScore} label="Impact" />
                <p className="muted mt-1 text-xs">{gap.evidence}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="card-pad mt-5">
        <SectionHeading
          icon={CheckCircle2}
          title="Skills on your resume"
          subtitle="Grouped by category, with self-reported level"
          action={
            <select className="input max-w-[160px]" value={category} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item === 'all' ? 'All categories' : item}
                </option>
              ))}
            </select>
          }
        />
        {Object.keys(grouped).length === 0 ? (
          <p className="muted">No skills were extracted from your resume.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(grouped).map(([name, rows]) => (
              <div key={name} className="rounded-lg border border-ink-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{name}</p>
                <ul className="mt-2 space-y-1.5">
                  {rows.map((row) => (
                    <li key={row.name} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink-800">{row.name}</span>
                      <Badge tone={LEVEL_TONE[row.level] ?? 'neutral'}>{row.level}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Disclaimer />
    </AppShell>
  );
}
