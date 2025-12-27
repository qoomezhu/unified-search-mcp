// ============================================================
// 搜索引擎基类
// ============================================================

import type { SearchParams, SearchResult, EngineResponse, Env } from '../types';

export abstract class SearchEngine {
  protected name: string;
  protected timeout: number;
  protected env: Env;

  constructor(name: string, env: Env, timeout = 8000) {
    this.name = name;
    this.env = env;
    this.timeout = timeout;
  }

  abstract search(params: SearchParams): Promise<SearchResult[]>;

  async execute(params: SearchParams): Promise<EngineResponse> {
    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      const results = await Promise.race([
        this.search(params),
        new Promise<SearchResult[]>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Timeout after ${this.timeout}ms`));
          });
        })
      ]);
      
      clearTimeout(timeoutId);
      
      return {
        engine: this.name,
        results: results.map(r => ({ ...r, source: this.name })),
        latency: Date.now() - startTime
      };
    } catch (error) {
      return {
        engine: this.name,
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        latency: Date.now() - startTime
      };
    }
  }

  protected mapDateRange(dateRange?: string): string {
    const mapping: Record<string, string> = {
      'day': 'd',
      'week': 'w', 
      'month': 'm',
      'year': 'y',
      'all': ''
    };
    return mapping[dateRange || 'all'] || '';
  }
}
