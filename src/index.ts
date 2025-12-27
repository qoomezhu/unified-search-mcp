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
