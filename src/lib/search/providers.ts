import type { SearchHit, SearchProvider } from './types';

/** Tavily — search API built for LLM agents. https://tavily.com */
export const tavilyProvider: SearchProvider = {
  id: 'tavily',
  label: 'Tavily Search API',
  requiresKey: true,
  isConfigured() {
    return Boolean(process.env.TAVILY_API_KEY);
  },
  async search(query, options = {}) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: options.limit ?? 10,
        search_depth: process.env.TAVILY_DEPTH ?? 'advanced',
        include_answer: false,
        topic: 'general',
      }),
      signal: AbortSignal.timeout(Number(process.env.SEARCH_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    return (json.results ?? []).map(
      (item: any): SearchHit => ({
        title: item.title ?? item.url,
        url: item.url,
        snippet: item.content ?? '',
        sourceDate: item.published_date ?? null,
        provider: 'tavily',
        tier: 4,
      }),
    );
  },
};

/** Serper.dev — Google Search Results API. https://serper.dev */
export const serperProvider: SearchProvider = {
  id: 'serper',
  label: 'Serper (Google) Search API',
  requiresKey: true,
  isConfigured() {
    return Boolean(process.env.SERPER_API_KEY);
  },
  async search(query, options = {}) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.SERPER_API_KEY ?? '' },
      body: JSON.stringify({ q: query, num: options.limit ?? 10, gl: process.env.SERPER_GL ?? 'in', hl: 'en' }),
      signal: AbortSignal.timeout(Number(process.env.SEARCH_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) throw new Error(`Serper HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    return (json.organic ?? []).map(
      (item: any): SearchHit => ({
        title: item.title ?? item.link,
        url: item.link,
        snippet: item.snippet ?? '',
        sourceDate: item.date ?? null,
        provider: 'serper',
        tier: 4,
      }),
    );
  },
};

/** Brave Search API. https://brave.com/search/api/ */
export const braveProvider: SearchProvider = {
  id: 'brave',
  label: 'Brave Search API',
  requiresKey: true,
  isConfigured() {
    return Boolean(process.env.BRAVE_API_KEY);
  },
  async search(query, options = {}) {
    const params = new URLSearchParams({ q: query, count: String(options.limit ?? 10), country: process.env.BRAVE_COUNTRY ?? 'IN' });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { accept: 'application/json', 'x-subscription-token': process.env.BRAVE_API_KEY ?? '' },
      signal: AbortSignal.timeout(Number(process.env.SEARCH_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    return (json.web?.results ?? []).map(
      (item: any): SearchHit => ({
        title: item.title ?? item.url,
        url: item.url,
        snippet: item.description ?? '',
        sourceDate: item.page_age ?? null,
        provider: 'brave',
        tier: 4,
      }),
    );
  },
};

/** Bing Web Search API (Azure). */
export const bingProvider: SearchProvider = {
  id: 'bing',
  label: 'Bing Web Search API',
  requiresKey: true,
  isConfigured() {
    return Boolean(process.env.BING_API_KEY);
  },
  async search(query, options = {}) {
    const params = new URLSearchParams({ q: query, count: String(options.limit ?? 10), mkt: 'en-IN' });
    const res = await fetch(`https://api.bing.microsoft.com/v7.0/search?${params}`, {
      headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_API_KEY ?? '' },
      signal: AbortSignal.timeout(Number(process.env.SEARCH_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) throw new Error(`Bing HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    return (json.webPages?.value ?? []).map(
      (item: any): SearchHit => ({
        title: item.name ?? item.url,
        url: item.url,
        snippet: item.snippet ?? '',
        sourceDate: item.dateLastCrawled ?? null,
        provider: 'bing',
        tier: 4,
      }),
    );
  },
};

/**
 * Self-hosted SearXNG instance (SEARXNG_URL). A good no-per-query-cost option and it
 * keeps queries inside infrastructure you control.
 */
export const searxngProvider: SearchProvider = {
  id: 'searxng',
  label: 'SearXNG (self-hosted metasearch)',
  requiresKey: false,
  isConfigured() {
    return Boolean(process.env.SEARXNG_URL);
  },
  async search(query, options = {}) {
    const base = (process.env.SEARXNG_URL ?? '').replace(/\/$/, '');
    const params = new URLSearchParams({ q: query, format: 'json', pageno: '1' });
    const res = await fetch(`${base}/search?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(Number(process.env.SEARCH_TIMEOUT_MS ?? 30_000)),
    });
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
    const json = (await res.json()) as any;
    return (json.results ?? []).slice(0, options.limit ?? 10).map(
      (item: any): SearchHit => ({
        title: item.title ?? item.url,
        url: item.url,
        snippet: item.content ?? '',
        sourceDate: item.publishedDate ?? null,
        provider: 'searxng',
        tier: 4,
      }),
    );
  },
};
