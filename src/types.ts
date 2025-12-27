// ============================================================
// 类型定义
// ============================================================

/**
 * 搜索参数
 */
export interface SearchParams {
  query: string;
  maxResults?: number;
  dateRange?: 'day' | 'week' | 'month' | 'year' | 'all';
  engines?: string[];
  language?: string;
  safeSearch?: boolean;
  outputFormat?: 'text' | 'json' | 'markdown';
}

/**
 * 单条搜索结果
 */
export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
  relevanceScore?: number;
}

/**
 * 单个引擎的响应
 */
export interface EngineResponse {
  engine: string;
  results: SearchResult[];
  latency: number;
  error?: string;
}

/**
 * 聚合后的响应
 */
export interface AggregatedResponse {
  query: string;
  totalResults: number;
  results: SearchResult[];
  engines: {
    name: string;
    status: 'success' | 'error' | 'timeout';
    latency: number;
    count: number;
    error?: string;
  }[];
  processedAt: string;
}

/**
 * 环境变量
 */
export interface Env {
  // API Keys
  EXA_API_KEY?: string;
  TAVILY_API_KEY?: string;
  JINA_API_KEY?: string;
  METASO_API_KEY?: string;
  SEARXNG_URL?: string;

  // 配置
  DEFAULT_TIMEOUT?: string;
  MAX_RESULTS?: string;

  // Durable Object 绑定
  MCP_OBJECT: DurableObjectNamespace;
}
