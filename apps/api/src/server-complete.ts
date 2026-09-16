import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CapabilityRegistry } from '../../../packages/core/src/registry.js';
import { PolicyEngine } from '../../../packages/core/src/policy.js';
import { CapabilityRouter } from '../../../packages/core/src/router.js';
import { CapabilityPlanner } from '../../../packages/core/src/planner.js';
import { CapabilityComposer, DependencyAwareExecutor, FailureAwareExecutor, defaultCapabilityTemplates, realCapabilities } from '../../../packages/core/src/index.js';
import type { ExecutableCapabilityPlan } from '../../../packages/core/src/index.js';
import { ApprovalManager, ArtifactStore, EventBus, TaskManager } from '../../../packages/core/src/platform/index.js';
import { echoCapability, fileMetadataCapability } from '../../../packages/core/src/builtins.js';
import { OpenAICompatibleLLM } from '../../../packages/providers/src/openai-compatible.js';
import { CapabilityDiscovery, ProviderResolver } from '../../../packages/providers/src/index.js';
import { McpHttpClient } from '../../../packages/mcp/src/client.js';

const registry = new CapabilityRegistry();
registry.register(echoCapability);
registry.register(fileMetadataCapability);
registry.registerMany(realCapabilities);

const maxRisk = (['low', 'medium', 'high', 'critical'] as const).includes((process.env.MAX_RISK ?? '') as never)
  ? process.env.MAX_RISK as 'low' | 'medium' | 'high' | 'critical'
  : 'medium';
const policy = new PolicyEngine(maxRisk);
const router = new CapabilityRouter(registry);
const composer = new CapabilityComposer();
for (const template of defaultCapabilityTemplates) composer.registerTemplate(template);

const concurrency = Number.isFinite(Number(process.env.DAG_CONCURRENCY)) ? Math.max(1, Number(process.env.DAG_CONCURRENCY)) : 4;
const providerResolver = new ProviderResolver();
for (const capability of realCapabilities) {
  if (capability.manifest.provider === 'http') {
    const endpointEnv = capability.manifest.id === 'search.web' ? 'HERMEIOUS_SEARCH_URL' :
      capability.manifest.id === 'code.execute' ? 'HERMEIOUS_CODE_EXECUTOR_URL' :
      capability.manifest.id === 'document.pdf' ? 'HERMEIOUS_PDF_URL' :
      capability.manifest.id === 'document.docx' ? 'HERMEIOUS_DOCX_URL' :
      capability.manifest.id === 'document.xlsx' ? 'HERMEIOUS_XLSX_URL' :
      capability.manifest.id === 'image.generate' ? 'HERMEIOUS_IMAGE_URL' : 'HERMEIOUS_VIDEO_URL';
    const endpoint = process.env[endpointEnv];
    if (endpoint) providerResolver.register({ providerId: `env:${endpointEnv}`, logicalCapability: capability.manifest.id, capabilityId: capability.manifest.id, kind: 'http', endpoint, qualityScore: 0.7, costScore: 0.5 });
  } else {
    providerResolver.register({ providerId: 'local', logicalCapability: capability.manifest.id, capabilityId: capability.manifest.id, kind: 'local', qualityScore: 0.9, costScore: 0.1 });
  }
}

const dagExecutor = new DependencyAwareExecutor(registry, policy, concurrency);
const resilientExecutor = new FailureAwareExecutor(
  registry,
  policy,
  ({ capability }) => providerResolver.resolve(capability).map(candidate => candidate.capabilityId),
  concurrency,
  Math.max(0, Number(process.env.MAX_REPLANS ?? 2))
);
const approvals = new ApprovalManager();
const artifacts = new ArtifactStore();
const eventBus = new EventBus();
const tasks = new TaskManager(resilientExecutor, approvals, artifacts, eventBus);
const discovery = new CapabilityDiscovery();
const mcpServers = new Map<string, McpHttpClient>();

const llm = process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL
  ? new OpenAICompatibleLLM({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL })
  : undefined;
const planner = llm ? new CapabilityPlanner(llm, router) : undefined;
const port = Number(process.env.PORT ?? 8787);

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  const limit = Number(process.env.MAX_BODY_BYTES ?? 2_000_000);
  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    size += part.length;
    if (size > limit) throw new Error('request_body_too_large');
    chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function assertMcpUrl(raw: string): void {
  const u = new URL(raw);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('MCP URL must use HTTP(S)');
  const allow = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1').split(',').map(s => s.trim()).filter(Boolean);
  if (!allow.includes(u.hostname)) throw new Error(`MCP host not allowed: ${u.hostname}`);
}

