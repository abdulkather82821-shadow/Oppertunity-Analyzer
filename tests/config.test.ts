import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTempDb } from './helpers/db';
import { db, insertRow, nowIso } from '@/lib/db';
import {
  CONFIG_SPECS,
  FLAG_SPECS,
  configBool,
  configInt,
  configList,
  configWeights,
  flagEnabled,
  refreshConfig,
  resetConfigCache,
  resolveConfig,
  specFor,
  validateConfigValue,
} from '@/lib/config';
import { mfaRequiredFor } from '@/lib/auth/mfa-policy';
import { resolveProvider, runAi } from '@/lib/ai';
import { resolveSearchProviders, runSearch } from '@/lib/search';
import { generateQueriesDeterministic } from '@/lib/opportunity/query-generator';
import { profileCandidate } from '@/lib/analysis/profiler';
import { parseResume } from '@/lib/analysis/resume-parser';
import { normaliseWeights, DEFAULT_WEIGHTS } from '@/lib/opportunity/matcher';
import { nextVerificationDate } from '@/lib/opportunity/deadline';
import { SEED_PLATFORM_CONFIG, SEED_FEATURE_FLAGS } from '@/lib/db/seed-data';
import { z } from 'zod';

useTempDb();

/**
 * Administrator settings.
 *
 * The rule this file enforces: a setting that can be edited must DO something. Each test saves
 * a value the way the admin panel does and then checks that the code that uses it changed its
 * behaviour — because the platform once shipped a whole panel of settings that nothing read.
 */

async function store(key: string, value: string) {
  const exists = await db.one('SELECT key FROM platform_config WHERE key = ?', [key]);
  if (exists) await db.run('UPDATE platform_config SET value = ? WHERE key = ?', [value, key]);
  else await insertRow('platform_config', { key, value, is_secret: 0, category: 'test', description: '', updated_at: nowIso() });
  await refreshConfig(true);
}

async function setFlag(key: string, enabled: boolean) {
  const exists = await db.one('SELECT key FROM feature_flags WHERE key = ?', [key]);
  if (exists) await db.run('UPDATE feature_flags SET enabled = ? WHERE key = ?', [enabled ? 1 : 0, key]);
  else await insertRow('feature_flags', { key, enabled: enabled ? 1 : 0, description: '', updated_at: nowIso() });
  await refreshConfig(true);
}

