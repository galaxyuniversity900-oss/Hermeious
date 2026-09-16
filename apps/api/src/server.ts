import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CapabilityRegistry } from '../../../packages/core/src/registry.js';
import { PolicyEngine } from '../../../packages/core/src/policy.js';
import { CapabilityRouter } from '../../../packages/core/src/router.js';
import { CapabilityPlanner } from '../../../packages/core/src/planner.js';
import { OpenAICompatibleLLM } from '../../../packages/core/src/llm.js';
import { echoCapability, fileMetadataCapability } from '../../../packages/core/src/builtins.js';
import { McpHttpClient } from '../../../packages/mcp/src/client.js';

const registry = new CapabilityRegistry();
registry.register(echoCapability);
registry.register(fileMetadataCapability);
const policy = new PolicyEngine((process.env.MAX_RISK as any) ?? 'medium');
const router = new CapabilityRouter(registry);
const mcpServers = new Map<string, McpHttpClient>();
const port = Number(process.env.PORT ?? 8787);

const llm = process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL
  ? new OpenAICompatibleLLM({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL })
  : undefined;
const planner = llm ? new CapabilityPlanner(llm, router) : undefined;

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function assertMcpUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('MCP URL must use HTTP(S)');
  const allow = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1').split(',').map(v => v.trim()).filter(Boolean);
  if (!allow.includes(url.hostname)) throw new Error(`MCP host not allowed: ${url.hostname}`);
  return url;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'hermeious', planner: Boolean(planner), capabilities: registry.list().length, mcpServers: mcpServers.size });
    }
    if (req.method === 'GET' && url.pathname === '/capabilities') {
      return json(res, 200, { capabilities: registry.list() });
    }
    if (req.method === 'GET' && url.pathname === '/route') {
      return json(res, 200, { candidates: router.route(url.searchParams.get('goal') ?? '') });
    }
    if (req.method === 'GET' && url.pathname === '/mcp/servers') {
      return json(res, 200, { servers: [...mcpServers.keys()] });
    }
    if (req.method === 'POST' && url.pathname === '/mcp/connect') {
      const body = await readJson(req) as { name?: string; url?: string; headers?: Record<string, string> };
      if (!body.name || !body.url) return json(res, 400, { error: 'name and url are required' });
      assertMcpUrl(body.url);
      const client = new McpHttpClient({ name: body.name, url: body.url, headers: body.headers });
      await client.initialize();
      const handlers = await client.toHandlers();
      registry.registerMany(handlers);
      mcpServers.set(body.name, client);
      return json(res, 200, { ok: true, server: body.name, registered: handlers.map(h => h.manifest.id) });
    }
    if (req.method === 'POST' && url.pathname === '/capabilities/execute') {
      const body = await readJson(req) as { capability?: string; input?: Record<string, unknown>; approved?: boolean };
      if (!body.capability) return json(res, 400, { error: 'capability is required' });
      const approved = body.approved === true;
      const decision = policy.check(registry, body.capability, approved);
      if (!decision.allowed) return json(res, 403, { error: decision.reason });
      const result = await registry.execute(body.capability, body.input ?? {}, { requestId: randomUUID(), approved });
      return json(res, 200, { ok: true, result });
    }
    if (req.method === 'POST' && url.pathname === '/plan') {
      if (!planner) return json(res, 503, { error: 'LLM planner is not configured' });
      const body = await readJson(req) as { goal?: string };
      if (!body.goal) return json(res, 400, { error: 'goal is required' });
      return json(res, 200, { ok: true, plan: await planner.plan(body.goal) });
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => console.log(`Hermeious listening on :${port}`));
