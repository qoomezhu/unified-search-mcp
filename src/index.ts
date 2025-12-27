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

async function runUnifiedSearch(env: Env, args: any): Promise<any> {
  const v = validateSearchParams(args);
  if (!v.valid) {
    return { content: [{ type: 'text', text: 'Error: ' + v.error }] };
  }
  
  const timeout = parseInt(env.DEFAULT_TIMEOUT || '8000');
  const engineNames = v.sanitized.engines.length > 0 ? v.sanitized.engines : ['duckduckgo'];
  const engines: SearchEngine[] = [];
  
  for (let i = 0; i < engineNames.length; i++) {
    const n = String(engineNames[i]).toLowerCase();
    if (n === 'duckduckgo') engines.push(new DuckDuckGoEngine(env, timeout));
    if (n === 'searxng' && env.SEARXNG_URL) engines.push(new SearXNGEngine(env, timeout));
    if (n === 'exa' && env.EXA_API_KEY) engines.push(new ExaEngine(env, timeout));
    if (n === 'tavily' && env.TAVILY_API_KEY) engines.push(new TavilyEngine(env, timeout));
    if (n === 'metaso' && env.METASO_API_KEY) engines.push(new MetasoEngine(env, timeout));
    if (n === 'jina' && env.JINA_API_KEY) engines.push(new JinaEngine(env, timeout));
  }

  if (engines.length === 0) {
    engines.push(new DuckDuckGoEngine(env, timeout));
  }

  const responses = await Promise.all(engines.map(function(e) { return e.execute(v.sanitized); }));
  const result = new SearchAggregator(v.sanitized.maxResults).aggregate(v.sanitized.query, responses);
  
  let output = '';
  if (v.sanitized.outputFormat === 'json') {
    output = formatResultsJson(result);
  } else if (v.sanitized.outputFormat === 'markdown') {
    output = formatResultsMarkdown(result);
  } else {
    output = formatResults(result);
  }
  
  return { content: [{ type: 'text', text: output }] };
}

async function runConnectivityTest(env: Env): Promise<any> {
  const names = ['duckduckgo', 'exa', 'tavily', 'metaso', 'jina'];
  const timeout = 5000;
  const lines: string[] = [];
  lines.push('搜索引擎连通性测试');
  lines.push('============================================================');
  
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const start = Date.now();
    let engine: any = null;
    
    if (name === 'duckduckgo') engine = new DuckDuckGoEngine(env, timeout);
    if (name === 'exa' && env.EXA_API_KEY) engine = new ExaEngine(env, timeout);
    if (name === 'tavily' && env.TAVILY_API_KEY) engine = new TavilyEngine(env, timeout);
    if (name === 'metaso' && env.METASO_API_KEY) engine = new MetasoEngine(env, timeout);
    if (name === 'jina' && env.JINA_API_KEY) engine = new JinaEngine(env, timeout);
    
    if (engine === null) {
      lines.push(name + ' | SKIP | 未配置');
      continue;
    }
    
    try {
      const res = await engine.execute({ query: 'test', maxResults: 1 });
      const lat = Date.now() - start;
      if (res.error) {
        lines.push(name + ' | FAIL | ' + lat + 'ms | ' + res.error);
      } else {
        lines.push(name + ' | OK | ' + lat + 'ms');
      }
    } catch (e) {
      lines.push(name + ' | FAIL | 连接异常');
    }
  }
  
  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

export class UnifiedSearchMCP extends McpAgent<Env> {
  server = new McpServer({ name: "unified-search", version: "1.0.0" });
  
  async init(): Promise<void> {
    this.server.tool('unified_search', '聚合搜索', { query: z.string() }, async function(args) {
      return runUnifiedSearch(this.env, args);
    }.bind(this));
    
    this.server.tool('test_engines_connectivity', '连通性测试', {}, async function() {
      return runConnectivityTest(this.env);
    }.bind(this));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/http') {
      if (request.method === 'GET') {
        return new Response('MCP HTTP Active', { headers: corsHeaders });
      }
      
      const body = await request.json() as any;
      let res: any = {};
      
      if (body.method === 'initialize') {
        res = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'unified-search', version: '1.0' }
        };
      } else if (body.method === 'tools/list') {
        res = {
          tools: [
            { name: 'unified_search', description: '聚合搜索' },
            { name: 'test_engines_connectivity', description: '连通性测试' }
          ]
        };
      } else if (body.method === 'tools/call') {
        const toolName = body.params.name;
        const toolArgs = body.params.arguments || {};
        if (toolName === 'unified_search') {
          res = await runUnifiedSearch(env, toolArgs);
        } else {
          res = await runConnectivityTest(env);
        }
      }
      
      const responseBody = JSON.stringify({ jsonrpc: '2.0', result: res, id: body.id });
      return new Response(responseBody, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('OK', { headers: corsHeaders });
    }

    const objId = env.MCP_OBJECT.idFromName('default');
    const stub = env.MCP_OBJECT.get(objId);
    return stub.fetch(request);
  }
} as ExportedHandler<Env>;
