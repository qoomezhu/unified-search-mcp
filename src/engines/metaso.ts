// ============================================================
// Metaso (秘塔) 搜索引擎
// ============================================================

import { SearchEngine } from './base';
import type { SearchParams, SearchResult, Env } from '../types';

export class MetasoEngine extends SearchEngine {
  private apiKey: string;

  constructor(env: Env, timeout?: number) {
    super('Metaso', env, timeout);
    this.apiKey = env.METASO_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('METASO_API_KEY not configured');
    }

    const { query, maxResults = 10 } = params;

    // Metaso API 调用
    const response = await fetch('https://metaso.cn/api/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        query,
        limit: maxResults,
        mode: 'concise'
      })
    });

    if (!response.ok) {
      // 如果API不可用，尝试备用方案
      return this.fallbackSearch(query, maxResults);
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        url?: string;
        snippet?: string;
        date?: string;
      }>;
    };

    return (data.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.snippet || '',
      source: this.name,
      publishedDate: r.date
    }));
  }

  private async fallbackSearch(query: string, maxResults: number): Promise<SearchResult[]> {
    // 备用：通过网页版抓取
    const url = `https://metaso.cn/search?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`Metaso HTTP ${response.status}`);
    }

    // 返回空结果，因为网页解析较复杂
    // 实际部署时可以增强此功能
    return [];
  }
}
