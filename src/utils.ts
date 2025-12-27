import type { AggregatedResponse, SearchResult } from './types';

export function formatResults(response: AggregatedResponse): string {
  const lines: string[] = [];
  lines.push('============================================================');
  lines.push('搜索查询: ' + response.query);
  lines.push('找到 ' + response.totalResults + ' 条结果');
  lines.push('============================================================');

  lines.push('');
  lines.push('搜索引擎状态:');
  lines.push('------------------------------------------------------------');
  for (const engine of response.engines) {
    const status = engine.status === 'success' ? 'OK' : 'FAIL';
    lines.push('  ' + engine.name + ' | ' + status + ' | ' + engine.latency + 'ms');
  }

  lines.push('');
  lines.push('============================================================');
  lines.push('搜索结果:');
  lines.push('============================================================');

  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    const num = i + 1;
    lines.push('');
    lines.push('[' + num + '] ' + result.title);
    lines.push('    URL: ' + result.url);
    lines.push('    ' + (result.snippet || '暂无摘要'));
    lines.push('------------------------------------------------------------');
  }

  return lines.join('\n');
}

export function formatResultsJson(response: AggregatedResponse): string {
  return JSON.stringify(response, null, 2);
}

export function formatResultsMarkdown(response: AggregatedResponse): string {
  const lines: string[] = [];
  lines.push('# 搜索结果: ' + response.query);
  lines.push('');
  lines.push('共找到 ' + response.totalResults + ' 条结果');
  lines.push('');
  lines.push('## 结果列表');
  lines.push('');
  
  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    const num = i + 1;
    lines.push('### ' + num + '. ' + r.title);
    lines.push('');
    lines.push('URL: ' + r.url);
    lines.push('');
    lines.push(r.snippet || '暂无摘要');
    lines.push('');
  }
  
  return lines.join('\n');
}

export function validateSearchParams(params: any): any {
  const query = params.query;
  if (!query || String(query).trim().length === 0) {
    return { valid: false, error: '查询不能为空' };
  }
  return {
    valid: true,
    sanitized: {
      query: String(query).trim(),
      maxResults: params.maxResults || 20,
      engines: params.engines || [],
      outputFormat: params.outputFormat || 'text'
    }
  };
}
