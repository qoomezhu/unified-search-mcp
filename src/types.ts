// ============================================================
// 类型定义
// ============================================================

export interface SearchParams {
  query: string;
  maxResults?: number;
  dateRange?: 'day' | 'week' | 'month' | 'year' | 'all';
  engines?: string[];
  language?: string;
  safeSearch?: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  score?: number;
  relevanceScore?: number;
}

export interface EngineResponse {
  engine: string;
  results: SearchResult[];
  error?: string;
  latency: number;
}

export interface AggregatedResponse {
  query: string;
  totalResults: number;
  engines: {
    name: string;
    count: number;
    latency: number;
    status: 'success' | 'error' | 'timeout';
    error?: string;
  }[];
  results: SearchResult[];
  processedAt: string;
}

export interface Env {
  // API Keys (通过 wrangler secret 设置)
  EXA_API_KEY?: string;
  TAVILY_API_KEY?: string;
  JINA_API_KEY?: string;
  METASO_API_KEY?: string;
  SEARXNG_URL?: string;
  
  // 配置
  DEFAULT_TIMEOUT?: string;
  MAX_RESULTS?: string;
}
