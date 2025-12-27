// ============================================================
// Tavily 搜索引擎
// ============================================================

import { SearchEngine } from './base';
import type { SearchParams, SearchResult, Env } from '../types';

export class TavilyEngine extends SearchEngine {
  private apiKey: string;

  constructor(env: Env, timeout?: number) {
    super('Tavily', env, timeout);
    this.apiKey = env.TAVILY_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('TAVILY_API_KEY not configured');
    }

    const { query, maxResults = 10, dateRange } = params;

    const body: Record<string, unknown> = {
      api_key: this.apiKey,
      query,
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      search_depth: 'basic'
    };

    // Tavily 日期过滤
    if (dateRange && dateRange !== 'all') {
      const dayMap: Record<string, string> = {
        day: 'd',
        week: 'w',
        month: 'm',
        year: 'y'
      };
      body.days = dayMap[dateRange] === 'd' ? 1 : 
                  dayMap[dateRange] === 'w' ? 7 : 
                  dayMap[dateRange] === 'm' ? 30 : 365;
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tavily API error: \({response.status} - \){errorText}`);
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        published_date?: string;
        score?: number;
      }>;
    };

    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      source: this.name,
      publishedDate: r.published_date,
      score: r.score
    }));
  }
}
