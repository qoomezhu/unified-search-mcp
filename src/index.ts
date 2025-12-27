// ============================================================
// Unified Search MCP Server
// 聚合搜索 MCP 服务 - 支持多个搜索引擎
// ============================================================

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Env, SearchParams } from './types';
import { DuckDuckGoEngine } from './engines/duckduckgo';
import { SearXNGEngine } from './engines/searxng';
import { ExaEngine } from './engines/exa';
import { TavilyEngine } from './engines/tavily';
import { MetasoEngine } from './engines/metaso';
import { JinaEngine } from './engines/jina';
import { SearchAggregator } from './aggregator';
import { formatResults, formatResultsJson, formatResultsMarkdown, validateSearchParams } from './utils';
import type { SearchEngine } from './engines/base';

// ============================================================
// MCP 服务器类
// ============================================================

export class UnifiedSearchMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "unified-search-mcp",
    version: "1.0.0"
  });

  private initializeEngines(engineNames: string[], timeout: number): SearchEngine[] {
    const engines: SearchEngine[] = [];

    for (const name of engineNames) {
      switch (name.toLowerCase()) {
        case 'duckduckgo':
          engines.push(new DuckDuckGoEngine(this.env, timeout));
          break;
        case 'searxng':
          if (this.env.SEARXNG_URL) {
            engines.push(new SearXNGEngine(this.env, timeout));
          }
          break;
        case 'exa':
          if (this.env.EXA_API_KEY) {
            engines.push(new ExaEngine(this.env, timeout));
          }
          break;
        case 'tavily':
          if (this.env.TAVILY_API_KEY) {
            engines.push(new TavilyEngine(this.env, timeout));
          }
          break;
        case 'metaso':
          if (this.env.METASO_API_KEY) {
            engines.push(new MetasoEngine(this.env, timeout));
          }
          break;
        case 'jina':
          if (this.env.JINA_API_KEY) {
            engines.push(new JinaEngine(this.env, timeout));
          }
          break;
      }
    }

    if (engines.length === 0) {
      engines.push(new DuckDuckGoEngine(this.env, timeout));
    }

    return engines;
  }

  async init() {
    // 工具: unified_search
    this.server.tool(
      'unified_search',
      '聚合多个搜索引擎的结果，自动去重和排序',
      {
        query: z.string().describe('搜索关键词'),
        maxResults: z.number().min(1).max(50).optional().describe('最大结果数 (1-50, 默认20)'),
        dateRange: z.enum(['day', 'week', 'month', 'year', 'all']).optional().describe('时间范围'),
        engines: z.array(z.string()).optional().describe('指定搜索引擎'),
        language: z.string().optional().describe('语言代码 (zh/en)'),
        safeSearch: z.boolean().optional().describe('安全搜索'),
        outputFormat: z.enum(['text', 'json', 'markdown']).optional().describe('输出格式')
      },
      async (args) => {
        const validation = validateSearchParams(args);
        if (!validation.valid) {
          return { content: [{ type: 'text' as const, text: `❌ 参数错误: ${validation.error}` }] };
        }

        const params = validation.sanitized!;
        const timeout = parseInt(this.env.DEFAULT_TIMEOUT || '8000');
        const engines = this.initializeEngines(params.engines, timeout);

        if (engines.length === 0) {
          return { content: [{ type: 'text' as const, text: '❌ 没有可用的搜索引擎' }] };
        }

        const searchParams: SearchParams = {
          query: params.query,
          maxResults: params.maxResults,
          dateRange: params.dateRange as SearchParams['dateRange'],
          language: params.language,
          safeSearch: params.safeSearch
        };

        const responses = await Promise.all(
          engines.map(engine => engine.execute(searchParams))
        );

        const aggregator = new SearchAggregator(params.maxResults);
        const result = aggregator.aggregate(params.query, responses);

        let output: string;
        switch (params.outputFormat) {
          case 'json':
            output = formatResultsJson(result);
            break;
          case 'markdown':
            output = formatResultsMarkdown(result);
            break;
          default:
            output = formatResults(result);
        }

        return { content: [{ type: 'text' as const, text: output }] };
      }
    );

    // 工具: quick_search
    this.server.tool(
      'quick_search',
      '快速搜索 - 仅使用 DuckDuckGo，无需 API Key',
      {
        query: z.string().describe('搜索关键词'),
        maxResults: z.number().min(1).max(20).optional().describe('最大结果数 (1-20, 默认10)')
      },
      async (args) => {
        const { query, maxResults = 10 } = args;

        if (!query || query.trim().length === 0) {
          return { content: [{ type: 'text' as const, text: '❌ 搜索查询不能为空' }] };
        }

        const timeout = parseInt(this.env.DEFAULT_TIMEOUT || '8000');
        const engine = new DuckDuckGoEngine(this.env, timeout);

        try {
          const response = await engine.execute({ query, maxResults });

          if (response.error) {
            return { content: [{ type: 'text' as const, text: `❌ 搜索失败: ${response.error}` }] };
          }

          const lines: string[] = [];
          lines.push(`🔍 快速搜索: ${query}`);
          lines.push(`📊 找到 \({response.results.length} 条结果 (\){response.latency}ms)`);
          lines.push('─'.repeat(50));

          response.results.forEach((r, i) => {
            lines.push(`\n【\({(i + 1).toString().padStart(2, '0')}】\){r.title}`);
            lines.push(`    🔗 ${r.url}`);
            if (r.snippet) {
              lines.push(`    📝 ${r.snippet.substring(0, 150)}...`);
            }
          });

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: `❌ 搜索出错: ${error instanceof Error ? error.message : '未知错误'}`
            }]
          };
        }
      }
    );

    // 工具: search_engines_status
    this.server.tool(
      'search_engines_status',
      '检查各搜索引擎的可用状态',
      {},
      async () => {
        const engines = [
          { name: 'DuckDuckGo', available: true, needsKey: false },
          { name: 'SearXNG', available: !!this.env.SEARXNG_URL, needsKey: false, keyName: 'SEARXNG_URL' },
          { name: 'Exa', available: !!this.env.EXA_API_KEY, needsKey: true, keyName: 'EXA_API_KEY' },
          { name: 'Tavily', available: !!this.env.TAVILY_API_KEY, needsKey: true, keyName: 'TAVILY_API_KEY' },
          { name: 'Metaso', available: !!this.env.METASO_API_KEY, needsKey: true, keyName: 'METASO_API_KEY' },
          { name: 'Jina', available: !!this.env.JINA_API_KEY, needsKey: true, keyName: 'JINA_API_KEY' }
        ];

        const lines: string[] = [];
        lines.push('═'.repeat(50));
        lines.push('📡 搜索引擎状态');
        lines.push('═'.repeat(50));

        for (const engine of engines) {
          const status = engine.available ? '✅ 可用' : '❌ 未配置';
          const keyInfo = engine.needsKey ? ` (需要 ${engine.keyName})` : '';
          lines.push(`  \({engine.name.padEnd(12)} \){status}${keyInfo}`);
        }

        lines.push('─'.repeat(50));
        const availableCount = engines.filter(e => e.available).length;
        lines.push(`📊 可用引擎: \({availableCount}/\){engines.length}`);
        lines.push('═'.repeat(50));

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }
    );

    // 资源: help
    this.server.resource(
      'help',
      'unified-search://help',
      async () => {
        const helpText = `# Unified Search MCP 使用指南

## 可用工具

### 1.‌ unified_search
聚合多个搜索引擎的结果，自动去重和排序。

参数:
- query (必需): 搜索关键词
- maxResults: 最大结果数 (1-50, 默认20)
- dateRange: 时间范围 (day/week/month/year/all)
- engines: 指定引擎数组
- language: 语言代码 (zh/en)
- safeSearch: 安全搜索开关
- outputFormat: 输出格式 (text/json/markdown)

### 2.‌ quick_search
快速搜索，仅使用 DuckDuckGo，无需 API Key。

参数:
- query (必需): 搜索关键词
- maxResults: 最大结果数 (1-20, 默认10)

### 3.‌ search_engines_status
检查各搜索引擎的配置状态。

## 支持的搜索引擎

| 引擎 | 需要配置 | 说明 |
|------|----------|------|
| DuckDuckGo | 无 | 始终可用 |
| SearXNG | SEARXNG_URL | 自托管实例 |
| Exa | EXA_API_KEY | AI 搜索引擎 |
| Tavily | TAVILY_API_KEY | AI 搜索引擎 |
| Metaso | METASO_API_KEY | 中文搜索 |
| Jina | JINA_API_KEY | AI 搜索引擎 |`;

        return {
          contents: [{
            uri: 'unified-search://help',
            mimeType: 'text/markdown',
            text: helpText
          }]
        };
      }
    );
  }
}

// ============================================================
// 默认导出 - Cloudflare Workers 入口
// ============================================================

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Upgrade, Connection',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 根路径 - 返回服务信息
    if (pathname === '/' || pathname === '') {
      return new Response(JSON.stringify({
        name: 'unified-search-mcp',
        version: '1.0.0',
        description: '聚合搜索 MCP 服务',
        status: 'running',
        endpoints: {
          sse: '/sse',
          mcp: '/mcp',
          health: '/health'
        },
        usage: {
          claude_desktop: {
            command: 'npx',
            args: ['mcp-remote', url.origin + '/sse']
          },
          direct_url: url.origin + '/sse'
        },
        engines: ['duckduckgo', 'searxng', 'exa', 'tavily', 'metaso', 'jina']
      }, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // 健康检查
    if (pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // MCP 请求路由到 Durable Object
    if (pathname === '/sse' || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      const id = env.MCP_OBJECT.idFromName('default');
      const stub = env.MCP_OBJECT.get(id);
      return stub.fetch(request);
    }

    // 404
    return new Response(JSON.stringify({
      error: 'Not Found',
      path: pathname,
      availableEndpoints: ['/', '/health', '/sse', '/mcp']
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} as ExportedHandler<Env>;