beforeEach(async () => {
  await db.run('DELETE FROM platform_config');
  await db.run('DELETE FROM feature_flags');
  resetConfigCache();
  for (const spec of CONFIG_SPECS) if (spec.env) vi.stubEnv(spec.env, '');
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'TAVILY_API_KEY', 'SERPER_API_KEY', 'BRAVE_API_KEY', 'BING_API_KEY', 'SEARXNG_URL']) {
    vi.stubEnv(key, '');
  }
  await refreshConfig(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('the registry', () => {
  it('has unique keys and environment variables', () => {
    const keys = CONFIG_SPECS.map((spec) => spec.key);
    expect(new Set(keys).size).toBe(keys.length);
    const envs = CONFIG_SPECS.map((spec) => spec.env).filter(Boolean);
    expect(new Set(envs).size).toBe(envs.length);
    const flags = FLAG_SPECS.map((flag) => flag.key);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('ships defaults that pass their own validation', () => {
    for (const spec of CONFIG_SPECS) {
      const checked = validateConfigValue(spec, spec.default);
      expect(checked.ok, `${spec.key}: ${checked.ok ? '' : checked.error}`).toBe(true);
    }
  });

  it('seeds the database from the registry, so the two cannot drift', () => {
    expect(SEED_PLATFORM_CONFIG.map((row) => row.key).sort()).toEqual(CONFIG_SPECS.map((spec) => spec.key).sort());
    expect(SEED_FEATURE_FLAGS.map((row) => row.key).sort()).toEqual(FLAG_SPECS.map((flag) => flag.key).sort());
  });

  it('keeps the built-in matching weights and the registry default in step', () => {
    const fromRegistry = JSON.parse(specFor('ai.scoring_weights')!.default) as Record<string, number>;
    expect(fromRegistry).toEqual({ ...DEFAULT_WEIGHTS });
  });
});

describe('validation', () => {
  const spec = (key: string) => specFor(key)!;
  const bad = (key: string, value: string) => {
    const result = validateConfigValue(spec(key), value);
    return result.ok ? null : result.error;
  };

  it('accepts whole numbers inside the bounds and refuses the rest', () => {
    expect(validateConfigValue(spec('search.max_providers'), ' 3 ')).toEqual({ ok: true, value: '3' });
    expect(bad('search.max_providers', 'banana')).toMatch(/whole number/);
    expect(bad('search.max_providers', '2.5')).toMatch(/whole number/);
    expect(bad('search.max_providers', '0')).toMatch(/at least 1/);
    expect(bad('search.max_providers', '99')).toMatch(/at most 5/);
    expect(bad('notifications.digest_hour_local', '24')).toMatch(/at most 23/);
  });

  it('accepts only listed enum values and booleans', () => {
    expect(validateConfigValue(spec('ai.provider'), 'anthropic').ok).toBe(true);
    expect(bad('ai.provider', 'skynet')).toMatch(/one of/);
    expect(bad('security.require_mfa_for_admin', 'yes')).toMatch(/"true" or "false"/);
  });

  it('checks provider lists: known members only, no repeats, not empty', () => {
    expect(validateConfigValue(spec('search.provider_order'), 'brave, tavily')).toEqual({ ok: true, value: 'brave,tavily' });
    expect(bad('search.provider_order', 'tavily,google-scraper')).toMatch(/Unknown .*google-scraper/);
    expect(bad('search.provider_order', 'tavily,tavily')).toMatch(/twice/);
    expect(bad('search.provider_order', ' , ')).toMatch(/at least one/);
  });

  it('checks scoring weights: real keys, sane numbers, not all zero', () => {
    expect(validateConfigValue(spec('ai.scoring_weights'), '{"skill":50}').ok).toBe(true);
    expect(bad('ai.scoring_weights', 'not json')).toMatch(/JSON/);
    expect(bad('ai.scoring_weights', '[1,2]')).toMatch(/JSON object/);
    expect(bad('ai.scoring_weights', '{"charisma":10}')).toMatch(/Unknown weight/);
    expect(bad('ai.scoring_weights', '{"skill":-5}')).toMatch(/0 to 100/);
    expect(bad('ai.scoring_weights', '{"skill":"high"}')).toMatch(/0 to 100/);
    const allZero = JSON.stringify(Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((key) => [key, 0])));
    expect(bad('ai.scoring_weights', allZero)).toMatch(/greater than zero/);
  });
});

describe('precedence', () => {
  it('uses the default, then the stored value, then the environment', async () => {
    expect(resolveConfig('search.max_providers')).toMatchObject({ value: '2', source: 'default' });
    await store('search.max_providers', '4');
    expect(resolveConfig('search.max_providers')).toMatchObject({ value: '4', source: 'database' });
    vi.stubEnv('SEARCH_MAX_PROVIDERS', '1');
    expect(resolveConfig('search.max_providers')).toMatchObject({ value: '1', source: 'environment', envVar: 'SEARCH_MAX_PROVIDERS' });
  });

  it('ignores an invalid stored or environment value rather than breaking', async () => {
    await store('search.max_providers', 'banana');
    expect(configInt('search.max_providers')).toBe(2); // falls back to the default
    vi.stubEnv('SEARCH_MAX_PROVIDERS', '9999');
    expect(resolveConfig('search.max_providers').source).toBe('default'); // bad env ignored too
    await store('search.max_providers', '3');
    expect(resolveConfig('search.max_providers')).toMatchObject({ value: '3', source: 'database' });
  });

  it('keeps the last good snapshot if the database cannot be read', async () => {
    await store('search.max_providers', '4');
    const real = db.query;
    (db as unknown as { query: unknown }).query = async () => {
      throw new Error('database unavailable');
    };
    try {
      await refreshConfig(true);
      expect(configInt('search.max_providers')).toBe(4);
    } finally {
      (db as unknown as { query: unknown }).query = real;
    }
  });

  it('reads feature flags from the database, with a default when unset', async () => {
    expect(flagEnabled('demo_data')).toBe(true);
    expect(flagEnabled('maintenance_mode')).toBe(false);
    await setFlag('demo_data', false);
    await setFlag('maintenance_mode', true);
    expect(flagEnabled('demo_data')).toBe(false);
    expect(flagEnabled('maintenance_mode')).toBe(true);
    expect(() => flagEnabled('no_such_flag')).toThrow(/Unknown feature flag/);
    expect(() => configInt('no.such.key')).toThrow(/Unknown configuration key/);
  });
});

describe('settings change behaviour', () => {
  it('ai.provider = none forces the local engine even when a key is present', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(resolveProvider()?.id).toBe('openai');
    await store('ai.provider', 'none');
    expect(resolveProvider()).toBeNull();
  });

  it('ai.provider_order decides which configured provider is used', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    expect(resolveProvider()?.id).toBe('openai');
    await store('ai.provider_order', 'anthropic,openai');
    expect(resolveProvider()?.id).toBe('anthropic');
  });

  it('search.provider_order decides which search API is tried first', async () => {
    vi.stubEnv('TAVILY_API_KEY', 't');
    vi.stubEnv('BRAVE_API_KEY', 'b');
    vi.stubEnv('SEARCH_PROVIDER', 'auto');
    expect(resolveSearchProviders().map((p) => p.id)).toEqual(['tavily', 'brave']);
    await store('search.provider_order', 'brave,tavily');
    expect(resolveSearchProviders().map((p) => p.id)).toEqual(['brave', 'tavily']);
  });

  it('ai.scoring_weights replaces the default weights, and a user\'s own weights still win', async () => {
    expect(configWeights()).toBeNull();
    expect(normaliseWeights(null).skill).toBeCloseTo(30);

    await store('ai.scoring_weights', JSON.stringify({ skill: 70, qualification: 10, experience: 10, role: 10, location: 0, industry: 0, salary: 0, careerGrowth: 0 }));
    const configured = normaliseWeights(null);
    expect(configured.skill).toBeCloseTo(70);
    expect(Object.values(configured).reduce((a, b) => a + b, 0)).toBeCloseTo(100);

    const personal = normaliseWeights({ skill: 10, qualification: 10, experience: 10, role: 10, location: 10, industry: 10, salary: 10, careerGrowth: 10 });
    expect(personal.skill).toBeCloseTo(12.5);
  });

  it('verification.recheck_hours caps how long a record can go unchecked', async () => {
    const t0 = new Date('2026-10-01T00:00:00.000Z');
    const hoursUntil = (iso: string) => (new Date(iso).getTime() - t0.getTime()) / 3_600_000;
    expect(hoursUntil(nextVerificationDate(null, null, t0))).toBe(72);
    expect(hoursUntil(nextVerificationDate('2026-12-31', null, t0))).toBe(72);
    await store('verification.recheck_hours', '12');
    expect(hoursUntil(nextVerificationDate(null, null, t0))).toBe(12);
    expect(hoursUntil(nextVerificationDate('2026-12-31', null, t0))).toBe(12);
    // A deadline-critical record is re-checked sooner than the ceiling, however long it is set.
    await store('verification.recheck_hours', '500');
    expect(hoursUntil(nextVerificationDate('2026-10-02', null, t0))).toBe(6);
  });

  it('security.require_mfa_for_admin switches MFA enforcement for eligible roles only', async () => {
    expect(mfaRequiredFor('admin')).toBe(true);
    expect(mfaRequiredFor('super_admin')).toBe(true);
    expect(mfaRequiredFor('candidate')).toBe(false);
    await store('security.require_mfa_for_admin', 'false');
    expect(configBool('security.require_mfa_for_admin')).toBe(false);
    expect(mfaRequiredFor('admin')).toBe(false);
    expect(mfaRequiredFor('candidate')).toBe(false);
  });

  it('ai.max_daily_calls sends a user who has used their allowance to the local engine, and says so', async () => {
    const userId = 'cap-user';
    const now = nowIso();
    await insertRow('users', { id: userId, email: 'cap@example.test', name: 'Cap', role: 'candidate', created_at: now, updated_at: now });
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('AI_PROVIDER', 'openai');
    const ok = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"answer":"from the model"}' } }], model: 'm', usage: {} }), text: async () => '' };
    const fetchMock = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal('fetch', fetchMock);
    const ask = () =>
      runAi({ task: 'chat', system: 's', input: {}, userId, schema: z.object({ answer: z.string() }), fallback: () => ({ answer: 'from local rules' }) });

    await store('ai.max_daily_calls', '2');
    expect((await ask()).data.answer).toBe('from the model');
    expect((await ask()).data.answer).toBe('from the model');
    const third = await ask();
    expect(third.usedFallback).toBe(true);
    expect(third.data.answer).toBe('from local rules');
    expect(third.error).toMatch(/Daily AI call limit \(2\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the third request never reached the provider

    // Raising the limit takes effect straight away.
    await store('ai.max_daily_calls', '50');
    expect((await ask()).data.answer).toBe('from the model');
  });

  it('search.default_max_queries caps how many queries one analysis generates; an explicit cap still wins', async () => {
    const profile = profileCandidate(parseResume('PRIYA RAMESH\nChennai\nEDUCATION\nBachelor of Commerce (B.Com), Accounting & Finance\nUniversity of Madras - 2025\nSKILLS\nTally ERP 9, MS Excel, GST Filing, TDS, Bank Reconciliation\n'));
    const input = { profile, locations: ['Chennai', 'Tamil Nadu', 'India'] };
    expect(generateQueriesDeterministic(input).length).toBeGreaterThan(10); // the default of 18 applies
    await store('search.default_max_queries', '5');
    expect(generateQueriesDeterministic(input)).toHaveLength(5);
    expect(generateQueriesDeterministic({ ...input, maxQueries: 3 })).toHaveLength(3);
  });

  it('search.max_providers limits how many search providers each query is sent to', async () => {
    vi.stubEnv('TAVILY_API_KEY', 't');
    vi.stubEnv('BRAVE_API_KEY', 'b');
    vi.stubEnv('SEARCH_PROVIDER', 'auto');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ results: [], web: { results: [] } }), text: async () => '' };
    }));

    await store('search.max_providers', '1');
    await runSearch('query one');
    expect(urls).toHaveLength(1);

    urls.length = 0;
    await store('search.max_providers', '2');
    await runSearch('query two');
    expect(urls).toHaveLength(2);
    expect(new Set(urls.map((u) => new URL(u).hostname)).size).toBe(2); // two different providers
  });

  it('exposes list settings as arrays in order', async () => {
    await store('ai.provider_order', 'gemini,openai');
    expect(configList('ai.provider_order')).toEqual(['gemini', 'openai']);
  });
});
