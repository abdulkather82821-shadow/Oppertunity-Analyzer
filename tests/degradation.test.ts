import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { useTempDb } from './helpers/db';
import { db } from '@/lib/db';
import { HEURISTIC_PROVIDER, aiStatus, runAi } from '@/lib/ai';
import { resolveSearchProviders, runSearch, searchStatus, fetchPageText } from '@/lib/search';
import { blockedFetchTarget, clearRobotsCache, isAllowed, parseRobots, pathMatches } from '@/lib/search/robots';
import { verifyFromSources } from '@/lib/opportunity/verification';
import { enrichOpportunity } from '@/lib/api/enrich';

useTempDb();

/**
 * Graceful degradation (spec §51).
 *
 * Every external dependency — the AI provider, the search API, a target website — can be
 * missing, slow, blocked or wrong. The contract is the same each time: keep working, say
 * exactly what happened, and never present a fallback as if it were the real thing.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearRobotsCache();
});

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const failing = (status: number, text = 'error') => ({ ok: false, status, json: async () => ({}), text: async () => text });
const completion = (content: string) => okJson({ choices: [{ message: { content } }], model: 'test-model', usage: { prompt_tokens: 3, completion_tokens: 4 } });

function configureOpenAi() {
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('AI_PROVIDER', 'openai');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('GEMINI_API_KEY', '');
  vi.stubEnv('GOOGLE_AI_API_KEY', '');
}

const Answer = z.object({ answer: z.string() });
const ask = () =>
  runAi({ task: 'chat', system: 'Reply in JSON.', input: { q: 'hi' }, schema: Answer, fallback: () => ({ answer: 'from local rules' }) });

describe('AI provider failures', () => {
  it('works with no provider at all and labels the result as local rules', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_AI_API_KEY', '');
    const outcome = await ask();
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.provider).toBe(HEURISTIC_PROVIDER);
    expect(outcome.data.answer).toBe('from local rules');
    expect(aiStatus().configured).toBe(false);
  });

  it('falls back after a network failure, retrying once first', async () => {
    configureOpenAi();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unreachable'));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await ask();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.provider).toBe(HEURISTIC_PROVIDER);
    expect(outcome.error).toMatch(/network unreachable/);
  });

  it('falls back on an HTTP error such as a revoked key', async () => {
    configureOpenAi();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failing(401, 'invalid api key')));
    const outcome = await ask();
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.error).toMatch(/401/);
  });

  it('recovers when the first reply is not JSON but the retry is', async () => {
    configureOpenAi();
    const fetchMock = vi.fn().mockResolvedValueOnce(completion('Sure! Here is my answer.')).mockResolvedValueOnce(completion('{"answer":"real model answer"}'));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await ask();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.usedFallback).toBe(false);
    expect(outcome.provider).toBe('openai');
    expect(outcome.data.answer).toBe('real model answer');
  });

  it('rejects output that fails the schema rather than trusting it', async () => {
    configureOpenAi();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(completion('{"wrong":"shape"}')));
    const outcome = await ask();
    expect(outcome.usedFallback).toBe(true);
    expect(outcome.data).toEqual({ answer: 'from local rules' });
    expect(outcome.error).toMatch(/schema/i);
  });
});

describe('search provider failures', () => {
  it('uses the local catalogue when no search API is configured, and says it is not live', () => {
    for (const key of ['TAVILY_API_KEY', 'SERPER_API_KEY', 'BRAVE_API_KEY', 'BING_API_KEY', 'SEARXNG_URL']) vi.stubEnv(key, '');
    vi.stubEnv('SEARCH_PROVIDER', 'auto');
    expect(resolveSearchProviders().map((p) => p.id)).toEqual(['local-catalog']);
    expect(searchStatus().live).toBe(false);
  });

  it('reports a failing provider as failed instead of throwing or inventing results', async () => {
    vi.stubEnv('SEARCH_PROVIDER', 'tavily');
    vi.stubEnv('TAVILY_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const outcome = await runSearch('accountant jobs chennai');
    expect(outcome.status).toBe('failed');
    expect(outcome.hits).toEqual([]);
    expect(outcome.error).toMatch(/ECONNRESET/);
    const log = await db.one<any>("SELECT status, results FROM search_logs WHERE query = 'accountant jobs chennai'");
    expect(log.status).toBe('failed');
    expect(Number(log.results)).toBe(0);
  });

  it('distinguishes rate limiting from blocking', async () => {
    vi.stubEnv('SEARCH_PROVIDER', 'tavily');
    vi.stubEnv('TAVILY_API_KEY', 'k');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failing(429, 'slow down')));
    expect((await runSearch('q-rate')).status).toBe('rate_limited');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failing(403, 'forbidden')));
    expect((await runSearch('q-blocked')).status).toBe('blocked');
  });

  it('keeps the results it did get and de-duplicates them by URL, preferring the more official copy', async () => {
    vi.stubEnv('SEARCH_PROVIDER', 'tavily');
    vi.stubEnv('TAVILY_API_KEY', 'k');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJson({
          results: [
            { title: 'SSC CGL', url: 'https://ssc.gov.in/cgl', content: 'official' },
            { title: 'SSC CGL (copy)', url: 'https://ssc.gov.in/cgl', content: 'duplicate of the same URL' },
            { title: 'Blog', url: 'https://some-blog.example.com/ssc', content: 'unofficial' },
          ],
        }),
      ),
    );
    const outcome = await runSearch('ssc cgl');
    expect(outcome.status).toBe('ok');
    expect(outcome.hits.map((h) => h.url)).toEqual(['https://ssc.gov.in/cgl', 'https://some-blog.example.com/ssc']);
    expect(outcome.hits[0].tier).toBe(1); // re-tiered against the official-domain list, not trusted from the provider
  });
});

describe('robots.txt and fetch safety', () => {
  const robotsFor = (body: string, status = 200) =>
    vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/robots.txt')) return { ok: status === 200, status, text: async () => body };
      return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('<p>hello</p>').buffer };
    });

  it('fails closed when robots.txt cannot be retrieved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const verdict = await isAllowed('https://closed-one.example.org/jobs');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/fail closed/i);
  });

  it('fails closed on a server error for robots.txt, but treats a 404 as "no restrictions"', async () => {
    vi.stubGlobal('fetch', robotsFor('', 500));
    expect((await isAllowed('https://five-hundred.example.org/x')).allowed).toBe(false);
    clearRobotsCache();
    vi.stubGlobal('fetch', robotsFor('', 404));
    expect((await isAllowed('https://no-robots.example.org/x')).allowed).toBe(true);
  });

  it('honours Disallow rules, including prefix semantics and the $ anchor', async () => {
    vi.stubGlobal('fetch', robotsFor('User-agent: *\nDisallow: /private\nDisallow: /*.pdf$\nAllow: /private/public\n'));
    const at = (path: string) => isAllowed(`https://rules.example.org${path}`);
    expect((await at('/jobs')).allowed).toBe(true);
    expect((await at('/private/files')).allowed).toBe(false);
    expect((await at('/privatefoo')).allowed).toBe(false); // standard prefix match
    expect((await at('/notice.pdf')).allowed).toBe(false); // `$` anchors the end
    expect((await at('/notice.pdf.html')).allowed).toBe(true); // ...and only the end
    expect((await at('/private/public/page')).allowed).toBe(true); // the longer Allow wins
  });

  it('shares one rule group across consecutive User-agent lines', () => {
    const rules = parseRobots('User-agent: opportunityanalyzerai\nUser-agent: otherbot\nDisallow: /secret\n');
    expect(rules).toHaveLength(2);
    // Both agents are bound by the rule; without grouping the first would be left unrestricted.
    for (const rule of rules) expect(rule.disallow).toEqual(['/secret']);
  });

  it('applies rules addressed to this crawler, ahead of the wildcard group', async () => {
    vi.stubGlobal('fetch', robotsFor('User-agent: *\nDisallow:\n\nUser-agent: OpportunityAnalyzerAI\nDisallow: /\n'));
    expect((await isAllowed('https://named-bot.example.org/jobs')).allowed).toBe(false);
  });

  it('does not request the page at all when robots.txt forbids it', async () => {
    const fetchMock = robotsFor('User-agent: *\nDisallow: /');
    vi.stubGlobal('fetch', fetchMock);
    const page = await fetchPageText('https://walled.example.org/careers');
    expect(page).toMatchObject({ ok: false, text: '' });
    expect(page.reason).toMatch(/robots\.txt/i);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(['https://walled.example.org/robots.txt']);
  });

  it('refuses non-http schemes and private, loopback and metadata addresses', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.org/x',
      'javascript:alert(1)',
      'http://localhost:3000/api/admin',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.9/',
      'http://[::1]/',
      'http://[fd00::1]/',
      'http://[::ffff:10.0.0.1]/',
      'http://db.internal/',
    ]) {
      expect((await isAllowed(url)).allowed, url).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled(); // refused before any network traffic
  });

  it('does not over-block ordinary public addresses', () => {
    for (const host of ['ssc.gov.in', 'www.upsc.gov.in', '8.8.8.8', '172.32.0.1', '100.63.0.1', '2001:4860:4860::8888']) {
      expect(blockedFetchTarget(host), host).toBeNull();
    }
  });

  it('matches path patterns the way the standard describes', () => {
    expect(pathMatches('/a', '/a')).toBe(true);
    expect(pathMatches('/a', '/ab')).toBe(true);
    expect(pathMatches('/a$', '/ab')).toBe(false);
    expect(pathMatches('/a*/c', '/a/b/c')).toBe(true);
    expect(pathMatches('', '/anything')).toBe(false);
  });
});

