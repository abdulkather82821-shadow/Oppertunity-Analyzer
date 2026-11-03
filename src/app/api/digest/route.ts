import { route, json } from '@/lib/api/route';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { loadProfile } from '@/lib/services/profile-service';
import { buildDigest } from '@/lib/ai/chat';
import { persistDigestNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/digest — "Today's Opportunities", generated on demand. */
export const GET = route(async (request, { user }) => {
  const { user: authed } = await requirePermission(request, 'opportunity.read');
  const profile = await loadProfile(authed.id);
  if (!profile) throw notFound('Upload a resume first to receive a personalised digest.');
  const digest = await buildDigest(authed.id, profile);
  return json(digest);
}, { csrf: false });

/** POST /api/digest — persist the digest as an in-app notification (manual trigger). */
export const POST = route(async (request) => {
  const { user } = await requirePermission(request, 'notification.manage');
  const profile = await loadProfile(user.id);
  if (!profile) throw notFound('Upload a resume first to receive a personalised digest.');
  const digest = await buildDigest(user.id, profile);
  // A manual request always creates a notification, so its key is unique per call; the
  // scheduled sweep uses per-day / per-week keys so it never double-posts.
  await persistDigestNotification(user.id, digest, `digest:manual:${Date.now()}`);
  return json(digest);
});
