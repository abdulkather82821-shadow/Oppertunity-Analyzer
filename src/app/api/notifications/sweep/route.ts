import { route, json } from '@/lib/api/route';
import { assertCsrf } from '@/lib/auth/csrf';
import { requirePermission } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit';
import { deliverPendingEmails, runNotificationSweep, secretMatches } from '@/lib/notifications';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/notifications/sweep — background alert + digest generation and email delivery.
 *
 * Two ways in, both deliberate:
 *   • a scheduler presents `x-cron-secret` matching CRON_SECRET (no cookies involved, so CSRF
 *     does not apply and is not checked);
 *   • a signed-in operator with `system.configure` (MFA-gated), in which case the normal CSRF
 *     check is enforced by hand because this route opts out of the wrapper's check.
 * With CRON_SECRET unset the header path is closed entirely rather than open.
 */
export const POST = route(async (request, { meta }) => {
  const viaCron = secretMatches(request.headers.get('x-cron-secret'), process.env.CRON_SECRET);
  let actor: string | null = null;
  if (!viaCron) {
    await assertCsrf(request);
    const { user } = await requirePermission(request, 'system.configure');
    actor = user.id;
  }

  const sweep = await runNotificationSweep();
  const delivery = await deliverPendingEmails();

  await audit({
    userId: actor,
    action: 'notifications.sweep',
    resourceType: 'notifications',
    resourceId: '*',
    newValue: { alertsCreated: sweep.alertsCreated, digestsCreated: sweep.digestsCreated, emailSent: delivery.sent, via: viaCron ? 'cron' : 'operator' },
    reason: viaCron ? 'scheduled sweep' : 'operator-triggered sweep',
    ip: meta.ip,
  });
  return json({ sweep, delivery });
}, { csrf: false });
