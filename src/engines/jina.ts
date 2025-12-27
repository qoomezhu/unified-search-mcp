// ============================================================
// Jina AI 搜索引擎
// ============================================================

import { SearchEngine } from './base';
import type { SearchParams, SearchResult, Env } from '../types';

export class JinaEngine extends SearchEngine {
  private apiKey: string;

  constructor(env: Env, timeout?: number) {
    super('Jina', env, timeout);
    this.apiKey = env.JINA_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('JINA_API_KEY not configured');
    }

    const { query, maxResults = 10 } = params;

    // Jina Search API (s.jina.ai)
    const response = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
        'X-Retain-Images': 'none'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jina API error: \({response.status} - \){errorText}`);
    }

    const data = await response.json() as {
      data?: Array<{
        title?: string;
        url?: string;
        description?: string;
        content?: string;
        publishedTime?: string;
      }>;
    };

    return (data.data || []).slice(0, maxResults).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || r.content?.substring(0, 300) || '',
      source: this.name,
      publishedDate: r.publishedTime
    }));
  }
}
