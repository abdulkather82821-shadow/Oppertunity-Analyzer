import { route, json } from '@/lib/api/route';
import { chatSchema } from '@/lib/api/schemas';
import { requirePermission, notFound } from '@/lib/auth/rbac';
import { assertRateLimit } from '@/lib/rate-limit';
import { loadProfile } from '@/lib/services/profile-service';
import { answerQuestion } from '@/lib/ai/chat';
import { trackEvent } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/assistant/chat — grounded Q&A over the caller's profile and records. */
export const POST = route(async (request, { body }) => {
  const { user } = await requirePermission(request, 'ai.use');
  assertRateLimit({ key: `chat:${user.id}`, limit: 40, windowMs: 60 * 60_000 });

  const profile = await loadProfile(user.id);
  if (!profile) throw notFound('Upload a resume first — the assistant answers from your analysed profile.');

  const reply = await answerQuestion(user.id, profile, body.message, body.history ?? []);
  await trackEvent(user.id, 'assistant.question', { length: body.message.length, provider: reply.provider });
  return json(reply);
}, { schema: chatSchema });
