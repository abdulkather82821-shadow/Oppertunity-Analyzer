import { route, json } from '@/lib/api/route';
import { db, jsonDecode } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { loadProfile } from '@/lib/services/profile-service';
import { SKILL_TAXONOMY } from '@/lib/analysis/taxonomy';

export const dynamic = 'force-dynamic';

const IMPACT_META = {
  critical: { label: 'Critical gap', score: 92 },
  high: { label: 'High impact', score: 74 },
  medium: { label: 'Worth adding', score: 55 },
} as const;

/**
 * GET /api/profile/gaps
 * Ranks the skills missing from the resume by how many of the caller's target roles ask for
 * them. Demand is counted from the live catalogue, so the ranking reflects real postings
 * rather than a static list.
 */
export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'profile.read');
  const profile = await loadProfile(user.id);
  if (!profile) throw notFound('No career profile yet — upload a resume first.');

  const missing = profile.missingSkills;
  if (!missing.length) return json({ gaps: [], total: 0 });

  const rows = await db.query<any>(
    `SELECT skills, job_family FROM opportunities WHERE is_active = 1`,
  );

  const demand = new Map<string, number>();
  for (const row of rows) {
    const skills: string[] = jsonDecode<string[]>(row.skills, []);
    for (const skill of skills) {
      const key = skill.toLowerCase();
      demand.set(key, (demand.get(key) ?? 0) + 1);
    }
  }

  const scored = missing.map((item) => {
    const count = demand.get(item.name.toLowerCase()) ?? 0;
    const impact: 'critical' | 'high' | 'medium' =
      count >= 5 || item.confidence >= 0.8 ? 'critical' : count >= 2 || item.confidence >= 0.55 ? 'high' : 'medium';
    // ScoredItem carries no category, so resolve it from the taxonomy by canonical name.
    const key = item.name.toLowerCase();
    const category =
      profile.skills.find((s) => s.canonical.toLowerCase() === key)?.category ??
      SKILL_TAXONOMY.find((entry) => entry.canonical.toLowerCase() === key)?.category ??
      'general';
    return {
      name: item.name,
      level: 'missing',
      category,
      demand: count,
      demandLabel: count === 1 ? '1 active role asks for this' : `${count} active roles ask for this`,
      impact,
      impactLabel: IMPACT_META[impact].label,
      impactScore: IMPACT_META[impact].score,
      evidence: item.rationale,
      source: item.source,
      confidence: item.confidence,
    };
  });

  scored.sort((a, b) => b.impactScore - a.impactScore || b.demand - a.demand);
  return json({ gaps: scored, total: scored.length });
}, { csrf: false });
