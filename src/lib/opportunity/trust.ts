import { KNOWN_AGGREGATORS, OFFICIAL_DOMAINS, SCAM_SIGNALS } from '@/lib/analysis/taxonomy';

/**
 * Trust scoring and low-quality / fraudulent listing detection.
 *
 * The core rule: an opportunity is only ever labelled "Verified" when an official source
 * in OFFICIAL_DOMAINS supports it. Absence of evidence yields "Needs Verification", never
 * a silent pass.
 */

export type TrustLabel = 'verified' | 'needs_verification' | 'suspicious';

export const TRUST_META: Record<TrustLabel, { label: string; dot: string; tone: string }> = {
  verified: { label: 'Verified', dot: '🟢', tone: 'success' },
  needs_verification: { label: 'Needs Verification', dot: '🟡', tone: 'warning' },
  suspicious: { label: 'Suspicious', dot: '🔴', tone: 'danger' },
};

export interface TrustSignal {
  signal: string;
  impact: number;
  detail: string;
}

export interface TrustAssessment {
  score: number;
  label: TrustLabel;
  signals: TrustSignal[];
  officialDomain: string | null;
  officialName: string | null;
  tier: number;
  recommendation: string;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    const match = url.match(/^(?:https?:\/\/)?([^/]+)/i);
    return (match?.[1] ?? '').toLowerCase().replace(/^www\./, '');
  }
}

