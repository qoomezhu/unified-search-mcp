// ============================================================
// SearXNG 搜索引擎 (需要自托管实例)
// ============================================================

import { SearchEngine } from './base';
import type { SearchParams, SearchResult, Env } from '../types';

export class SearXNGEngine extends SearchEngine {
  private baseUrl: string;

  constructor(env: Env, timeout?: number) {
    super('SearXNG', env, timeout);
    this.baseUrl = env.SEARXNG_URL || 'https://searx.be';
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const { query, maxResults = 10, dateRange, language = 'en', safeSearch = true } = params;
    
    const searchParams = new URLSearchParams({
      q: query,
      format: 'json',
      pageno: '1',
      language: language,
      safesearch: safeSearch ? '1' : '0'
    });

    if (dateRange && dateRange !== 'all') {
      searchParams.set('time_range', dateRange);
    }

    const response = await fetch(`\({this.baseUrl}/search?\){searchParams}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'UnifiedSearchMCP/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`SearXNG HTTP ${response.status}`);
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        publishedDate?: string;
        score?: number;
      }>;
    };
    
    return (data.results || []).slice(0, maxResults).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      source: this.name,
      publishedDate: r.publishedDate,
      score: r.score
    }));
  }
}
