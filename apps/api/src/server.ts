import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CapabilityRegistry } from '../../../packages/core/src/registry.js';
import { PolicyEngine } from '../../../packages/core/src/policy.js';
import { CapabilityRouter } from '../../../packages/core/src/router.js';
import { CapabilityPlanner } from '../../../packages/core/src/planner.js';
import { CapabilityExecutor } from '../../../packages/core/src/executor.js';
import { CapabilityComposer, DependencyAwareExecutor, FailureAwareExecutor, defaultCapabilityTemplates, realCapabilities } from '../../../packages/core/src/index.js';
import type { ExecutableCapabilityPlan } from '../../../packages/core/src/index.js';
import { ApprovalManager, ArtifactStore, EventBus, TaskManager } from '../../../packages/core/src/platform/index.js';
import { echoCapability, fileMetadataCapability } from '../../../packages/core/src/builtins.js';
import { OpenAICompatibleLLM } from '../../../packages/providers/src/openai-compatible.js';
import { CapabilityDiscovery, FallbackExecutor, ProviderResolver } from '../../../packages/providers/src/index.js';
import { McpHttpClient } from '../../../packages/mcp/src/client.js';

const registry = new CapabilityRegistry();
registry.register(echoCapability);
registry.register(fileMetadataCapability);
registry.registerMany(realCapabilities);
const maxRisk = ['low', 'medium', 'high', 'critical'].includes(process.env.MAX_RISK ?? '') ? process.env.MAX_RISK as 'low' | 'medium' | 'high' | 'critical' : 'medium';
const policy = new PolicyEngine(maxRisk);
const router = new CapabilityRouter(registry);
const executor = new CapabilityExecutor(registry, policy);
const composer = new CapabilityComposer();
for (const template of defaultCapabilityTemplates) composer.registerTemplate(template);
const dagExecutor = new DependencyAwareExecutor(registry, policy, Number(process.env.DAG_CONCURRENCY ?? 4));
const providerResolver = new ProviderResolver();
for (const capability of realCapabilities) {
  if (capability.manifest.provider === 'http') {
    const endpointEnv = capability.manifest.id === 'search.web' ? 'HERMEIOUS_SEARCH_URL' :
      capability.manifest.id === 'code.execute' ? 'HERMEIOUS_CODE_EXECUTOR_URL' :
      capability.manifest.id === 'document.pdf' ? 'HERMEIOUS_PDF_URL' :
      capability.manifest.id === 'document.docx' ? 'HERMEIOUS_DOCX_URL' :
      capability.manifest.id === 'document.xlsx' ? 'HERMEIOUS_XLSX_URL' :
      capability.manifest.id === 'image.generate' ? 'HERMEIOUS_IMAGE_URL' : 'HERMEIOUS_VIDEO_URL';
    if (process.env[endpointEnv]) providerResolver.register({ providerId: `env:${endpointEnv}`, logicalCapability: capability.manifest.id, capabilityId: capability.manifest.id, kind: 'http', endpoint: process.env[endpointEnv], qualityScore: 0.7, costScore: 0.5 });
  } else {
    providerResolver.register({ providerId: 'local', logicalCapability: capability.manifest.id, capabilityId: capability.manifest.id, kind: 'local', qualityScore: 0.9, costScore: 0.1 });
  }
}
const fallbackExecutor = new FallbackExecutor(providerResolver);
const resilientExecutor = new FailureAwareExecutor(
  registry,
  policy,
  ({ capability }) => providerResolver.resolve(capability).map(candidate => candidate.capabilityId),
  Number(process.env.DAG_CONCURRENCY ?? 4),
  Number(process.env.MAX_REPLANS ?? 2)
);
const discovery = new CapabilityDiscovery();
const mcpServers = new Map<string, McpHttpClient>();
const approvals = new ApprovalManager();
const artifacts = new ArtifactStore();
const eventBus = new EventBus();
const taskManager = new TaskManager(dagExecutor, approvals, artifacts, eventBus);
const port = Number(process.env.PORT ?? 8787);

const llm = process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL
  ? new OpenAICompatibleLLM({ baseUrl: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL })
  : undefined;
