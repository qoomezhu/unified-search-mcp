// ============================================================
// Exa AI 搜索引擎
// ============================================================

import { SearchEngine } from './base';
import type { SearchParams, SearchResult, Env } from '../types';

export class ExaEngine extends SearchEngine {
  private apiKey: string;

  constructor(env: Env, timeout?: number) {
    super('Exa', env, timeout);
    this.apiKey = env.EXA_API_KEY || '';
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  async search(params: SearchParams): Promise<SearchResult[]> {
    if (!this.apiKey) {
      throw new Error('EXA_API_KEY not configured');
    }

    const { query, maxResults = 10, dateRange } = params;
    
    const body: Record<string, unknown> = {
      query,
      numResults: maxResults,
      type: 'auto',
      contents: {
        text: { maxCharacters: 500 }
      }
    };

    // 日期过滤
    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      const dateMap: Record<string, number> = {
        day: 1,
        week: 7,
        month: 30,
        year: 365
      };
      const daysAgo = dateMap[dateRange] || 0;
      if (daysAgo > 0) {
        const startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        body.startPublishedDate = startDate.toISOString();
      }
    }

    const response = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error