export function isOfficialDomain(urlOrHost: string): { official: boolean; name: string | null; domain: string | null } {
  const host = urlOrHost.includes('://') ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase().replace(/^www\./, '');
  for (const [domain, info] of Object.entries(OFFICIAL_DOMAINS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return { official: true, name: info.name, domain };
  }
  // Any .gov.in / .nic.in host is a genuine government domain even if not in our list.
  if (/\.gov\.in$|\.nic\.in$|\.gov$/.test(host)) return { official: true, name: 'Government domain', domain: host };
  return { official: false, name: null, domain: null };
}

export function isKnownAggregator(urlOrHost: string): boolean {
  const host = urlOrHost.includes('://') ? hostnameOf(urlOrHost) : urlOrHost.toLowerCase();
  return KNOWN_AGGREGATORS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Source tier: 1 official · 2 reputable platform · 3 news/career portal · 4 blog/aggregator. */
export function tierForUrl(url: string): 1 | 2 | 3 | 4 {
  const host = hostnameOf(url);
  if (isOfficialDomain(host).official) return 1;
  if (KNOWN_AGGREGATORS.some((d) => host === d || host.endsWith(`.${d}`))) {
    const reputablePlatforms = ['naukri.com', 'indeed.com', 'linkedin.com', 'internshala.com', 'glassdoor.co.in', 'unstop.com'];
    return reputablePlatforms.some((d) => host === d || host.endsWith(`.${d}`)) ? 2 : 3;
  }
  if (/\b(news|times|express|hindu|indianexpress|ndtv|zee|economic)\b/.test(host)) return 3;
  return 4;
}

export function assessTrust(input: {
  title: string;
  organization: string;
  officialSource?: string | null;
  applicationUrl?: string | null;
  sourceUrls?: string[];
  description?: string;
  salary?: string | null;
  salaryMax?: number | null;
  isGovernment?: boolean;
  duplicateCount?: number;
}): TrustAssessment {
  const signals: TrustSignal[] = [];
  let score = 60;

  const candidateUrls = [input.officialSource, input.applicationUrl, ...(input.sourceUrls ?? [])].filter(Boolean) as string[];
  const officialHit = candidateUrls.map((url) => ({ url, ...isOfficialDomain(url) })).find((entry) => entry.official) ?? null;

  if (officialHit) {
    score += 32;
    signals.push({
      signal: 'official_source_present',
      impact: 32,
      detail: `Official source: ${officialHit.name ?? hostnameOf(officialHit.url)} (${officialHit.domain ?? hostnameOf(officialHit.url)})`,
    });
  } else if (candidateUrls.some((url) => isKnownAggregator(url))) {
    score += 6;
    signals.push({
      signal: 'secondary_source_only',
      impact: 6,
      detail: 'Only secondary aggregators reference this listing — no official page was found.',
    });
  } else if (candidateUrls.length === 0) {
    score -= 25;
    signals.push({ signal: 'no_source_url', impact: -25, detail: 'No source URL was captured for this listing.' });
  } else {
    score -= 10;
    signals.push({ signal: 'unknown_source', impact: -10, detail: `Source domain ${hostnameOf(candidateUrls[0])} is not a recognised official or reputable platform.` });
  }

  // Organisation identity
  if (!input.organization || input.organization.trim().length < 2 || /^(unknown|n\/?a|confidential|private|client)\b/i.test(input.organization)) {
    score -= 20;
    signals.push({ signal: 'missing_organization', impact: -20, detail: 'Recruiting organisation is not named.' });
  } else {
    score += 8;
    signals.push({ signal: 'organization_named', impact: 8, detail: `Organisation named: ${input.organization}` });
  }

  // Government branding claims must be backed by a government domain.
  if (input.isGovernment && !officialHit) {
    score -= 18;
    signals.push({
      signal: 'unverified_government_claim',
      impact: -18,
      detail: 'Presented as a government recruitment but no .gov.in/.nic.in source supports it.',
    });
  }

  // Salary plausibility (INR annual)
  const salaryText = input.salary ?? '';
  const numericMax = input.salaryMax ?? parseAnnualSalary(salaryText);
  if (numericMax != null && numericMax > 0) {
    if (numericMax > 100_000_000) {
      score -= 30;
      signals.push({ signal: 'unrealistic_salary', impact: -30, detail: `Salary claim of ₹${numericMax.toLocaleString('en-IN')} is implausibly high.` });
    } else if (numericMax > 10_000_000 && !/director|vp|vice president|chief|head of/i.test(input.title)) {
      score -= 12;
      signals.push({ signal: 'high_salary_claim', impact: -12, detail: 'Salary is far above the typical range for this role level.' });
    }
  }
  if (/\b(₹?\s?\d{1,3}(?:,\d{3})*)\s*(lakh|lac|lpa)\b.*\bper\s+(month|day|week)\b/i.test(salaryText)) {
    score -= 20;
    signals.push({ signal: 'salary_unit_mismatch', impact: -20, detail: 'Salary units are internally inconsistent.' });
  }

  // Text-based scam signals
  const haystack = `${input.title} ${input.organization} ${input.description ?? ''} ${salaryText}`;
  for (const rule of SCAM_SIGNALS) {
    if (rule.pattern.test(haystack)) {
      score += rule.impact;
      signals.push({ signal: rule.pattern.source.slice(0, 40), impact: rule.impact, detail: rule.detail });
    }
  }

  // Application link quality
  const applyUrl = input.applicationUrl ?? '';
  if (applyUrl) {
    if (!/^https:\/\//i.test(applyUrl)) {
      score -= 15;
      signals.push({ signal: 'insecure_apply_link', impact: -15, detail: 'Application link does not use HTTPS.' });
    }
    if (officialHit && hostnameOf(applyUrl) !== hostnameOf(officialHit.url)) {
      score -= 10;
      signals.push({
        signal: 'apply_link_off_domain',
        impact: -10,
        detail: `Application link (${hostnameOf(applyUrl)}) is on a different domain from the official source (${hostnameOf(officialHit.url)}).`,
      });
    }
  } else {
    score -= 8;
    signals.push({ signal: 'no_apply_link', impact: -8, detail: 'No application link captured.' });
  }

  // Corroboration across independent sources
  const uniqueDomains = new Set(candidateUrls.map(hostnameOf));
  if (uniqueDomains.size >= 3) {
    score += 8;
    signals.push({ signal: 'multi_source', impact: 8, detail: `Corroborated across ${uniqueDomains.size} independent domains.` });
  }
  if ((input.duplicateCount ?? 1) >= 3 && !officialHit) {
    score += 4;
    signals.push({ signal: 'widely_syndicated', impact: 4, detail: 'Listing appears on multiple sites, but none are official.' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label: TrustLabel = score >= 80 && officialHit ? 'verified' : score < 45 ? 'suspicious' : 'needs_verification';

  const recommendation =
    label === 'verified'
      ? 'Official source located. Still confirm dates and eligibility on the notification PDF before applying.'
      : label === 'suspicious'
        ? 'Do not apply or pay any fee until this is confirmed through an official channel.'
        : 'Verify Before Applying — confirm the organisation and deadline on its official website or notification.';

  return { score, label, signals, officialDomain: officialHit?.domain ?? null, officialName: officialHit?.name ?? null, tier: officialHit ? 1 : candidateUrls.length ? tierForUrl(candidateUrls[0]) : 4, recommendation };
}

/** Parses "₹3.5 LPA", "₹25,000/month", "300000 per annum" into an annual INR figure. */
export function parseAnnualSalary(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/,/g, '');
  const perMonth = cleaned.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|lpa|k)?\s*(?:per|\/|a)\s*month/i);
  const lpa = cleaned.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|lpa)/i);
  const plain = cleaned.match(/(\d{4,9})\s*(?:per\s*(?:annum|year)|\/\s*(?:annum|year|yr|pa))?/i);

  if (perMonth) {
    const value = Number(perMonth[1]) * (perMonth[2]?.toLowerCase().startsWith('l') ? 100_000 : 1);
    return Math.round(value * 12);
  }
  if (lpa) {
    const value = Number(lpa[1]);
    if (!Number.isFinite(value)) return null;
    return Math.round(value * (lpa[2].toLowerCase() === 'k' ? 1_000 : 100_000));
  }
  if (plain) {
    const value = Number(plain[1]);
    if (Number.isFinite(value) && value >= 1000) return Math.round(value);
  }
  return null;
}
