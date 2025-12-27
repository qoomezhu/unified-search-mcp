// ============================================================
// 工具函数
// ============================================================

import type { AggregatedResponse, SearchResult } from './types';

/**
 * 格式化搜索结果为整齐的文本输出
 */
export function formatResults(response: AggregatedResponse): string {
  const lines: string[] = [];
  
  // 标题
  lines.push('═'.repeat(70));
  lines.push(`🔍 搜索查询: ${response.query}`);
  lines.push(`📊 找到 \({response.totalResults} 条结果 | 处理时间: \){response.processedAt}`);
  lines.push('═'.repeat(70));
  
  // 引擎状态
  lines.push('\n📡 搜索引擎状态:');
  lines.push('─'.repeat(70));
  
  const statusEmoji = {
    success: '✅',
    error: '❌',
    timeout: '⏱️'
  };
  
  for (const engine of response.engines) {
    const emoji = statusEmoji[engine.status];
    const latency = `${engine.latency}ms`.padStart(6);
    const count = `${engine.count}条`.padStart(5);
    const status = engine.error ? ` (${engine.error.substring(0, 30)})` : '';
    lines.push(`  \({emoji} \){engine.name.padEnd(12)} | \({latency} | \){count}${status}`);
  }
  
  // 搜索结果
  lines.push('\n' + '═'.repeat(70));
  lines.push('📋 搜索结果 (按相关度排序):');
  lines.push('═'.repeat(70));
  
  response.results.forEach((result, index) => {
    lines.push('');
    lines.push(`【\({(index + 1).toString().padStart(2, '0')}】\){truncate(result.title, 60)}`);
    lines.push(`    🔗 ${result.url}`);
    lines.push(`    📝 ${truncate(result.snippet, 200) || '暂无摘要'}`);
    
    const meta: string[] = [];
    if (result.source) meta.push(`来源: ${result.source}`);
    if (result.publishedDate) meta.push(`日期: ${formatDate(result.publishedDate)}`);
    if (result.relevanceScore) meta.push(`相关度: ${result.relevanceScore.toFixed(1)}`);
    
    if (meta.length > 0) {
      lines.push(`    📌 ${meta.join(' | ')}`);
    }
    lines.push('─'.repeat(70));
  });
  
  lines.push('\n' + '═'.repeat(70));
  lines.push('🏁 搜索完成');
  lines.push('═'.repeat(70));
  
  return lines.join('\n');
}

/**
 * 格式化为JSON输出（用于API调用）
 */
export function formatResultsJson(response: AggregatedResponse): string {
  return JSON.stringify(response, null, 2);
}

/**
 * 格式化为Markdown输出
 */
export function formatResultsMarkdown(response: AggregatedResponse): string {
  const lines: string[] = [];
  
  lines.push(`# 🔍 搜索结果: ${response.query}\n`);
  lines.push(`> 共找到 **\({response.totalResults}** 条结果 | 处理时间: \){response.processedAt}\n`);
  
  // 引擎状态表格
  lines.push('## 📡 搜索引擎状态\n');
  lines.push('| 引擎 | 状态 | 延迟 | 结果数 |');
  lines.push('|------|------|------|--------|');
  
  for (const engine of response.engines) {
    const status = engine.status === 'success' ? '✅' : engine.status === 'timeout' ? '⏱️' : '❌';
    lines.push(`| \({engine.name} | \){status} | \({engine.latency}ms | \){engine.count} |`);
  }
  
  // 搜索结果
  lines.push('\n## 📋 搜索结果\n');
  
  response.results.forEach((result, index) => {
    lines.push(`### \({index + 1}. \){result.title}\n`);
    lines.push(`- 🔗 **链接**: [\({truncate(result.url, 50)}](\){result.url})`);
    lines.push(`- 📝 **摘要**: ${result.snippet || '暂无摘要'}`);
    
    const meta: string[] = [];
    if (result.source) meta.push(`来源: ${result.source}`);
    if (result.publishedDate) meta.push(`日期: ${formatDate(result.publishedDate)}`);
    if (result.relevanceScore) meta.push(`相关度: ${result.relevanceScore.toFixed(1)}`);
    
    if (meta.length > 0) {
      lines.push(`- 📌 **元信息**: ${meta.join(' | ')}`);
    }
    lines.push('');
  });
  
  return lines.join('\n');
}

/**
 * 截断文本
 */
export function truncate(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * 格式化日期
 */
export function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

/**
 * 验证搜索参数
 */
export function validateSearchParams(params: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  sanitized?: {
    query: string;
    maxResults: number;
    dateRange: string;
    engines: string[];
    language: string;
    safeSearch: boolean;
    outputFormat: string;
  };
} {
  const query = params.query;
  
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return { valid: false, error: '搜索查询不能为空' };
  }
  
  if (query.length > 500) {
    return { valid: false, error: '搜索查询不能超过500个字符' };
  }
  
  const validDateRanges = ['day', 'week', 'month', 'year', 'all'];
  const dateRange = params.dateRange as string || 'all';
  if (!validDateRanges.includes(dateRange)) {
    return { valid: false, error: `无效的日期范围。可用选项: ${validDateRanges.join(', ')}` };
  }
  
  const validEngines = ['duckduckgo', 'searxng', 'exa', 'tavily', 'metaso', 'jina'];
  let engines = params.engines as string[] || validEngines;
  if (typeof engines === 'string')
    engines = engines.split(',').map(e => e.trim().toLowerCase());
  }
  engines = engines.filter(e => validEngines.includes(e.toLowerCase()));
  if (engines.length === 0) {
    engines = validEngines;
  }
  
  const maxResults = Math.min(Math.max(parseInt(String(params.maxResults)) || 20, 1), 50);
  
  const validFormats = ['text', 'json', 'markdown'];
  const outputFormat = validFormats.includes(params.outputFormat as string) 
    ? params.outputFormat as string 
    : 'text';
  
  return {
    valid: true,
    sanitized: {
      query: query.trim(),
      maxResults,
      dateRange,
      engines,
      language: (params.language as string) || 'zh',
      safeSearch: params.safeSearch !== false,
      outputFormat
    }
  };
}
