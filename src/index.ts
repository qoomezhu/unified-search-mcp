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

async function runUnifiedSearch(env: Env, args: any) {
  const v = validateSearchParams(args);
  if (!v.valid) return { content: [{ type: 'text', text: '❌ 错误: ' + v.error }] };
  
  const timeout = parseInt(env.DEFAULT_TIMEOUT || '8000');
  const engineNames = v.sanitized.engines.length > 0 ? v.sanitized.engines : ['duckduckgo'];
  const engines: SearchEngine[] = [];
  
  for (const name of engineNames) {
    const n = name.toLowerCase();
    if (n === 'duckduckgo') engines.push(new DuckDuckGoEngine(env, timeout));
    else if (n === 'searxng' && env.SEARXNG_URL) engines.push(new SearXNGEngine(env, timeout));
    else if (n === 'exa' && env.EXA_API_KEY) engines.push(new ExaEngine(env, timeout));
    else if (n === 'tavily' && env.TAVILY_API_KEY) engines.push(new TavilyEngine(env, timeout));
    else if (n === 'metaso' && env.METASO_API_KEY) engines.push(new MetasoEngine(env, timeout));
    else if (n === 'jina' && env.JINA_API_KEY) engines.push(new JinaEngine(env, timeout));
  }

  const activeEngines = engines.length > 0 ? engines : [new DuckDuckGoEngine(env, timeout)];
  const responses = await Promise.all(activeEngines.map(e => e.execute(v.sanitized)));
  const result = new SearchAggregator(v.sanitized.maxResults).aggregate(v.sanitized.query, responses);
  
  let output = '';
  if (v.sanitized.outputFormat === 'json') output = formatResultsJson(result);
  else if (v.sanitized.outputFormat === 'markdown') output = formatResultsMarkdown(result);
  else output = formatResults(result);
  
  return { content: [{ type: 'text', text: output }] };
}

async function runConnectivityTest(env: Env) {
  const names = ['duckduckgo', 'exa', 'tavily', 'metaso', 'jina'];
  const timeout = 5000;
  const lines = ['🧪 搜索引擎连通性测试 (Live Probe)', '============================================================'];
  
  for (const name of names) {
    const start = Date.now();
    let engine: any;
    if (name === 'duckduckgo') engine = new DuckDuckGoEngine(env, timeout);
    else if (name === 'exa' && env.EXA_API_KEY) engine = new ExaEngine(env, timeout);
    else if (name === 'tavily' && env.TAVILY_API_KEY) engine = new TavilyEngine(env, timeout);
    else if (name === 'metaso' && env.METASO_API_KEY) engine = new MetasoEngine(env, timeout);
    else if (name === 'jina' && env.JINA_API_KEY) engine = new JinaEngine(env, timeout);
    
    if (!engine) {
      lines.push(name.padEnd(12) + ' | ⚪ | ---      | 未配置 Key');
      continue;
    }
    
    try {
      const res = await engine.execute({ query: 'ping', maxResults: 1 });
      const lat = (Date.now() - start) + 'ms';
      const status = res.error ? '❌' : '✅';
      lines.push(name.padEnd(12) + ' | ' + status + ' | ' + lat.padEnd(8) + ' | ' + (res.error || '正常'));
    } catch (e) {
      lines.push(name.padEnd(12) + ' | ❌ | ---      | 连接异常');
    }
  }
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export class UnifiedSearchMCP extends McpAgent<Env> {
  server = new McpServer({ name: "unified-search", version: "1.0.0" });
  async init() {
    this.server.tool('unified_search', '聚合搜索', { query: z.string() }, async (args) => runUnifiedSearch(this.env, args));
    this.server.tool('test_engines_connectivity', '连通性测试', {}, async () => runConnectivityTest(this.env));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': '*' };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/http') {
      if (request.method === 'GET') return new Response('HTTP MCP Active', { headers: cors });
      
      const body = await request.json() as any;
      let res: any;
      
      if (body.method === 'initialize') {
        res = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'search', version: '1.0' } };
      } else if (body.method === 'tools/list') {
        res = { tools: [{ name: 'unified_search', description: '聚合搜索' }, { name: 'test_engines_connectivity', description: '连通性测试' }] };
      } else if (body.method === 'tools/call') {
        if (body.params.name === 'unified_search') res = await runUnifiedSearch(env, body.params.arguments);
        else res = await runConnectivityTest(env);
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: res, id: body.id }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('OK', { headers: cors });
    }

    const id = env.MCP_OBJECT.idFromName('default');
    return env.MCP_OBJECT.get(id).fetch(request);
  }
} as ExportedHandler<Env>;