const planner = llm ? new CapabilityPlanner(llm, router) : undefined;

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readJson(req: import('node:http').IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function assertMcpUrl(raw: string): void {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('MCP URL must use HTTP(S)');
  const allow = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1').split(',').map(v => v.trim()).filter(Boolean);
  if (!allow.includes(url.hostname)) throw new Error(`MCP host not allowed: ${url.hostname}`);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hermeious Control Plane</title><style>body{font:15px system-ui;margin:0;background:#0b1020;color:#e8edf7}main{max-width:1100px;margin:auto;padding:24px}button{padding:9px 14px;border:0;border-radius:8px;cursor:pointer}pre{background:#11182b;padding:14px;border-radius:10px;overflow:auto}.card{background:#11182b;border:1px solid #25304a;padding:16px;border-radius:12px;margin:12px 0}.ok{color:#78e08f}.muted{color:#9aa8c0}</style></head><body><main><h1>Hermeious Control Plane</h1><p class="muted">Capability orchestration · approvals · tasks · live events · artifacts</p><div class="card"><button onclick="load()">Refresh</button> <button onclick="loadApprovals()">Approvals</button> <button onclick="loadArtifacts()">Artifacts</button></div><div class="card"><h2>Tasks</h2><div id="tasks">Loading…</div></div><div class="card"><h2>Live event stream</h2><pre id="events">Select a task to stream events.</pre></div><script>let es;async function api(p,o){const r=await fetch(p,o);return r.json()}async function load(){const x=await api('/tasks');document.querySelector('#tasks').innerHTML=x.tasks.map(t=>'<div style="margin:10px 0"><b>'+t.goal+'</b> — '+t.status+' <button onclick="watch(\\''+t.id+'\\')">Watch</button>'+(t.status==='paused'?'<button onclick="approve(\\''+t.id+'\\')">Approve</button>':'')+'</div>').join('')||'No tasks'}async function approve(id){await api('/tasks/'+id+'/approve',{method:'POST'});load();watch(id)}async function watch(id){if(es)es.close();document.querySelector('#events').textContent='';es=new EventSource('/tasks/'+id+'/events');es.onmessage=e=>{document.querySelector('#events').textContent+=e.data+'\\n';load()}}async function loadApprovals(){document.querySelector('#events').textContent=JSON.stringify(await api('/approvals'),null,2)}async function loadArtifacts(){document.querySelector('#events').textContent=JSON.stringify(await api('/artifacts'),null,2)}load();</script></main></body></html>`);
    }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'hermeious', planner: Boolean(planner), capabilities: registry.list().length, mcpServers: mcpServers.size, providers: providerResolver.list().length, discoveryCandidates: discovery.list().length, templates: composer.listTemplates().length, tasks: taskManager.list().length, approvals: approvals.list().length, artifacts: artifacts.list().length, dagExecutor: true, resilientExecutor: true, realCapabilities: realCapabilities.map(c => c.manifest.id) });
    if (req.method === 'GET' && url.pathname === '/capabilities') return json(res, 200, { capabilities: registry.list() });
    if (req.method === 'GET' && url.pathname === '/route') return json(res, 200, { candidates: router.route(url.searchParams.get('goal') ?? '') });
    if (req.method === 'GET' && url.pathname === '/mcp/servers') return json(res, 200, { servers: [...mcpServers.keys()] });
    if (req.method === 'GET' && url.pathname === '/providers') return json(res, 200, { providers: providerResolver.list() });
    if (req.method === 'GET' && url.pathname === '/providers/resolve') return json(res, 200, { candidates: providerResolver.resolve(url.searchParams.get('capability') ?? '') });
    if (req.method === 'GET' && url.pathname === '/providers/performance') return json(res, 200, { performance: providerResolver.performance.snapshot() });
    if (req.method === 'GET' && url.pathname === '/discovery') return json(res, 200, { candidates: discovery.list() });
    if (req.method === 'GET' && url.pathname === '/composer/templates') return json(res, 200, { templates: composer.listTemplates() });
    if (req.method === 'GET' && url.pathname === '/tasks') return json(res, 200, { tasks: taskManager.list() });
    if (req.method === 'GET' && url.pathname.startsWith('/tasks/') && url.pathname.endsWith('/events')) {
      const taskId = url.pathname.split('/')[2];
      if (!taskManager.get(taskId)) return json(res, 404, { error: 'task_not_found' });
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (const event of taskManager.events(taskId)) res.write(`data: ${JSON.stringify(event)}\\n\\n`);
      const unsubscribe = taskManager.subscribe(taskId, event => res.write(`data: ${JSON.stringify(event)}\\n\\n`));
      const heartbeat = setInterval(() => res.write(': ping\\n\\n'), 15000);
      req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/tasks/')) {
      const task = taskManager.get(url.pathname.split('/')[2]);
      return task ? json(res, 200, { task, events: taskManager.events(task.id), artifacts: taskManager.artifactsFor(task.id) }) : json(res, 404, { error: 'task_not_found' });
    }
    if (req.method === 'GET' && url.pathname === '/approvals') return json(res, 200, { approvals: approvals.list() });
    if (req.method === 'GET' && url.pathname === '/artifacts') return json(res, 200, { artifacts: artifacts.list() });
    if (req.method === 'GET' && url.pathname.startsWith('/artifacts/')) {
      const artifact = artifacts.get(url.pathname.split('/')[2]);
      return artifact ? json(res, 200, { artifact }) : json(res, 404, { error: 'artifact_not_found' });
    }

    if (req.method === 'POST' && url.pathname === '/tasks') {
      const body = await readJson(req) as { plan?: ExecutableCapabilityPlan; approved?: boolean };
      if (!body.plan || !Array.isArray(body.plan.steps)) return json(res, 400, { error: 'plan with steps is required' });
      return json(res, 202, { ok: true, task: taskManager.create(body.plan, body.approved === true) });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/tasks/') && url.pathname.endsWith('/approve')) {
      const id = url.pathname.split('/')[2];
      return json(res, 202, { ok: true, task: await taskManager.approve(id) });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/tasks/') && url.pathname.endsWith('/cancel')) {
      const id = url.pathname.split('/')[2];
      return json(res, 200, { ok: true, task: taskManager.cancel(id) });
    }
    if (req.method === 'POST' && url.pathname === '/composer/compose') {
      const body = await readJson(req) as { goal?: string; requirements?: Array<{ capability: string; requiredInputs?: string[]; expectedOutputs?: string[] }>; templateId?: string };
      if (!body.goal) return json(res, 400, { error: 'goal is required' });
      const plan = composer.compose(body.goal, body.requirements ?? [], body.templateId);
      return json(res, 200, { ok: true, plan, executionOrder: composer.topologicalOrder(plan).map(step => step.id) });
    }
    if (req.method === 'POST' && url.pathname === '/composer/execute') {
      const body = await readJson(req) as { plan?: ExecutableCapabilityPlan; approved?: boolean; resilient?: boolean };
      if (!body.plan || !Array.isArray(body.plan.steps)) return json(res, 400, { error: 'plan with steps is required' });
      const result = body.resilient === false ? await dagExecutor.execute(body.plan, body.approved === true) : await resilientExecutor.execute(body.plan, body.approved === true);
      return json(res, result.ok ? 200 : 502, result);
    }
    if (req.method === 'POST' && url.pathname === '/mcp/connect') {
      const body = await readJson(req) as { name?: string; url?: string; headers?: Record<string, string> };
      if (!body.name || !body.url) return json(res, 400, { error: 'name and url are required' });
      assertMcpUrl(body.url);
      const client = new McpHttpClient({ name: body.name, url: body.url, headers: body.headers });
      await client.initialize();
      const handlers = await client.toHandlers();
      registry.registerMany(handlers);
      for (const handler of handlers) providerResolver.register({ providerId: `mcp:${body.name}`, logicalCapability: handler.manifest.id, capabilityId: handler.manifest.id, kind: 'mcp', endpoint: body.url, qualityScore: 0.75, costScore: 0.25 });
      mcpServers.set(body.name, client);
      return json(res, 200, { ok: true, server: body.name, registered: handlers.map(handler => handler.manifest.id) });
    }
    if (req.method === 'POST' && url.pathname === '/providers/register') {
      const body = await readJson(req);
      if (!body.providerId || !body.logicalCapability || !body.capabilityId || !body.kind) return json(res, 400, { error: 'providerId, logicalCapability, capabilityId and kind are required' });
      providerResolver.register(body);
      return json(res, 200, { ok: true, providers: providerResolver.list(body.logicalCapability) });
    }
    if (req.method === 'POST' && url.pathname === '/discovery/register') {
      const body = await readJson(req);
      const candidate = CapabilityDiscovery.fromManifest(body.manifest ?? body, body.source ?? 'api', body.trust ?? 'review');
      discovery.register(candidate);
      if (candidate.trust === 'trusted') providerResolver.register(candidate.provider);
      return json(res, 200, { ok: true, candidate });
    }
    if (req.method === 'POST' && url.pathname === '/discovery/trust') {
      const body = await readJson(req) as { providerId?: string; capability?: string };
      if (!body.providerId || !body.capability) return json(res, 400, { error: 'providerId and capability are required' });
      discovery.trust(body.providerId, body.capability);
      const candidate = discovery.discover(body.capability).find(item => item.provider.providerId === body.providerId);
      if (candidate) providerResolver.register(candidate.provider);
      return json(res, 200, { ok: true, candidate });
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
    if (req.method === 'POST' && url.pathname === '/capabilities/execute-logical') {
      const body = await readJson(req) as { capability?: string; input?: Record<string, unknown>; approved?: boolean };
      if (!body.capability) return json(res, 400, { error: 'capability is required' });
      const approved = body.approved === true;
      const result = await fallbackExecutor.execute(body.capability, body.input ?? {}, async (capabilityId, input) => {
        const decision = policy.check(registry, capabilityId, approved);
        if (!decision.allowed) throw new Error(decision.reason);
        return registry.execute(capabilityId, input, { requestId: randomUUID(), approved });
      });
      return json(res, result.ok ? 200 : 502, result);
    }
    if (req.method === 'POST' && url.pathname === '/plan') {
      if (!planner) return json(res, 503, { error: 'LLM planner is not configured' });
      const body = await readJson(req) as { goal?: string };
      if (!body.goal) return json(res, 400, { error: 'goal is required' });
      return json(res, 200, { ok: true, plan: await planner.plan(body.goal) });
    }
    if (req.method === 'POST' && url.pathname === '/execute-plan') {
      const body = await readJson(req) as { plan?: { goal: string; steps: Array<{ capability: string; input: Record<string, unknown>; reason?: string; approved?: boolean }> }; approved?: boolean };
      if (!body.plan || !Array.isArray(body.plan.steps)) return json(res, 400, { error: 'plan with steps is required' });
      const results = await executor.executePlan(body.plan, body.approved === true);
      return json(res, 200, { ok: results.every(result => result.ok), goal: body.plan.goal, results });
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});
server.listen(port, () => console.log(`Hermeious listening on :${port}`));