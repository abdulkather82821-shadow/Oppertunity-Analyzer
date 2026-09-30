import { route, json } from '@/lib/api/route';
import { db } from '@/lib/db';
import { requirePermission, notFound } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

/** GET /api/profile/skills — every skill on the caller's profile, grouped by category. */
export const GET = route(async (request) => {
  const { user } = await requirePermission(request, 'profile.read');
  const profile = await db.one<{ id: string }>('SELECT id FROM candidate_profiles WHERE user_id = ?', [user.id]);
  if (!profile) throw notFound('No career profile yet — upload a resume first.');

  const rows = await db.query<any>(
    `SELECT name, category, proficiency AS level, source, confidence
       FROM skills WHERE profile_id = ? ORDER BY category ASC, confidence DESC`,
    [profile.id],
  );

  return json({
    skills: rows.map((row) => ({
      name: row.name,
      category: row.category,
      level: row.level ?? 'unknown',
      source: row.source,
      confidence: Number(row.confidence ?? 0),
      matchedCanonical: row.name,
    })),
    total: rows.length,
  });
}, { csrf: false });
