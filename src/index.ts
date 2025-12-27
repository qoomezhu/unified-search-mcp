// ============================================================
// 统一搜索 MCP 服务器 - 主入口
// Cloudflare Workers + Streamable HTTP
// ============================================================

import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Env, SearchParams, EngineResponse } from './types';
import { DuckDuckGoEngine } from './engines/duckduckgo';
import { SearXNGEngine } from './engines/searxng';
import { ExaEngine } from './engines/exa';
import { TavilyEngine } from './engines/tavily';
import { MetasoEngine } from './engines/metaso';
import { JinaEngine } from './engines/jina';
import { SearchAggregator } from './aggregator';
import { formatResults, formatResultsMarkdown, formatResultsJson, validateSearchParams } from './utils';

// ============================================================
// MCP Agent 定义
// ============================================================

export class UnifiedSearchMCP extends McpAgent<Env> {
  server = new McpServer({
    name: 'Unified Search MCP',
    version: '1.0.0'
  });

  async init() {
    // --------------------------------------------------------
    // 工具: unified_search - 聚合搜索
    // --------------------------------------------------------
    this.server.tool(
      'unified_search',
      '聚合多个搜索引擎的结果，包括 DuckDuckGo、SearXNG、Exa、Tavily、Metaso、Jina。自动去重并按相关度排序返回最优结果。',
      {
        query: z.string().describe('搜索查询关键词'),
        maxResults: z.number().min(1).max(50).default(20).describe('最大返回结果数 (1-50，默认20)'),
        dateRange: z.enum(['day', 'week', 'month', 'year', 'all']).default('all').describe('时间范围过滤'),
        engines: z.array(z.enum(['duckduckgo', 'searxng', 'exa', 'tavily', 'metaso', 'jina'])).optional().describe('指定使用的搜索引擎（默认全部）'),
        language: z.string().default('zh').describe('搜索语言 (zh, en 等)'),
        safeSearch: z.boolean().default(true).describe('是否启用安全搜索'),
        outputFormat: z.enum(['text', 'json', 'markdown']).default('text').describe('输出格式')
      },
      async (params) => {
        // 参数验证
        const validation = validateSearchParams(params);
        if (!validation.valid) {
          return {
            content: [{ type: 'text', text: `❌ 参数错误: ${validation.error}` }],
            isError: true
          };
        }

        const searchParams = validation.sanitized!;
        const timeout = parseInt(this.env.DEFAULT_TIMEOUT || '8000');
        const maxResults = parseInt(this.env.MAX_RESULTS || '20');

        // 初始化搜索引擎
        const engines = this.initializeEngines(searchParams.engines, timeout);
        
        if (engines.length === 0) {
          return {
            content: [{ type: 'text', text: '❌ 没有可用的搜索引擎。请检查 API 密钥配置。' }],
            isError: true
          };
        }

        // 并发执行搜索
        const searchPromises = engines.map(engine => 
          engine.execute({
            query: searchParams.query,
            maxResults: Math.ceil(searchParams.maxResults / engines.length) + 5,
            dateRange: searchParams.dateRange as SearchParams['dateRange'],
            language: searchParams.language,
            safeSearch: searchParams.safeSearch
          })
        );

        const responses = await Promise.all(searchPromises);

        // 聚合结果
        const aggregator = new SearchAggregator(searchParams.maxResults);
        const aggregatedResponse = aggregator.aggregate(searchParams.query, responses);

        // 格式化输出
        let output: string;
        switch (searchParams.outputFormat) {
          case 'json':
            output = formatResultsJson(aggregatedResponse);
            break;
          case 'markdown':
            output = formatResultsMarkdown(aggregatedResponse);
            break;
          default:
            output = formatResults(aggregatedResponse);
        }

        return {
          content: [{ type: 'text', text: output }]
        };
      }
    );

    // --------------------------------------------------------
    // 工具: quick_search - 快速搜索（仅DuckDuckGo，无需API Key）
    // --------------------------------------------------------
    this.server.tool(
      'quick_search',
      '快速搜索 - 仅使用 DuckDuckGo，无需 API Key，适合简单查询',
      {
        query: z.string().describe('搜索查询关键词'),
        maxResults: z.number().min(1).max(20).default(10).describe('最大返回结果数')
      },
      async (params) => {
        const { query, maxResults = 10 } = params;
        
        if (!query || query.trim().length === 0) {
          return {
            content: [{ type: 'text', text: '❌ 搜索查询不能为空' }],
            isError: true
          };
        }

        const timeout = parseInt(this.env.DEFAULT_TIMEOUT || '8000');
        const engine = new DuckDuckGoEngine(this.env, timeout);
        
        try {
          const response = await engine.execute({ query: query.trim(), maxResults });
          
          if (response.error) {
            return {
              content: [{ type: 'text', text: `❌ 搜索失败: ${response.error}` }],
              isError: true
            };
          }

          const aggregator = new SearchAggregator(maxResults);
          const aggregatedResponse = aggregator.aggregate(query, [response]);
          const output = formatResults(aggregatedResponse);

          return {
            content: [{ type: 'text', text: output }]
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ 搜索异常: ${error instanceof Error ? error.message : '未知错误'}` }],
            isError: true
          };
        }
      }
    );

        // --------------------------------------------------------
    // 工具: search_engines_status - 检查搜索引擎状态
    // --------------------------------------------------------
    this.server.tool(
      'search_engines_status',
      '检查所有搜索引擎的配置状态和可用性',
      {},
      async () => {
        const engines = [
          { name: 'DuckDuckGo', key: null, required: false },
          { name: 'SearXNG', key: this.env.SEARXNG_URL, required: false },
          { name: 'Exa', key: this.env.EXA_API_KEY, required: true },
          { name: 'Tavily', key: this.env.TAVILY_API_KEY, required: true },
          { name: 'Metaso', key: this.env.METASO_API_KEY, required: true },
          { name: 'Jina', key: this.env.JINA_API_KEY, required: true }
        ];

        const lines: string[] = [];
        lines.push('═'.repeat(50));
        lines.push('🔧 搜索引擎配置状态');
        lines.push('═'.repeat(50));
        lines.push('');

        let availableCount = 0;

        for (const engine of engines) {
          let status: string;
          let emoji: string;

          if (!engine.required) {
            status = '✅ 可用 (无需API Key)';
            emoji = '🟢';
            availableCount++;
          } else if (engine.key && engine.key.length > 0) {
            status = '✅ 已配置';
            emoji = '🟢';
            availableCount++;
          } else {
            status = '❌ 未配置 API Key';
            emoji = '🔴';
          }

          lines.push(`\({emoji} \){engine.name.padEnd(12)} | ${status}`);
        }

        lines.push('');
        lines.push('─'.repeat(50));
        lines.push(`📊 总计: \({availableCount}/\){engines.length} 个引擎可用`);
        lines.push('');
        lines.push('💡 提示: 使用 wrangler secret put <KEY_NAME> 配置 API 密钥');
        lines.push('═'.repeat(50));

        return {
          content: [{ type: 'text', text: lines.join('\n') }]
        };
      }
    );

    // --------------------------------------------------------
    // 资源: 使用说明
    // --------------------------------------------------------
    this.server.resource(
      'help',
      'unified-search://help',
      async (uri) => {
        const helpText = `
# 📚 Unified Search MCP 使用说明

## 🔧 可用工具

### 1.‌ unified_search (聚合搜索)
聚合多个搜索引擎结果，自动去重和排序。

**参数:**
- query (必填): 搜索关键词
- maxResults: 最大结果数 (1-50, 默认20)
- dateRange: 时间范围 (day/week/month/year/all)
- engines: 指定引擎数组
- language: 语言代码 (zh/en等)
- safeSearch: 安全搜索开关
- outputFormat: 输出格式 (text/json/markdown)

### 2.‌ quick_search (快速搜索)
仅使用 DuckDuckGo，无需 API Key。

**参数:**
- query (必填): 搜索关键词
- maxResults: 最大结果数 (1-20, 默认10)

### 3.‌ search_engines_status (状态检查)
检查所有搜索引擎的配置状态。

## 🔑 API Key 配置

\`\`\`bash
wrangler secret put EXA_API_KEY
wrangler secret put TAVILY_API_KEY
wrangler secret put JINA_API_KEY
wrangler secret put METASO_API_KEY
wrangler secret put SEARXNG_URL
\`\`\`

## 📡 支持的搜索引擎

| 引擎 | 需要API Key | 特点 |
|------|-------------|------|
| DuckDuckGo | ❌ | 免费，隐私友好 |
| SearXNG | ❌ (需实例URL) | 开源聚合 |
| Exa | ✅ | AI优化，高质量 |
| Tavily | ✅ | 专为AI设计 |
| Metaso | ✅ | 中文优化 |
| Jina | ✅ | 内容抓取强 |
`;
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'text/markdown',
            text: helpText
          }]
        };
      }
    );
  }

  // --------------------------------------------------------
  // 辅助方法: 初始化搜索引擎
  // --------------------------------------------------------
  private initializeEngines(requestedEngines: string[], timeout: number) {
    const allEngines: { name: string; instance: any; needsKey: boolean }[] = [
      { name: 'duckduckgo', instance: new DuckDuckGoEngine(this.env, timeout), needsKey: false },
      { name: 'searxng', instance: new SearXNGEngine(this.env, timeout), needsKey: false },
      { name: 'exa', instance: new ExaEngine(this.env, timeout), needsKey: true },
      { name: 'tavily', instance: new TavilyEngine(this.env, timeout), needsKey: true },
      { name: 'metaso', instance: new MetasoEngine(this.env, timeout), needsKey: true },
      { name: 'jina', instance: new JinaEngine(this.env, timeout), needsKey: true }
    ];

    return allEngines
      .filter(e => {
        // 检查是否在请求列表中
        if (!requestedEngines.includes(e.name)) return false;
        // 检查是否有必要的API Key
        if (e.needsKey && typeof e.instance.isAvailable === 'function') {
          return e.instance.isAvailable();
        }
        return true;
      })
      .map(e => e.instance);
  }
}

// ============================================================
// Cloudflare Workers 导出
// ============================================================

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // 健康检查端点
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'Unified Search MCP',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 根路径信息
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        name: 'Unified Search MCP Server',
        version: '1.0.0',
        description: '聚合搜索 MCP 服务 - 支持 DuckDuckGo, SearXNG, Exa, Tavily, Metaso, Jina',
        endpoints: {
          mcp: '/sse',
          health: '/health'
        },
        tools: ['unified_search', 'quick_search', 'search_engines_status'],
        documentation: 'https://github.com/your-username/unified-search-mcp'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // MCP SSE 端点
    if (url.pathname === '/sse' || url.pathname === '/mcp') {
      return UnifiedSearchMCP.serveSSE('/sse').fetch(request, env, ctx);
    }

    // MCP HTTP 端点
    if (url.pathname === '/mcp/message') {
      return UnifiedSearchMCP.serve('/mcp').fetch(request, env, ctx);
    }

    return new Response('Not Found', { status: 404 });
  }
} satisfies ExportedHandler<Env>;
