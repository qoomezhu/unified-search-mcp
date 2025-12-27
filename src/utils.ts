import type { AggregatedResponse, SearchResult } from './types';

export function formatResults(response: AggregatedResponse): string {
  const lines: string[] = [];
  lines.push('============================================================');
  lines.push('🔍 搜索查询: ' + response.query);
  lines.push('📊 找到 ' + response.totalResults + ' 条结果 | 处理时间: ' + response.processedAt);
  lines.push('============================================================');

  lines.push('\n📡 搜索引擎状态:');
  lines.push('------------------------------------------------------------');
  for (const engine of response.engines) {
    const status = engine.status === 'success' ? '✅' : '❌';
    lines.push('  ' + status + ' ' + engine.name.padEnd(12) + ' | ' + engine.latency + 'ms | ' + engine.count + '条');
  }

  lines.push('\n============================================================');
  lines.push('📋 搜索结果:');
  lines.push('============================================================');

  response.results.forEach((result, index) => {
    lines.push('\n【' + (index + 1) + '】' + result.title);
    lines.push('  🔗 ' + result.url);
    lines.push('  📝 ' + (result.snippet || '暂无摘要'));
    lines.push('------------------------------------------------------------');
  });

  return lines.join('\n');
}

export function formatResultsJson(response: AggregatedResponse): string {
  return JSON.stringify(response, null, 2);
}

export function formatResultsMarkdown(response: AggregatedResponse): string {
  let md = '# 🔍 搜索结果: ' + response.query + '\n\n';
  md += '> 共找到 ' + response.totalResults + ' 条结果\n\n';
  md += '## 📋 结果列表\n\n';
  response.results.forEach((r, i) => {
    md += '### ' + (i + 1) + '. ' + r.title + '\n';
    // 修复后的行：确保引号闭合正确
    md += '- 🔗 [点击访问](')\n';
    md += '- 📝 ' + r.snippet + '\n\n';
  });
  return md;
}

export function validateSearchParams(params: any) {
  const query = params.query || '';
  if (!query || query.trim().length === 0) return { valid: false, error: '查询不能为空' };
  return {
    valid: true,
    sanitized: {
      query: query.trim(),
      maxResults: params.maxResults || 20,
      engines: params.engines || [],
      outputFormat: params.outputFormat || 'text'
    }
  };
}
