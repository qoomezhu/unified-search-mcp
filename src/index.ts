// ============================================================
// Unified Search MCP Server - 终极全功能版
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
// 1. 共享核心逻辑 (Shared Logic)
// ============================================================

function initializeEngines(env: Env, engineNames: string[], timeout: number): SearchEngine[] {
  const engines: SearchEngine[] = [];
  const names = engineNames.length > 0 ? engineNames : ['duckduckgo'];
  
  for (const name of names) {
    switch (name.toLowerCase()) {
      case 'duckduckgo': engines.push(new DuckDuckGoEngine(env, timeout)); break;
      case 'searxng': if (env.SEARXNG_URL) engines.push(new SearXNGEngine(env, timeout)); break;
      case 'exa': if (env.EXA_API_KEY) engines.push(new ExaEngine(env, timeout)); break;
      case 'tavily': if (env.TAVILY_API_KEY) engines.push(new TavilyEngine(env, timeout)); break;
      case 'metaso': if (env.METASO_API_KEY) engines.push(new MetasoEngine(env, timeout)); break;
      case 'jina': if (env.JINA_API_KEY) engines.push(new JinaEngine(env, timeout)); break;
    }
  }
  return engines.length > 0 ? engines : [new DuckDuckGoEngine(env, timeout)];
}

async function runUnifiedSearch(env: Env, args: any) {
  const validation = validateSearchParams(args);
  if (!validation.valid) return { content: [{ type: 'text', text: `❌ 参数错误: ${validation.error}` }] };
  
  const params = validation.sanitized!;
  const timeout = parseInt(env.DEFAULT_TIMEOUT || '8000');
  const engines = initializeEngines(env, params.engines, timeout);
  
  const responses = await Promise.all(engines.map(e => e.execute(params)));
  const result = new SearchAggregator(params.maxResults).aggregate(params.query, responses);
  
  let output: string;
  if (params.outputFormat === 'json') output = formatResultsJson(result);
  else if (params.outputFormat === 'markdown') output = formatResultsMarkdown(result);
  else output = formatResults(result);
  
  return { content: [{ type: 'text', text: output }] };
}

async function runQuickSearch(env: Env, args: any) {
  const { query, maxResults = 10 } = args;
  if (!query) return { content: [{ type: 'text', text: '❌ 搜索查询不能为空' }] };
  
  const engine = new DuckDuckGoEngine(env, 8000);
  const response = await engine.execute({ query, maxResults });
  
  const lines = [`🔍 快速搜索: \({query}`, `📊 找到 \){response.results.length} 条结果 (${response.latency}ms)`, '─'.repeat(50)];
  response.results.forEach((r, i) => lines.push(`\n【\({i+1}】\){r.title}\n    🔗 ${r.url}`));
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

async function runConnectivityTest(env: Env) {
  const engineNames = ['duckduckgo', 'searxng', 'exa', 'tavily', 'metaso', 'jina'];
  const engines = initializeEngines(env, engineNames, 5000);
  const lines = ['🧪 搜索引擎实时连通性测试 (Live Probe)', '═'.repeat(60)];
  lines.push(`\({'引擎'.padEnd(12)} | \){'状态'.padEnd(4)} | \({'延迟'.padEnd(8)} | \){'备注'}`);
  lines.push('─'.repeat(60));

  const results = await Promise.all(engines.map(async (e) => {
    const start = Date.now();
    try {
      const res = await e.execute({ query: 'ping', maxResults: 1 });
      return { name: e.constructor.name.replace('Engine',''), status: res.error ? '❌' : '✅', latency: Date.now()-start, note: res.error || '正常' };
    } catch (err) {
      return { name: e.constructor.name.replace('Engine',''), status: '❌', latency: Date.now()-start, note: (err as Error).message };
    }
  }));

  results.forEach(r => lines.push(`\({r.name.padEnd(12)} | \){r.status.padEnd(4)} | \({String(r.latency+'ms').padEnd(8)} | \){r.note}`));
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ============================================================
// 2. HTTP MCP 处理器 (Streamable HTTP)
// ============================================================

async function handleHttpMcp(request: Request, env: Env): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const sessionId = request.headers.get('Mcp-Session-Id') || crypto.randomUUID();

  if (request.method === 'GET') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId }
    });
  }

  try {
    const body = await request.json() as any;
    let result: any;

    switch (body.method) {
      case 'initialize':
        result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'unified-search', version: '1.0.0' } };
        break;
      case 'tools/list':
        result = { tools: [
          { name: 'unified_search', description: '聚合搜索', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
          { name: 'quick_search', description: '快速搜索', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
          { name: 'test_engines_connectivity', description: '连通性测试', inputSchema: { type: 'object', properties: {} } }
        ]};
        break;
      case 'tools/call':
        const { name, arguments: args } = body.params;
        if (name === 'unified_search') result = await runUnifiedSearch(env, args);
        else if (name === 'quick_search') result = await runQuickSearch(env, args);
        else if (name === 'test_engines_connectivity') result = await runConnectivityTest(env);
        break;
      default: result = {};
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', result, id: body.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId }
    });
  } catch (e) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' } }), { status: 400, headers: corsHeaders });
  }
}

// ============================================================
// 3. Durable Object 类 (WebSocket/SSE)
// ============================================================

export class UnifiedSearchMCP extends McpAgent<Env> {
  server = new McpServer({ name: "unified-search-mcp", version: "1.0.0" });

  async init() {
    this.server.tool('unified_search', '聚合多个搜索引擎的结果', {
      query: z.string(),
      maxResults: z.number().optional(),
      engines: z.array(z.string()).optional(),
      outputFormat: z.enum(['text', 'json', 'markdown']).optional()
    }, async (args) => runUnifiedSearch(this.env, args));

    this.server.tool('quick_search', '仅使用 DuckDuckGo 快速搜索', {
      query: z.string(),
      maxResults: z.number().optional()
    }, async (args) => runQuickSearch(this.env, args));

    this.server.tool('test_engines_connectivity', '实时测试所有搜索引擎的连通性', {}, 
      async () => runConnectivityTest(this.env));
  }
}

// ============================================================
// 4. 默认导出 (Routing)
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'running', endpoints: ['/http', '/sse'] }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (url.pathname === '/http') {
      return await handleHttpMcp(request, env);
    }

    // 路由到 Durable Object
    const id = env.MCP_OBJECT.idFromName('default');
    const stub = env.MCP_OBJECT.get(id);
    return stub.fetch(request);
  }
} as ExportedHandler<Env>;
