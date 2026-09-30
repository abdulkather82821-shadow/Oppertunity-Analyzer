/**
 * robots.txt compliance.
 *
 * The platform only fetches pages it is permitted to fetch, caches the robots file per
 * host, and fails closed (deny) when the file cannot be read for a non-search endpoint.
 * Search-API providers are not subject to this because the API operator does the fetching
 * under its own terms.
 */

interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
}

const cache = new Map<string, { rules: RobotsRule[] | null; fetchedAt: number; ok: boolean }>();
const CACHE_TTL_MS = 6 * 3600 * 1000;

const USER_AGENT = process.env.FETCH_USER_AGENT ?? 'OpportunityAnalyzerAI/1.0 (+career-intelligence-bot; respects robots.txt)';

export async function fetchRobots(origin: string): Promise<{ rules: RobotsRule[] | null; ok: boolean }> {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { rules: cached.rules, ok: cached.ok };

  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/plain' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (res.status === 404 || res.status === 410) {
      // No robots file → everything is allowed.
      cache.set(origin, { rules: [], fetchedAt: Date.now(), ok: true });
      return { rules: [], ok: true };
    }
    if (!res.ok) {
      cache.set(origin, { rules: null, fetchedAt: Date.now(), ok: false });
      return { rules: null, ok: false };
    }
    const body = await res.text();
    const rules = parseRobots(body);
    cache.set(origin, { rules, fetchedAt: Date.now(), ok: true });
    return { rules, ok: true };
  } catch {
    cache.set(origin, { rules: null, fetchedAt: Date.now(), ok: false });
    return { rules: null, ok: false };
  }
}

export function parseRobots(body: string): RobotsRule[] {
  const rules: RobotsRule[] = [];
  // Consecutive `User-agent` lines form ONE group that shares the rules beneath it
  // (RFC 9309 §2.2.1). Treating each line as its own group would leave every agent but the
  // last with no rules at all, i.e. allowed everywhere.
  let group: RobotsRule[] = [];
  let collectingAgents = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!collectingAgents) group = [];
      const rule: RobotsRule = { userAgent: value.toLowerCase(), allow: [], disallow: [] };
      group.push(rule);
      rules.push(rule);
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    for (const rule of group) {
      if (field === 'disallow' && value) rule.disallow.push(value);
      else if (field === 'allow' && value) rule.allow.push(value);
      // An empty Disallow means "allow everything" and adds no rule.
    }
  }
  return rules;
}

/** Robots path pattern → match. `*` is a wildcard, a trailing `$` anchors the end, otherwise prefix. */
export function pathMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const core = anchored ? pattern.slice(0, -1) : pattern;
  const body = core.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(anchored ? `^${body}$` : `^${body}`).test(path);
}

function rulesFor(rules: RobotsRule[], agent: string): RobotsRule | null {
  const specific = rules.find((rule) => rule.userAgent !== '*' && agent.toLowerCase().includes(rule.userAgent));
  return specific ?? rules.find((rule) => rule.userAgent === '*') ?? null;
}

/**
 * Hosts this crawler must never contact, whatever robots.txt says: loopback, private and
 * link-local addresses (including the cloud metadata endpoint at 169.254.169.254) and internal
 * names. URLs reach the fetcher from third-party search results, so they are untrusted input.
 * This checks the literal host; it is defence in depth, not a substitute for network egress
 * rules, because it cannot see what a public name resolves to.
 */
export function blockedFetchTarget(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return 'Missing host';
  if (host === 'localhost' || /\.(localhost|local|internal|lan|intranet|corp|home)$/.test(host)) {
    return 'Internal host names are never fetched';
  }
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return 'Private, loopback and link-local addresses are never fetched';
    }
  }
  if (host.includes(':')) {
    // WHATWG URL normalises ::ffff:10.0.0.1 to ::ffff:a00:1, so check the hex form too.
    const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return blockedFetchTarget(mapped[1]);
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return blockedFetchTarget(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (host === '::1' || host === '::' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) {
      return 'Private, loopback and link-local addresses are never fetched';
    }
  }
  return null;
}

/** True when the URL may be fetched. Fails closed when robots.txt is unreachable. */
export async function isAllowed(url: string, failClosed = true): Promise<{ allowed: boolean; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'Invalid URL' };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { allowed: false, reason: 'Only http(s) URLs may be fetched' };
  const blocked = blockedFetchTarget(parsed.hostname);
  if (blocked) return { allowed: false, reason: blocked };

  const origin = parsed.origin;
  const { rules, ok } = await fetchRobots(origin);
  if (!ok) {
    return failClosed
      ? { allowed: false, reason: 'robots.txt could not be retrieved — fetch skipped (fail closed)' }
      : { allowed: true, reason: 'robots.txt unavailable; fetch permitted by configuration' };
  }
  if (!rules || rules.length === 0) return { allowed: true, reason: 'No restrictions in robots.txt' };

  const agent = process.env.ROBOTS_AGENT ?? USER_AGENT;
  const rule = rulesFor(rules, agent);
  if (!rule) return { allowed: true, reason: 'No matching user-agent rule' };

  const path = `${parsed.pathname}${parsed.search}` || '/';
  const allowedHit = rule.allow.find((pattern) => pathMatches(pattern, path));
  const deniedHit = rule.disallow.find((pattern) => pathMatches(pattern, path));
  if (allowedHit && deniedHit) {
    // Most specific (longest) pattern wins, per the de-facto robots standard.
    return allowedHit.length >= deniedHit.length
      ? { allowed: true, reason: `Allow rule ${allowedHit} is more specific` }
      : { allowed: false, reason: `Disallowed by robots.txt rule: ${deniedHit}` };
  }
  if (deniedHit) return { allowed: false, reason: `Disallowed by robots.txt rule: ${deniedHit}` };
  return { allowed: true, reason: 'Permitted by robots.txt' };
}

export function clearRobotsCache(): void {
  cache.clear();
}

export { USER_AGENT };
