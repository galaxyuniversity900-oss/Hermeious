import type { CapabilityContext, CapabilityHandler, CapabilityManifest } from '../../core/src/types.js';

interface JsonRpcResponse { id?: number; result?: any; error?: { code: number; message: string; data?: unknown }; }

export interface McpServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function extractPayload(text: string): any {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLine = trimmed.split(/\r?\n/).find(line => line.startsWith('data:'));
  if (dataLine) return JSON.parse(dataLine.slice(5).trim());
  throw new Error('Unsupported MCP response format');
}

export class McpHttpClient {
  private nextId = 1;
  private sessionId?: string;

  constructor(private readonly config: McpServerConfig) {}

  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);
    try {
      const headers: Record<string, string> = {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...(this.config.headers ?? {})
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      const response = await fetch(this.config.url, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
      });
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${await response.text()}`);
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      const payload = extractPayload(await response.text()) as JsonRpcResponse;
      if (payload?.error) throw new Error(`MCP ${payload.error.code}: ${payload.error.message}`);
      return payload?.result;
    } finally { clearTimeout(timer); }
  }

  async initialize(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'hermeious', version: '0.1.0' }
    });
    await this.rpc('notifications/initialized', {});
  }

  async listTools(): Promise<any[]> {
    const result = await this.rpc('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<unknown> {
    const result = await this.rpc('tools/call', { name, arguments: arguments_ });
    return result;
  }

  async toHandlers(): Promise<CapabilityHandler[]> {
    const tools = await this.listTools();
    return tools.map((tool: any): CapabilityHandler => {
      const id = `mcp.${this.config.name}.${String(tool.name)}`;
      const manifest: CapabilityManifest = {
        id, version: '1.0.0', provider: `mcp:${this.config.name}`,
        description: String(tool.description ?? `MCP tool ${tool.name}`),
        interfaces: ['mcp'], inputSchema: tool.inputSchema ?? { type: 'object' },
        outputSchema: { type: 'object' }, permissions: ['mcp.call'], risk: 'medium',
        tags: ['mcp', this.config.name]
      };
      return {
        manifest,
        async execute(input: Record<string, unknown>, _context: CapabilityContext) {
          return this.callTool(String(tool.name), input);
        }
      };
    });
  }
}
