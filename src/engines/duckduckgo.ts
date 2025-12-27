import type { Env, SearchParams, SearchResult, EngineResponse } from '../types';
import { SearchEngine } from './base';

export class DuckDuckGoEngine extends SearchEngine {
  readonly name = 'DuckDuckGo';

  async search(params: SearchParams): Promise<SearchResult[]> {
    const query = encodeURIComponent(params.query);
    const url = 'https://html.duckduckgo.com/html/?q=' + query;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });

    if (!response.ok) {
      throw new Error('DuckDuckGo request failed: ' + response.status);
    }

    const html = await response.text();
    const results: SearchResult[] = [];
    
    // 解析搜索结果
    const resultPattern = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    const snippetPattern = /<a class="result__snippet"[^>]*>([^<]+)<\/a>/gi;
    
    let match;
    const urls: string[] = [];
    const titles: string[] = [];
    const snippets: string[] = [];
    
    // 提取URL和标题
    while ((match = resultPattern.exec(html)) !== null) {
      let href = match[1];
      // DuckDuckGo 使用重定向链接，需要解析真实URL
      if (href.indexOf('uddg=') > -1) {
        const uddgMatch = href.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          href = decodeURIComponent(uddgMatch[1]);
        }
      }
      urls.push(href);
      titles.push(match[2].replace(/<[^>]+>/g, '').trim());
    }
    
    // 提取摘要
    while ((match = snippetPattern.exec(html)) !== null) {
      snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
    }
    
    // 组合结果
    const maxResults = params.maxResults || 10;
    for (let i = 0; i < Math.min(urls.length, maxResults); i++) {
      if (urls[i] && titles[i]) {
        results.push({
          title: titles[i],
          url: urls[i],
          snippet: snippets[i] || '',
          source: this.name
        });
      }
    }
    
    // 如果正则没匹配到，尝试备用方案
    if (results.length === 0) {
      const linkPattern = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([^<]+)<\/a>/gi;
      while ((match = linkPattern.exec(html)) !== null && results.length < maxResults) {
        results.push({
          title: match[2].replace(/<[^>]+>/g, '').trim(),
          url: match[1],
          snippet: '',
          source: this.name
        });
      }
    }

    return results;
  }
}
