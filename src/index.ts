// ============================================================
// Unified Search MCP Server
// 聚合搜索 MCP 服务 - 支持多个搜索引擎
// 支持 WebSocket 和 Streamable HTTP 两种传输方式
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
// MCP 工具定义
// ============================================================

const MCP_TOOLS = [
  {
    name: 'unified_search',
    description: '聚合多个搜索引擎的结果，自动去重和排序',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        maxResults: { type: 'number', description: '最大结果数 (1-50, 默认20)' },
        dateRange: { type: 'string', enum: ['day', 'week', 'month', 'year', 'all'], description: '时间范围' },
        engines: { type: 'array', items: { type: 'string' }, description: '指定搜索引擎' },
        language: { type: 'string', description: '语言代码 (zh/en)' },
        safeSearch: { type: 'boolean', description: '安全搜索' },
        outputFormat: { type: 'string', enum: ['text', 'json', 'markdown'], description: '输出格式' }
      },
      required: ['query']
    }
  },
  {
    name: 'quick_search',
    description: '快速搜索 - 仅使用 DuckDuckGo，无需 API Key',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        maxResults: { type: 'number', description: '最大结果数 (1-20, 默认10)' }
      },
      required: ['query']
    }
  },
  {
    name: 'search_engines_status',
    description: '检查各搜索引擎的可用状态',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// ============================================================
// 引擎初始化辅助函数
// ============================================================

function initializeEngines(env: Env, engineNames: string[], timeout: number): SearchEngine[] {
  const engines: SearchEngine[] = [];

  for (const name of engineNames) {
    switch (name.toLowerCase()) {
      case 'duckduckgo':
        engines.push(new DuckDuckGoEngine(env, timeout));
        break;
      case 'searxng':
        if (env.SEARXNG_URL) {
          engines.push(new SearXNGEngine(env, timeout));
        }
        break;
      case 'exa':
        if (env.EXA_API_KEY) {
          engines.push(new ExaEngine(env, timeout));
        }
        break;
      case 'tavily':
        if (env.TAVILY_API_KEY) {
          engines.push(new TavilyEngine(env, timeout));
        }
        break;
      case 'metaso':
        if (env.METASO_API_KEY) {
          engines.push(new MetasoEngine(env, timeout));
        }
        break;
      case 'jina':
        if (env.JINA_API_KEY) {
          engines.push(new JinaEngine(env, timeout));
        }
        break;
    }
  }

  if (engines.length === 0) {
    engines.push(new DuckDuckGoEngine(env, timeout));
  }

  return engines;
}


// ============================================================
// 工具执行函数
// ============================================================

async function executeUnifiedSearch(env: Env, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const validation = validateSearchParams(args);
  if (!validation.valid) {
    return { content: [{ type: 'text', text: `❌ 参数错误: ${validation.error}` }] };
  }

  const params = validation.sanitized!;
  const timeout = parseInt(env.DEFAULT_TIMEOUT || '8000');
  const engines = initializeEngines(env, params.engines, timeout);

  if (engines.length === 0) {
    return { content: [{ type: 'text', text: '❌ 没有可用的搜索引擎' }] };
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

  return { content: [{ type: 'text', text: output }] };
}

async function executeQuickSearch(env: Env, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const query = args.query as string;
  const maxResults = (args.maxResults as number) || 10;

  if (!query || query.trim().length === 0) {
    return { content: [{ type: 'text', text: '❌ 搜索查询不能为空' }] };
  }

  const timeout = parseInt(env.DEFAULT_TIMEOUT || '8000');
  const engine = new DuckDuckGoEngine(env, timeout);

  try {
    const response = await engine.execute({ query, maxResults });

    if (response.error) {
      return { content: [{ type: 'text', text: `❌ 搜索失败: ${response.error}` }] };
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

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `❌ 搜索出错: ${error instanceof Error ? error.message : '未知错误'}`
      }]
    };
  }
}

