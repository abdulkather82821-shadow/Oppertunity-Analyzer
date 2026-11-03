export type SearchIntent = 'job' | 'government' | 'exam' | 'internship' | 'fellowship' | 'official' | 'general';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  sourceDate?: string | null;
  provider: string;
  tier: 1 | 2 | 3 | 4;
  /**
   * Set by the offline local-catalogue provider when the hit *is* a row already in this
   * platform's own database. The pipeline uses it to update that row instead of inserting a
   * duplicate — otherwise offline mode would re-ingest its own catalogue on every search.
   */
  sourceOpportunityId?: string | null;
}

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresKey: boolean;
  isConfigured(): boolean;
  search(query: string, options?: { limit?: number; intent?: SearchIntent }): Promise<SearchHit[]>;
}

export interface SearchOutcome {
  provider: string;
  query: string;
  hits: SearchHit[];
  status: 'ok' | 'failed' | 'rate_limited' | 'blocked' | 'robots_denied' | 'not_configured';
  latencyMs: number;
  error?: string;
}
