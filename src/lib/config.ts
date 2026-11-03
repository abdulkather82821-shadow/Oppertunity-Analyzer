import { db } from '@/lib/db';

/**
 * Runtime configuration.
 *
 * Every setting an administrator can change is declared HERE, once, with its type, bounds,
 * default and (where one exists) the environment variable that can override it. That registry
 * is the single source of truth for three things that used to drift apart: what the admin panel
 * shows, what is accepted when it is saved, and what the running code actually reads.
 *
 * Precedence, highest first:
 *   1. the environment variable, when set and valid — deploy-time configuration is
 *      authoritative, and it LOCKS the setting in the admin panel rather than being silently
 *      overridden by a value someone typed into a form;
 *   2. the value stored in `platform_config` (edited by a super admin, audited);
 *   3. the built-in default.
 * A stored or environment value that fails validation is ignored in favour of the next level,
 * so a bad value can never take the platform down.
 *
 * The database is read into an in-memory snapshot at most every few seconds (see
 * `refreshConfig`, called once per request), so the many synchronous call sites that need a
 * setting never wait on a query.
 */

export type ConfigType = 'int' | 'enum' | 'list' | 'bool' | 'weights';
export type ConfigCategory = 'search' | 'ai' | 'security' | 'verification' | 'notifications';

export interface ConfigSpec {
  key: string;
  category: ConfigCategory;
  label: string;
  description: string;
  type: ConfigType;
  default: string;
  /** Environment variable that overrides (and locks) this setting when set. */
  env?: string;
  min?: number;
  max?: number;
  /** Allowed values for an enum, or allowed members of a list. */
  options?: readonly string[];
}

export const WEIGHT_KEYS = ['skill', 'qualification', 'experience', 'role', 'location', 'industry', 'salary', 'careerGrowth'] as const;

const DEFAULT_WEIGHTS_JSON = JSON.stringify({ skill: 30, qualification: 20, experience: 15, role: 15, location: 5, industry: 5, salary: 5, careerGrowth: 5 });

export const CONFIG_SPECS: readonly ConfigSpec[] = [
  { key: 'search.default_max_queries', category: 'search', label: 'Queries per analysis', description: 'Maximum search queries generated for one resume analysis.', type: 'int', default: '18', env: 'SEARCH_QUERIES_PER_ANALYSIS', min: 1, max: 40 },
  { key: 'search.max_providers', category: 'search', label: 'Providers per query', description: 'How many configured search providers are asked each query.', type: 'int', default: '2', env: 'SEARCH_MAX_PROVIDERS', min: 1, max: 5 },
  { key: 'search.provider_order', category: 'search', label: 'Search provider order', description: 'Preference order when several search providers are configured.', type: 'list', default: 'tavily,serper,brave,bing,searxng', env: 'SEARCH_PROVIDER_ORDER', options: ['tavily', 'serper', 'brave', 'bing', 'searxng'] },
  { key: 'ai.provider', category: 'ai', label: 'AI provider', description: 'Which AI provider to use. "auto" picks the first configured one; "none" forces the local rule engine.', type: 'enum', default: 'auto', env: 'AI_PROVIDER', options: ['auto', 'openai', 'anthropic', 'gemini', 'none'] },
  { key: 'ai.provider_order', category: 'ai', label: 'AI provider order', description: 'Preference order when several AI providers have credentials.', type: 'list', default: 'openai,anthropic,gemini', env: 'AI_PROVIDER_ORDER', options: ['openai', 'anthropic', 'gemini'] },
  { key: 'ai.scoring_weights', category: 'ai', label: 'Default match weights', description: 'Default weights (0–100 each, normalised automatically) for the private-sector match score. A user\'s own weights override these.', type: 'weights', default: DEFAULT_WEIGHTS_JSON },
  { key: 'ai.max_daily_calls', category: 'ai', label: 'AI calls per user per day', description: 'Successful AI calls one user may trigger in 24 hours. Beyond it the local rule engine answers, and says so.', type: 'int', default: '200', env: 'AI_MAX_DAILY_CALLS', min: 1, max: 100_000 },
  { key: 'security.rate_limit_login', category: 'security', label: 'Login attempts per IP', description: 'Sign-in attempts allowed per IP address in 15 minutes.', type: 'int', default: '10', env: 'RATE_LIMIT_LOGIN', min: 3, max: 200 },
  { key: 'security.require_mfa_for_admin', category: 'security', label: 'Require a second factor for administrators', description: 'Admin and super-admin sessions must pass TOTP verification before privileged actions. Turning this off weakens security.', type: 'bool', default: 'true' },
  { key: 'verification.recheck_hours', category: 'verification', label: 'Re-verification interval (hours)', description: 'Longest time before a record is due for re-checking. Records with a deadline inside a month are re-checked sooner regardless.', type: 'int', default: '72', env: 'VERIFICATION_RECHECK_HOURS', min: 1, max: 720 },
  { key: 'notifications.digest_hour_local', category: 'notifications', label: 'Daily digest hour (IST)', description: 'The scheduled sweep creates daily digests from this hour of the day (India time) onward.', type: 'int', default: '8', env: 'DIGEST_HOUR_LOCAL', min: 0, max: 23 },
];

export interface FlagSpec {
  key: string;
  label: string;
  description: string;
  default: boolean;
}

export const FLAG_SPECS: readonly FlagSpec[] = [
  { key: 'demo_data', label: 'Demonstration listings', description: 'Include the clearly-labelled sample listings in results. Turn off for a production catalogue.', default: true },
  { key: 'resume_optimizer', label: 'Resume optimiser', description: 'Enable the resume ↔ job-description optimiser.', default: true },
  { key: 'browser_notifications', label: 'Browser notifications', description: 'Let candidates switch on desktop notifications.', default: true },
  { key: 'maintenance_mode', label: 'Maintenance mode', description: 'Block changes from non-administrators and show a notice. Reading stays available.', default: false },
];

