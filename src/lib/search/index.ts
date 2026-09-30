import { configInt, configList } from '@/lib/config';
import { db, nowIso, uid } from '@/lib/db';
import { tierForUrl } from '@/lib/opportunity/trust';
import { USER_AGENT, isAllowed } from './robots';
import type { SearchHit, SearchOutcome, SearchProvider } from './types';
import { tavilyProvider, serperProvider, braveProvider, bingProvider, searxngProvider } from './providers';
import { localCatalogProvider } from './local-catalog';

export const SEARCH_PROVIDERS: SearchProvider[] = [
  tavilyProvider,
  serperProvider,
  braveProvider,
  bingProvider,
  searxngProvider,
  localCatalogProvider,
];

/**
 * Provider selection:
 *   SEARCH_PROVIDER=auto  → first configured API provider, else the local catalogue
 *   SEARCH_PROVIDER=<id>  → that provider exclusively
 *   SEARCH_PROVIDER=none  → force offline (local catalogue only)
 */
export function resolveSearchProviders(): SearchProvider[] {
  const configured = (process.env.SEARCH_PROVIDER ?? 'auto').trim().toLowerCase();
  if (configured === 'none' || configured === 'offline') return [localCatalogProvider];
  if (configured !== 'auto') {
    const named = SEARCH_PROVIDERS.find((p) => p.id === configured);
    if (named) return named.isConfigured() || !named.requiresKey ? [named] : [localCatalogProvider];
  }
  const order = configList('search.provider_order');
  const configuredProviders = order
    .map((id) => SEARCH_PROVIDERS.find((p) => p.id === id))
    .filter((p): p is SearchProvider => Boolean(p?.isConfigured()));
  return configuredProviders.length ? configuredProviders : [localCatalogProvider];
}

export function searchStatus() {
  return {
    mode: resolveSearchProviders().map((p) => p.id),
    live: resolveSearchProviders().some((p) => p.id !== 'local-catalog'),
    available: SEARCH_PROVIDERS.map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() })),
  };
}

export interface RunSearchOptions {
  limit?: number;
  intent?: 'job' | 'government' | 'exam' | 'internship' | 'fellowship' | 'official' | 'general';
  searchJobId?: string;
  userId?: string | null;
  /** Cap total external calls so a single analysis cannot blow the API budget. */
  maxProviders?: number;
}

/**
 * Runs one query across the configured providers, de-duplicates by URL, re-tiers every hit
 * against the official-domain list, and records the attempt in `search_logs`.
 */
