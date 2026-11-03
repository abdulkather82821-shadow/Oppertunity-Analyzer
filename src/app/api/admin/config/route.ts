import type { z } from 'zod';
import { route, json } from '@/lib/api/route';
import { adminConfigSchema } from '@/lib/api/schemas';
import { db, nowIso } from '@/lib/db';
import { ApiError, badRequest, forbidden, requirePermission } from '@/lib/auth/rbac';
import { audit } from '@/lib/audit';
import { aiStatus } from '@/lib/ai';
import { searchStatus } from '@/lib/search';
import { emailStatus } from '@/lib/notifications';
import {
  CONFIG_SPECS,
  FLAG_SPECS,
  flagEnabled,
  flagSource,
  refreshConfig,
  resetConfigCache,
  resolveConfig,
  specFor,
  validateConfigValue,
} from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/config — every administrator-adjustable setting with its EFFECTIVE value, and
 * where that value comes from (environment, database or built-in default). Secret values are
 * never part of this: API keys live only in the environment and are reported as present/absent.
 */
export const GET = route(async (request) => {
  await requirePermission(request, 'system.read');
  await refreshConfig(true);

  const settings = CONFIG_SPECS.map((spec) => {
    const resolved = resolveConfig(spec.key);
    return {
      key: spec.key,
      category: spec.category,
      label: spec.label,
      description: spec.description,
      type: spec.type,
      options: spec.options ?? null,
      min: spec.min ?? null,
      max: spec.max ?? null,
      default: spec.default,
      value: resolved.value,
      source: resolved.source,
      // An environment variable is deploy-time configuration and wins; it cannot be edited here.
      locked: resolved.source === 'environment',
      envVar: resolved.envVar,
    };
  });

  const featureFlags = FLAG_SPECS.map((flag) => ({
    key: flag.key,
    label: flag.label,
    description: flag.description,
    enabled: flagEnabled(flag.key),
    source: flagSource(flag.key),
  }));

  const email = emailStatus();
  const envSummary = {
    database: process.env.DATABASE_URL?.startsWith('postgres') ? 'postgresql' : 'sqlite',
    sessionSecret: Boolean(process.env.SESSION_SECRET ?? process.env.AUTH_SECRET),
    encryptionKey: Boolean(process.env.ENCRYPTION_KEY),
    // Reported from the same check the notifier itself uses, so this can never say "email is
    // configured" while deliveries are in fact being skipped.
    emailProvider: email.provider ?? 'not configured',
    emailConfigured: email.configured,
    cronSecretSet: Boolean(process.env.CRON_SECRET),
    clamav: Boolean(process.env.CLAMD_HOST),
  };

  return json({ settings, featureFlags, envSummary, ai: aiStatus(), search: searchStatus() });
}, { csrf: false });

/**
 * PUT /api/admin/config — super admin only.
 *
 * Two shapes: `{ key, value }` changes a setting, `{ flag, enabled }` flips a feature flag.
 * Anything not in the registry is refused (a typo must not silently create a setting that does
 * nothing), values are validated against the setting's type and bounds, and a setting pinned by
 * an environment variable is refused rather than quietly shadowed. Every change is audited with
 * its previous value.
 */
export const PUT = route<z.infer<typeof adminConfigSchema>>(async (request, { body, meta }) => {
  const { user } = await requirePermission(request, 'system.configure');
  if (user.role !== 'super_admin') throw forbidden('Only a super admin can change platform configuration.');
  const actor = { userId: user.id, actorEmail: user.email, actorRole: user.role, ip: meta.ip };
  const now = nowIso();

  // ---- feature flag ---------------------------------------------------------------------------
  if ('flag' in body) {
    const spec = FLAG_SPECS.find((flag) => flag.key === body.flag);
    if (!spec) throw badRequest(`Unknown feature flag "${body.flag}".`);
    await refreshConfig(true);
    const before = flagEnabled(spec.key);

    const existing = await db.one('SELECT key FROM feature_flags WHERE key = ?', [spec.key]);
    if (existing) await db.run('UPDATE feature_flags SET enabled = ?, updated_at = ? WHERE key = ?', [body.enabled ? 1 : 0, now, spec.key]);
    else await db.run('INSERT INTO feature_flags (key, enabled, description, updated_at) VALUES (?, ?, ?, ?)', [spec.key, body.enabled ? 1 : 0, spec.description, now]);

    // Demonstration listings are switched by visibility: every query already filters on
    // `is_active`, so flipping these rows hides or shows them in lists, stats, the digest, chat
    // and alerts at once, instead of each of those having to remember to check the flag.
    if (spec.key === 'demo_data') await db.run('UPDATE opportunities SET is_active = ? WHERE is_demo = 1', [body.enabled ? 1 : 0]);

    resetConfigCache();
    await audit({ ...actor, action: 'system.configure', resourceType: 'feature_flag', resourceId: spec.key, previousValue: before, newValue: body.enabled, reason: body.reason ?? 'feature flag change' });
    return json({ ok: true, flag: spec.key, enabled: body.enabled });
  }

  // ---- setting --------------------------------------------------------------------------------
  const spec = specFor(body.key);
  if (!spec) throw badRequest(`Unknown setting "${body.key}". Only the settings listed in the Configuration panel can be changed.`);
  await refreshConfig(true);
  const current = resolveConfig(spec.key);
  if (current.source === 'environment') {
    throw new ApiError(409, `"${spec.label}" is fixed by the ${spec.env} environment variable. Change or remove that variable to edit it here.`, 'locked_by_environment');
  }
  const checked = validateConfigValue(spec, body.value);
  if (!checked.ok) throw badRequest(checked.error);

  const existing = await db.one('SELECT key FROM platform_config WHERE key = ?', [spec.key]);
  if (existing) await db.run('UPDATE platform_config SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?', [checked.value, user.id, now, spec.key]);
  else {
    await db.run(
      'INSERT INTO platform_config (key, value, is_secret, category, description, updated_by, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
      [spec.key, checked.value, spec.category, spec.description, user.id, now],
    );
  }

  resetConfigCache();
  await audit({ ...actor, action: 'system.configure', resourceType: 'platform_config', resourceId: spec.key, previousValue: current.value, newValue: checked.value, reason: body.reason ?? 'configuration change' });
  return json({ ok: true, key: spec.key, value: checked.value });
}, { schema: adminConfigSchema });