export function specFor(key: string): ConfigSpec | undefined {
  return CONFIG_SPECS.find((spec) => spec.key === key);
}

// ---------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------

export type Validation = { ok: true; value: string } | { ok: false; error: string };

export function validateConfigValue(spec: ConfigSpec, raw: string): Validation {
  const value = String(raw ?? '').trim();
  switch (spec.type) {
    case 'int': {
      if (!/^-?\d+$/.test(value)) return { ok: false, error: `${spec.label} must be a whole number.` };
      const n = Number(value);
      if (spec.min !== undefined && n < spec.min) return { ok: false, error: `${spec.label} must be at least ${spec.min}.` };
      if (spec.max !== undefined && n > spec.max) return { ok: false, error: `${spec.label} must be at most ${spec.max}.` };
      return { ok: true, value: String(n) };
    }
    case 'enum':
      return spec.options?.includes(value) ? { ok: true, value } : { ok: false, error: `${spec.label} must be one of: ${spec.options?.join(', ')}.` };
    case 'bool':
      return value === 'true' || value === 'false' ? { ok: true, value } : { ok: false, error: `${spec.label} must be "true" or "false".` };
    case 'list': {
      const items = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (items.length === 0) return { ok: false, error: `${spec.label} needs at least one entry.` };
      if (new Set(items).size !== items.length) return { ok: false, error: `${spec.label} lists the same entry twice.` };
      const unknown = items.filter((item) => !spec.options?.includes(item));
      if (unknown.length) return { ok: false, error: `Unknown ${spec.label.toLowerCase()} entry: ${unknown.join(', ')}. Allowed: ${spec.options?.join(', ')}.` };
      return { ok: true, value: items.join(',') };
    }
    case 'weights': {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return { ok: false, error: `${spec.label} must be a JSON object, for example {"skill":30,"qualification":20}.` };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: `${spec.label} must be a JSON object.` };
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) return { ok: false, error: `${spec.label} needs at least one weight.` };
      for (const [name, weight] of entries) {
        if (!(WEIGHT_KEYS as readonly string[]).includes(name)) return { ok: false, error: `Unknown weight "${name}". Allowed: ${WEIGHT_KEYS.join(', ')}.` };
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) return { ok: false, error: `Weight "${name}" must be a number from 0 to 100.` };
      }
      // A configuration where every weight is zero would make every score zero.
      const merged = { ...JSON.parse(DEFAULT_WEIGHTS_JSON), ...(parsed as Record<string, number>) } as Record<string, number>;
      if (Object.values(merged).reduce((a, b) => a + b, 0) <= 0) return { ok: false, error: 'At least one weight must be greater than zero.' };
      return { ok: true, value: JSON.stringify(parsed) };
    }
  }
}

// ---------------------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------------------

const TTL_MS = 10_000;
let values = new Map<string, string>();
let flags = new Map<string, boolean>();
let loadedAt = 0;
let inflight: Promise<void> | null = null;

/** Reloads the snapshot from the database if it is older than a few seconds. Never throws. */
export async function refreshConfig(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [configRows, flagRows] = await Promise.all([
        db.query<{ key: string; value: string }>('SELECT key, value FROM platform_config'),
        db.query<{ key: string; enabled: unknown }>('SELECT key, enabled FROM feature_flags'),
      ]);
      values = new Map(configRows.map((row) => [row.key, row.value]));
      flags = new Map(flagRows.map((row) => [row.key, Number(row.enabled) === 1 || row.enabled === true]));
      loadedAt = Date.now();
    } catch {
      // Keep the previous snapshot: a brief database problem must not change behaviour.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget everything (used after an admin change, and by tests). */
export function resetConfigCache(): void {
  values = new Map();
  flags = new Map();
  loadedAt = 0;
}

export type ConfigSource = 'environment' | 'database' | 'default';

export function resolveConfig(key: string): { value: string; source: ConfigSource; envVar: string | null } {
  const spec = specFor(key);
  if (!spec) throw new Error(`Unknown configuration key: ${key}`);
  const fromEnv = spec.env ? process.env[spec.env] : undefined;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const checked = validateConfigValue(spec, fromEnv);
    if (checked.ok) return { value: checked.value, source: 'environment', envVar: spec.env ?? null };
  }
  const stored = values.get(key);
  if (stored !== undefined) {
    const checked = validateConfigValue(spec, stored);
    if (checked.ok) return { value: checked.value, source: 'database', envVar: spec.env ?? null };
  }
  return { value: spec.default, source: 'default', envVar: spec.env ?? null };
}

export const configValue = (key: string): string => resolveConfig(key).value;
export const configInt = (key: string): number => Number(resolveConfig(key).value);
export const configBool = (key: string): boolean => resolveConfig(key).value === 'true';
export const configList = (key: string): string[] => resolveConfig(key).value.split(',').map((item) => item.trim()).filter(Boolean);

/** The stored weights override, or null when none is configured (the built-in defaults apply). */
export function configWeights(): Record<string, number> | null {
  const resolved = resolveConfig('ai.scoring_weights');
  return resolved.source === 'default' ? null : (JSON.parse(resolved.value) as Record<string, number>);
}

export function flagEnabled(key: string): boolean {
  const spec = FLAG_SPECS.find((flag) => flag.key === key);
  if (!spec) throw new Error(`Unknown feature flag: ${key}`);
  return flags.has(key) ? (flags.get(key) as boolean) : spec.default;
}

export function flagSource(key: string): 'database' | 'default' {
  return flags.has(key) ? 'database' : 'default';
}