describe('conflicting and thin evidence', () => {
  const src = (url: string, tier: number, isOfficial: boolean, claims: Record<string, string>) => ({ url, tier, isOfficial, sourceDate: null, claims });

  it('reports both values and names the official one, instead of silently picking', () => {
    const report = verifyFromSources([
      src('https://ssc.gov.in/n', 1, true, { 'application deadline': '2026-06-25' }),
      src('https://blog.example.com/n', 4, false, { 'application deadline': '2026-06-22' }),
    ]);
    expect(report.outcome).toBe('conflicting');
    const field = report.conflicts.find((c) => c.field === 'application deadline')!;
    expect(field.values.map((v) => v.value).sort()).toEqual(['2026-06-22', '2026-06-25']);
    expect(field.chosen).toBe('2026-06-25'); // authoritative only because an official source exists
    expect(field.note).toMatch(/official/i);
  });

  it('refuses to choose when no official source exists', () => {
    const report = verifyFromSources([
      src('https://blog-a.example.com/n', 4, false, { 'application deadline': '2026-06-25' }),
      src('https://blog-b.example.com/n', 4, false, { 'application deadline': '2026-06-22' }),
    ]);
    const field = report.conflicts[0];
    expect(field.chosen).toBeNull();
    expect(field.note).toMatch(/no official source/i);
  });

  it('never calls an unofficial-only listing verified', () => {
    const report = verifyFromSources([
      src('https://a.example.com/n', 4, false, { 'application deadline': '2026-06-25' }),
      src('https://b.example.com/n', 4, false, { 'application deadline': '2026-06-25' }),
    ]);
    expect(report.outcome).toBe('needs_verification');
  });

  it('treats an absent field as unknown, not as a guess', () => {
    const report = verifyFromSources([src('https://a.example.com/n', 4, false, {})]);
    expect(report.fields.every((f) => f.chosen === null && f.confidence === 'unknown')).toBe(true);
  });

  it('shows "Unknown" for a record that states nothing, without throwing', () => {
    const view = enrichOpportunity({ id: 'x', title: 'Mystery role', type: 'job', status: 'needs_verification', locations: '[]' }, null);
    expect(view.locationSummary).toBe('Unknown');
    expect(view.deadlineDays).toBeNull();
    expect(view.isClosed).toBe(false);
    expect(view.personalised).toBe(false);
  });
});