function page(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hermeious</title><style>body{margin:0;font:14px system-ui;background:#08101d;color:#e8eef8}main{max-width:1200px;margin:auto;padding:20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.card{background:#101a2b;border:1px solid #26354d;border-radius:14px;padding:16px}.muted{color:#94a3b8}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#1c2a41;margin:2px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}button{background:#dbe7ff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}pre{white-space:pre-wrap;max-height:420px;overflow:auto;background:#091221;padding:12px;border-radius:10px}input,textarea{width:100%;box-sizing:border-box;background:#0a1322;color:#e8eef8;border:1px solid #2b3a53;border-radius:8px;padding:9px}</style></head><body><main><h1>Hermeious Control Plane</h1><p class="muted">Any LLM + composable capabilities + provider routing + resilient execution</p><div class="grid"><section class="card"><h2>Run goal</h2><textarea id="goal" rows="5" placeholder="Create a report about ..."></textarea><div class="row" style="margin-top:8px"><button onclick="compose()">Compose</button><button onclick="refresh()">Refresh</button></div><pre id="plan">No plan yet.</pre></section><section class="card"><h2>System</h2><pre id="health">Loading…</pre></section><section class="card"><h2>Tasks</h2><div id="tasks">Loading…</div></section><section class="card"><h2>Events</h2><pre id="events">Select a task.</pre></section></div><script>let es=null;const $=id=>document.getElementById(id);async function api(p,o){const r=await fetch(p,o);return r.json()}async function refresh(){ $("health").textContent=JSON.stringify(await api("/health"),null,2);const t=await api("/tasks");$("tasks").innerHTML=t.tasks.map(x=>'<div style="margin:8px 0"><b>'+x.goal+'</b><br><span class="pill">'+x.status+'</span> <button onclick="watch(\\''+x.id+'\\')">Watch</button>'+(x.status==='paused'?'<button onclick="approve(\\''+x.id+'\\')">Approve</button>':'')+'</div>').join('')||'No tasks'}async function compose(){const goal=$("goal").value.trim();if(!goal)return;const r=await api('/composer/compose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal})});$("plan").textContent=JSON.stringify(r,null,2);if(r.plan){const t=await api('/tasks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({plan:r.plan})});$("plan").textContent+='\\n\\nTask:\\n'+JSON.stringify(t,null,2);refresh()}}async function approve(id){await api('/tasks/'+id+'/approve',{method:'POST'});watch(id);refresh()}function watch(id){if(es)es.close();$("events").textContent='';es=new EventSource('/tasks/'+id+'/events');es.onmessage=e=>{$("events").textContent+=e.data+'\\n';refresh()}}refresh();</script></main></body></html>`;
}

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET';
    const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization' }); return res.end(); }
    if (method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }
    if (method === 'GET' && u.pathname === '/health') return json(res, 200, { ok: true, service: 'hermeious', planner: Boolean(planner), capabilities: registry.list().length, providers: providerResolver.list().length, mcpServers: mcpServers.size, discoveryCandidates: discovery.list().length, templates: composer.listTemplates().length, tasks: tasks.list().length, approvals: approvals.list().length, artifacts: artifacts.list().length, resilientExecutor: true });
    if (method === 'GET' && u.pathname === '/capabilities') return json(res, 200, { capabilities: registry.list() });
    if (method === 'GET' && u.pathname === '/providers') return json(res, 200, { providers: providerResolver.list() });
    if (method === 'GET' && u.pathname === '/providers/resolve') return json(res, 200, { candidates: providerResolver.resolve(u.searchParams.get('capability') ?? '') });
    if (method === 'GET' && u.pathname === '/providers/performance') return json(res, 200, { performance: providerResolver.performance.snapshot() });
    if (method === 'GET' && u.pathname === '/mcp/servers') return json(res, 200, { servers: [...mcpServers.keys()] });
    if (method === 'GET' && u.pathname === '/discovery') return json(res, 200, { candidates: discovery.list() });
    if (method === 'GET' && u.pathname === '/composer/templates') return json(res, 200, { templates: composer.listTemplates() });
    if (method === 'GET' && u.pathname === '/approvals') return json(res, 200, { approvals: approvals.list() });
    if (method === 'GET' && u.pathname === '/artifacts') return json(res, 200, { artifacts: artifacts.list() });
    if (method === 'GET' && u.pathname === '/tasks') return json(res, 200, { tasks: tasks.list() });
    if (method === 'GET' && /^\/tasks\/[^/]+\/events$/.test(u.pathname)) {
      const id = u.pathname.split('/')[2];
      if (!tasks.get(id)) return json(res, 404, { error: 'task_not_found' });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      for (const event of tasks.events(id)) res.write(`data: ${JSON.stringify(event)}\\n\\n`);
      const unsubscribe = tasks.subscribe(id, event => res.write(`data: ${JSON.stringify(event)}\\n\\n`));
      const heartbeat = setInterval(() => res.write(': ping\\n\\n'), 15000);
      req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
      return;
    }
    if (method === 'GET' && /^\/tasks\/[^/]+$/.test(u.pathname)) {
      const id = u.pathname.split('/')[2];
      const task = tasks.get(id);
      return task ? json(res, 200, { task, events: tasks.events(id), artifacts: tasks.artifactsFor(id) }) : json(res, 404, { error: 'task_not_found' });
    }
    if (method === 'GET' && /^\/artifacts\/[^/]+$/.test(u.pathname)) {
      const id = u.pathname.split('/')[2];
      const artifact = artifacts.get(id);
      return artifact ? json(res, 200, { artifact }) : json(res, 404, { error: 'artifact_not_found' });
    }
    if (method === 'POST' && u.pathname === '/tasks') {
      const b = await body(req) as { plan?: ExecutableCapabilityPlan; approved?: boolean };
      if (!b.plan?.steps?.length) return json(res, 400, { error: 'plan with steps is required' });
      return json(res, 202, { ok: true, task: tasks.create(b.plan, b.approved === true) });
    }
    if (method === 'POST' && /^\/tasks\/[^/]+\/(approve|cancel|reject)$/.test(u.pathname)) {
      const [_, id, action] = u.pathname.split('/');
      if (action === 'approve') return json(res, 202, { ok: true, task: await tasks.approve(id) });
      if (action === 'reject') return json(res, 200, { ok: true, task: tasks.reject(id) });
      return json(res, 200, { ok: true, task: tasks.cancel(id) });
    }
    if (method === 'POST' && u.pathname === '/composer/compose') {
      const b = await body(req) as { goal?: string; requirements?: Array<{ capability: string; requiredInputs?: string[]; expectedOutputs?: string[] }>; templateId?: string };
      if (!b.goal?.trim()) return json(res, 400, { error: 'goal is required' });
      const plan = composer.compose(b.goal, b.requirements ?? [], b.templateId);
      return json(res, 200, { ok: true, plan, executionOrder: composer.topologicalOrder(plan).map(s => s.id) });
    }
    if (method === 'POST' && u.pathname === '/composer/execute') {
      const b = await body(req) as { plan?: ExecutableCapabilityPlan; approved?: boolean; resilient?: boolean };
      if (!b.plan?.steps?.length) return json(res, 400, { error: 'plan with steps is required' });
      const result = b.resilient === false ? await dagExecutor.execute(b.plan, b.approved === true) : await resilientExecutor.execute(b.plan, b.approved === true);
      return json(res, result.ok ? 200 : 502, result);
    }
    if (method === 'POST' && u.pathname === '/mcp/connect') {
      const b = await body(req) as { name?: string; url?: string; headers?: Record<string, string> };
      if (!b.name || !b.url) return json(res, 400, { error: 'name and url are required' });
      assertMcpUrl(b.url);
      const client = new McpHttpClient({ name: b.name, url: b.url, headers: b.headers });
      await client.initialize();
      const handlers = await client.toHandlers();
      registry.registerMany(handlers);
      for (const h of handlers) providerResolver.register({ providerId: `mcp:${b.name}`, logicalCapability: h.manifest.id, capabilityId: h.manifest.id, kind: 'mcp', endpoint: b.url, qualityScore: 0.75, costScore: 0.25 });
      mcpServers.set(b.name, client);
      return json(res, 200, { ok: true, server: b.name, registered: handlers.map(h => h.manifest.id) });
    }
    if (method === 'POST' && u.pathname === '/providers/register') { const b = await body(req); providerResolver.register(b); return json(res, 200, { ok: true, providers: providerResolver.list(b.logicalCapability) }); }
    if (method === 'POST' && u.pathname === '/discovery/register') { const b = await body(req); const candidate = CapabilityDiscovery.fromManifest(b.manifest ?? b, b.source ?? 'api', b.trust ?? 'review'); discovery.register(candidate); if (candidate.trust === 'trusted') providerResolver.register(candidate.provider); return json(res, 200, { ok: true, candidate }); }
    if (method === 'POST' && u.pathname === '/discovery/trust') { const b = await body(req) as { providerId?: string; capability?: string }; if (!b.providerId || !b.capability) return json(res, 400, { error: 'providerId and capability are required' }); discovery.trust(b.providerId, b.capability); return json(res, 200, { ok: true, candidates: discovery.discover(b.capability) }); }
    if (method === 'POST' && u.pathname === '/plan') {
      if (!planner) return json(res, 503, { error: 'planner_not_configured' });
      const b = await body(req) as { goal?: string };
      if (!b.goal?.trim()) return json(res, 400, { error: 'goal is required' });
      return json(res, 200, { ok: true, plan: await planner.plan(b.goal) });
    }
    if (method === 'GET' && u.pathname === '/route') return json(res, 200, { candidates: router.route(u.searchParams.get('goal') ?? '') });
    if (method === 'POST' && u.pathname === '/capabilities/execute') {
      const b = await body(req) as { capability?: string; input?: Record<string, unknown>; approved?: boolean };
      if (!b.capability) return json(res, 400, { error: 'capability is required' });
      const decision = policy.check(registry, b.capability, b.approved === true);
      if (!decision.allowed) return json(res, 403, { error: decision.reason });
      return json(res, 200, { ok: true, result: await registry.execute(b.capability, b.input ?? {}, { requestId: randomUUID(), approved: b.approved === true }) });
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'request_body_too_large' ? 413 : 400;
    return json(res, status, { error: message });
  }
});

server.listen(port, () => console.log(`Hermeious Control Plane listening on http://localhost:${port}`));
