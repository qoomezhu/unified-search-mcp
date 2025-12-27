// ============================================================
// 搜索结果聚合器 - 去重 + 相关度排序
// ============================================================

import type { SearchResult, EngineResponse, AggregatedResponse, SearchParams } from './types';

export class SearchAggregator {
  private maxResults: number;

  constructor(maxResults = 20) {
    this.maxResults = maxResults;
  }

  aggregate(
    query: string,
    responses: EngineResponse[]
  ): AggregatedResponse {
    // 1. 收集所有结果
    const allResults: SearchResult[] = [];
    const engineStats = responses.map(r => ({
      name: r.engine,
      count: r.results.length,
      latency: r.latency,
      status: r.error 
        ? (r.error.includes('Timeout') ? 'timeout' as const : 'error' as const)
        : 'success' as const,
      error: r.error
    }));

    for (const response of responses) {
      allResults.push(...response.results);
    }

    // 2. 去重（基于URL）
    const uniqueResults = this.deduplicateByUrl(allResults);

    // 3. 计算相关度分数
    const scoredResults = this.calculateRelevance(uniqueResults, query);

    // 4. 排序并取前N条
    const topResults = scoredResults
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
      .slice(0, this.maxResults);

    return {
      query,
      totalResults: topResults.length,
      engines: engineStats,
      results: topResults,
      processedAt: new Date().toISOString()
    };
  }

  private deduplicateByUrl(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();
    
    for (const result of results) {
      const normalizedUrl = this.normalizeUrl(result.url);
      
      if (!seen.has(normalizedUrl)) {
        seen.set(normalizedUrl, result);
      } else {
        // 如果已存在，合并信息（保留更完整的版本）
        const existing = seen.get(normalizedUrl)!;
        seen.set(normalizedUrl, this.mergeResults(existing, result));
      }
    }
    
    return Array.from(seen.values());
  }

  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // 移除协议、www、尾部斜杠和常见追踪参数
      let normalized = parsed.hostname.replace(/^www\./, '') + parsed.pathname;
      normalized = normalized.replace(/\/$/, '').toLowerCase();
      return normalized;
    } catch {
      return url.toLowerCase();
    }
  }

  private mergeResults(a: SearchResult, b: SearchResult): SearchResult {
    return {
      title: a.title.length >= b.title.length ? a.title : b.title,
      url: a.url,
      snippet: a.snippet.length >= b.snippet.length ? a.snippet : b.snippet,
      source: `\({a.source}+\){b.source}`, // 标记多源
      publishedDate: a.publishedDate || b.publishedDate,
      score: Math.max(a.score || 0, b.score || 0)
    };
  }

  private calculateRelevance(results: SearchResult[], query: string): SearchResult[] {
    const queryTerms = this.tokenize(query);
    
    return results.map(result => {
      let score = 0;
      
      const titleTerms = this.tokenize(result.title);
      const snippetTerms = this.tokenize(result.snippet);
      
      // 标题匹配权重高
      for (const term of queryTerms) {
        if (titleTerms.includes(term)) {
          score += 10;
        }
        if (snippetTerms.includes(term)) {
          score += 3;
        }
      }
      
      // 完全匹配标题加分
      if (result.title.toLowerCase().includes(query.toLowerCase())) {
        score += 20;
      }
      
      // 多源确认加分
      if (result.source.includes('+')) {
        score += 15 * (result.source.split('+').length - 1);
      }
      
      // 原始分数加权
      if (result.score) {
        score += result.score * 5;
      }
      
      // 有日期的加分（更可靠）
      if (result.publishedDate) {
        score += 3;
      }
      
      // snippet 完整度
      if (result.snippet.length > 100) {
        score += 5;
      }
      
      return {
        ...result,
        relevanceScore: score
      };
    });
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }
}
