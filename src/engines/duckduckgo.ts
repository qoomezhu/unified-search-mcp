// ============================================================
// DuckDuckGo 搜索引擎 (无需API Key)
// ============================================================

import { SearchEngine } from './base';
import type { SearchParams, SearchResult, Env } from '../types';

export class DuckDuckGoEngine extends SearchEngine {
  constructor(env: Env, timeout?: number) {
    super('DuckDuckGo', env, timeout);
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    const { query, maxResults = 10 } = params;
    
    // 使用DuckDuckGo的HTML API并解析结果
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`DuckDuckGo HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const results = this.parseHtml(html, maxResults);
    
    return results;
  }

  private parseHtml(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];
    
    // 简单的正则解析（实际生产环境建议使用更健壮的解析器）
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)<\/a>/g;
    
    let match;
    while ((match = resultPattern.exec(html)) !== null && results.length < maxResults) {
      const [, url, title, snippet] = match;
      if (url && title) {
        results.push({
          title: this.decodeHtml(title.trim()),
          url: this.extractUrl(url),
          snippet: this.decodeHtml(snippet?.trim() || ''),
          source: this.name
        });
      }
    }
    
    // 备用解析方案
    if (results.length === 0) {
      const linkPattern = /<a[^>]*class="[^"]*result[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = linkPattern.exec(html)) !== null && results.length < maxResults) {
        const [, url, content] = match;
        if (url && !url.includes('duckduckgo.com')) {
          results.push({
            title: this.stripTags(content).substring(0, 100),
            url: this.extractUrl(url),
            snippet: '',
            source: this.name
          });
        }
      }
    }
    
    return results;
  }

  private extractUrl(uddg: string): string {
    try {
      const match = uddg.match(/uddg=([^&]*)/);
      if (match) {
        return decodeURIComponent(match[1]);
      }
      return uddg;
    } catch {
      return uddg;
    }
  }

  private decodeHtml(html: string): string {
    return html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private stripTags(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }
}