function executeSearchEnginesStatus(env: Env): { content: Array<{ type: string; text: string }> } {
  const engines = [
    { name: 'DuckDuckGo', available: true, needsKey: false, keyName: '' },
    { name: 'SearXNG', available: !!env.SEARXNG_URL, needsKey: false, keyName: 'SEARXNG_URL' },
    { name: 'Exa', available: !!env.EXA_API_KEY, needsKey: true, keyName: 'EXA_API_KEY' },
    { name: 'Tavily', available: !!env.TAVILY_API_KEY, needsKey: true, keyName: 'TAVILY_API_KEY' },
    { name: 'Metaso', available: !!env.METASO_API_KEY, needsKey: true, keyName: 'METASO_API_KEY' },
    { name: 'Jina', available: !!env.JINA_API_KEY, needsKey: true, keyName: 'JINA_API_KEY' }
  ];

  const lines: string[] = [];
  lines.push('═'.repeat(50));
  lines.push('📡 搜索引擎状态');
  lines.push('═'.repeat(50));

  for (const engine of engines) {
    const status = engine.available ? '✅ 可用' : '❌ 未配置';
    const keyInfo = engine.keyName ? ` (需要 ${engine.keyName})` : '';
    lines.push(`  \({engine.name.padEnd(12)} \){status}${keyInfo}`);
  }

  lines.push('─'.repeat(50));
  const availableCount = engines.filter(e => e.available).length;
  lines.push(`📊 可用引擎: \({availableCount}/\){engines.length}`);
  lines.push('═'.repeat(50));

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ============================================================
// Streamable HTTP MCP 处理器
// ============================================================

async function handleHttpMcp(request: Request, env: Env): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // GET 请求 - 返回 SSE 流（用于服务器推送通知）
  if (request.method === 'GET') {
    const sessionId = request.headers.get('Mcp-Session-Id') || crypto.randomUUID();
    
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    }) + '\n', {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Mcp-Session-Id': sessionId
      }
    });
  }

  // DELETE 请求 - 关闭会话
  if (request.method === 'DELETE') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // POST 请求 - 处理 JSON-RPC
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Method not allowed' },
      id: null
    }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const sessionId = request.headers.get('Mcp-Session-Id') || crypto.randomUUID();

  try {
    const body = await request.json() as { jsonrpc: string; method: string; params?: Record<string, unknown>; id?: string | number };
    const { jsonrpc, method, params, id } = body;

    if (jsonrpc !== '2.0') {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid JSON-RPC version' },
        id
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let result: unknown;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false }
          },
          serverInfo: {
            name: 'unified-search-mcp',
            version: '1.0.0'
          }
        };
        break;

      case 'notifications/initialized':
        return new Response(null, { status: 204, headers: corsHeaders });

      case 'tools/list':
        result = { tools: MCP_TOOLS };
        break;

      case 'tools/call':
        result = await handleToolCall(env, params || {});
        break;

      case 'resources/list':
        result = {
          resources: [{
            uri: 'unified-search://help',
            name: 'help',
            mimeType: 'text/markdown',
            description: '使用帮助文档'
          }]
        };
        break;

      case 'resources/read':
        result = handleResourceRead(params || {});
        break;

      case 'ping':
        result = {};
        break;

      default:
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Unknown method: ${method}` },
          id
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      result,
      id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32700, message: error instanceof Error ? error.message : 'Parse error' },
      id: null
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleToolCall(env: Env, params: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const toolName = params.name as string;
  const args = (params.arguments || {}) as Record<string, unknown>;

  switch (toolName) {
    case 'unified_search':
      return await executeUnifiedSearch(env, args);

    case 'quick_search':
      return await executeQuickSearch(env, args);

    case 'search_engines_status':
      return executeSearchEnginesStatus(env);

    default:
      return { content: [{ type: 'text', text: `❌ 未知工具: ${toolName}` }] };
  }
}

function handleResourceRead(params: Record<string, unknown>): { contents: Array<{ uri: string; mimeType: string; text: string }> } {
  const uri = params.uri as string;

  if (uri === 'unified-search://help') {
    return {
      contents: [{
        uri: 'unified-search://help',
        mimeType: 'text/markdown',
        text: `# Unified Search MCP 使用指南

## 可用工具

### 1.‌ unified_search
聚合多个搜索引擎的结果，自动去重和排序。

**参数:**
- query (必需): 搜索关键词
- maxResults: 最大结果数 (1-50, 默认20)
- dateRange: 时间范围 (day/week/month/year/all)
- engines: 指定引擎数组
- language: 语言代码 (zh/en)
- safeSearch: 安全搜索开关
- outputFormat: 输出格式 (text/json/markdown)

### 2.‌ quick_search
快速搜索，仅使用 DuckDuckGo，无需 API Key。

**参数:**
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
| Jina | JINA_API_KEY | AI 搜索引擎 |`
      }]
    };
  }

  return {
    contents: [{
      uri: uri,
      mimeType: 'text/plain',
      text: '资源未找到'
    }]
  };
}

// ============================================================
// WebSocket MCP 服务器类（保留原有功能）
// ============================================================

export class UnifiedSearchMCP extends McpAgent<Env> {
  server = new McpServer({
    name: "unified-search-mcp",
    version: "1.0.0"
  });

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
        return await executeUnifiedSearch(this.env, args);
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
        return await executeQuickSearch(this.env, args);
      }
    );

    // 工具: search_engines_status
    this.server.tool(
      'search_engines_status',
      '检查各搜索引擎的可用状态',
      {},
      async () => {
        return executeSearchEnginesStatus(this.env);
      }
    );

    // 资源: help
    this.server.resource(
      'help',
      'unified-search://help',
      async () => {
        return handleResourceRead({ uri: 'unified-search://help' });
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
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Upgrade, Connection, Mcp-Session-Id',
          'Access-Control-Expose-Headers': 'Mcp-Session-Id',
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
          http: '/http (Streamable HTTP - 推荐)',
          sse: '/sse (WebSocket)',
          mcp: '/mcp (WebSocket)',
          health: '/health'
        },
        usage: {
          streamable_http: {
            url: url.origin + '/http',
            method: 'POST',
            contentType: 'application/json'
          },
          claude_desktop: {
            command: 'npx',
            args: ['mcp-remote', url.origin + '/sse']
          }
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

    // Streamable HTTP 端点（推荐移动端使用）
    if (pathname === '/http') {
      return await handleHttpMcp(request, env);
    }

    // WebSocket MCP 端点（路由到 Durable Object）
    if (pathname === '/sse' || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      const id = env.MCP_OBJECT.idFromName('default');
      const stub = env.MCP_OBJECT.get(id);
      return stub.fetch(request);
    }

    // 404
    return new Response(JSON.stringify({
      error: 'Not Found',
      path: pathname,
      availableEndpoints: ['/', '/health', '/http', '/sse', '/mcp']
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
} as ExportedHandler<Env>;
