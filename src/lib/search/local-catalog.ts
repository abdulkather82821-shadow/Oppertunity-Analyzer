import { db, jsonList } from '@/lib/db';
import { tierForUrl, isOfficialDomain } from '@/lib/opportunity/trust';
import type { SearchHit, SearchProvider } from './types';

/**
 * Local catalogue provider.
 *
 * When no external search API is configured the pipeline still needs to be end-to-end
 * functional, so it queries the platform's own opportunity/exam catalogue instead of the
 * open web. It is explicitly labelled as such — results are never presented as if they
 * came from a live web crawl.
 */
export const localCatalogProvider: SearchProvider = {
  id: 'local-catalog',
  label: 'Local opportunity catalogue (offline mode)',
  requiresKey: false,

  isConfigured() {
    return true;
  },

  async search(query, options = {}) {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .slice(0, 8);
    if (terms.length === 0) return [];

    const like = terms.map(() => 'LOWER(COALESCE(title,\'\') || \' \' || COALESCE(organization,\'\') || \' \' || COALESCE(description,\'\') || \' \' || COALESCE(category,\'\') || \' \' || COALESCE(skills,\'\')) LIKE ?');
    const params = terms.map((term) => `%${term}%`);
    const limit = options.limit ?? 20;

    const rows = await db.query(
      `SELECT id, title, organization, official_source, application_url, source_urls, description, category, type,
              application_deadline, is_demo
         FROM opportunities
        WHERE is_active = 1 AND (${like.join(' OR ')})
        ORDER BY final_score DESC, trust_score DESC
        LIMIT ?`,
      [...params, limit],
    );

    return rows.map((row: any): SearchHit => {
      const url = row.official_source || row.application_url || jsonList<string>(row.source_urls)[0] || '';
      const official = url ? isOfficialDomain(url).official : false;
      return {
        title: row.title,
        url: url || `local://opportunity/${row.id}`,
        snippet: `${row.organization ? `${row.organization}. ` : ''}${(row.description ?? '').slice(0, 220)}`,
        sourceDate: row.application_deadline ?? null,
        provider: 'local-catalog',
        tier: official ? 1 : (tierForUrl(url) as 1 | 2 | 3 | 4),
        sourceOpportunityId: row.id,
      };
    });
  },
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'jobs', 'job', 'near', 'near me', 'latest', 'apply', 'online', 'government',
  'govt', 'recruitment', 'notification', 'vacancy', 'vacancies', 'india', 'fresher', 'freshers',
]);
