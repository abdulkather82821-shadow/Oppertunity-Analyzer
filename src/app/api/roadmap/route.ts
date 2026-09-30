import { route, json } from '@/lib/api/route';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { loadProfile } from '@/lib/services/profile-service';
import { buildRoadmap } from '@/lib/ai/chat';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = route(async (request, { user }) => {
  const { user: authed } = await requirePermission(request, 'profile.read');
  const profile = await loadProfile(authed.id);
  if (!profile) throw notFound('Upload a resume first to generate a career roadmap.');
  return json(await buildRoadmap(authed.id, profile));
}, { csrf: false });