export async function runSearch(query: string, options: RunSearchOptions = {}): Promise<SearchOutcome> {
  const started = Date.now();
  const providers = resolveSearchProviders().slice(0, options.maxProviders ?? configInt('search.max_providers'));
  const provider = providers[0];
  const hitsByUrl = new Map<string, SearchHit>();

  let failureKind: SearchOutcome['status'] | null = null;
  let error: string | undefined;

  for (const current of providers) {
    try {
      const hits = await current.search(query, { limit: options.limit ?? 10, intent: options.intent });
      for (const hit of hits) {
        if (!hit.url) continue;
        const tier = tierForUrl(hit.url) as 1 | 2 | 3 | 4;
        const enriched: SearchHit = { ...hit, provider: current.id, tier };
        const existing = hitsByUrl.get(hit.url);
        // Prefer the higher-tier (more authoritative) copy of the same URL.
        if (!existing || tier < existing.tier) hitsByUrl.set(hit.url, enriched);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error = message;
      failureKind = /429|rate limit/i.test(message)
        ? 'rate_limited'
        : /403|blocked|forbidden|captcha/i.test(message)
          ? 'blocked'
          : 'failed';
    }
  }

  const hits = [...hitsByUrl.values()].sort((a, b) => a.tier - b.tier);
  // The failure KIND is what tells the pipeline and the user whether to wait (rate limited),
  // fix credentials (blocked) or give up (failed), so it must survive. A provider that erred
  // while another still returned results is a degraded success, not a failure: the error text
  // is kept for the log but the outcome is `ok`.
  const status: SearchOutcome['status'] = hits.length > 0 || !failureKind ? 'ok' : failureKind;

  await logSearch({
    searchJobId: options.searchJobId ?? null,
    userId: options.userId ?? null,
    provider: providers.map((p) => p.id).join('+') || 'none',
    query,
    results: hits.length,
    status,
    latencyMs: Date.now() - started,
    error,
  });

  return { provider: provider?.id ?? 'none', query, hits, status, latencyMs: Date.now() - started, error };
}

export async function logSearch(entry: {
  searchJobId: string | null;
  userId: string | null;
  provider: string;
  query: string;
  results: number;
  status: string;
  latencyMs: number;
  error?: string;
}): Promise<void> {
  try {
    await db.run(
      `INSERT INTO search_logs (id, search_job_id, user_id, provider, query, tier, results, status, latency_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid(),
        entry.searchJobId,
        entry.userId,
        entry.provider,
        entry.query,
        4,
        entry.results,
        entry.status,
        entry.latencyMs,
        entry.error ?? null,
        nowIso(),
      ],
    );
  } catch (err) {
    console.error('[search] failed to write search_logs:', err);
  }
}

/**
 * Fetches a page for content extraction (e.g. reading an official notification page).
 * robots.txt is checked first and the request fails closed when it cannot be read.
 * Paywalls, logins and CAPTCHAs are never bypassed.
 */
export async function fetchPageText(url: string, maxBytes = 400_000): Promise<{ ok: boolean; text: string; reason: string }> {
  const permission = await isAllowed(url, true);
  if (!permission.allowed) {
    await logSearch({ searchJobId: null, userId: null, provider: 'fetch', query: url, results: 0, status: 'robots_denied', latencyMs: 0, error: permission.reason });
    return { ok: false, text: '', reason: permission.reason };
  }
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(Number(process.env.FETCH_TIMEOUT_MS ?? 20_000)),
    });
    if (!res.ok) return { ok: false, text: '', reason: `HTTP ${res.status}` };
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes * 4) return { ok: false, text: '', reason: 'Response too large' };
    const html = Buffer.from(buffer.slice(0, maxBytes)).toString('utf8');
    return { ok: true, text: htmlToText(html), reason: 'ok' };
  } catch (error) {
    return { ok: false, text: '', reason: error instanceof Error ? error.message : 'fetch failed' };
  }
}

/** Minimal, dependency-free HTML → text conversion used for snippet enrichment. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Reads a public RSS/Atom feed (e.g. an official recruitment notice board).
 * Feeds are the cleanest legitimate way to track official announcements.
 */
export async function fetchRssFeed(url: string, limit = 20): Promise<SearchHit[]> {
  const permission = await isAllowed(url, true);
  if (!permission.allowed) return [];
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(Number(process.env.FETCH_TIMEOUT_MS ?? 20_000)),
    });
    if (!res.ok) return [];
    const xml = (await res.text()).slice(0, 800_000);
    const items: SearchHit[] = [];
    const itemPattern = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemPattern.exec(xml)) !== null && items.length < limit) {
      const block = match[1];
      const title = xmlTag(block, 'title');
      const link = xmlTag(block, 'link') || xmlAttr(block, 'link', 'href');
      const description = xmlTag(block, 'description') || xmlTag(block, 'summary') || '';
      const date = xmlTag(block, 'pubDate') || xmlTag(block, 'updated') || xmlTag(block, 'published');
      if (!title || !link) continue;
      items.push({
        title: decodeEntities(title),
        url: link,
        snippet: decodeEntities(htmlToText(description)).slice(0, 400),
        sourceDate: date || null,
        provider: 'rss',
        tier: tierForUrl(link) as 1 | 2 | 3 | 4,
      });
    }
    return items;
  } catch {
    return [];
  }
}

function xmlTag(block: string, tag: string): string {
  const cdata = block.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdata) return cdata[1].trim();
  const plain = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return plain ? plain[1].trim() : '';
}

function xmlAttr(block: string, tag: string, attr: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]+)"`, 'i'));
  return match ? match[1] : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export { localCatalogProvider };
