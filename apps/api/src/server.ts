import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CapabilityRegistry } from '../../../packages/core/src/registry.js';
import { PolicyEngine } from '../../../packages/core/src/policy.js';
import { echoCapability, fileMetadataCapability } from '../../../packages/core/src/builtins.js';

const registry = new CapabilityRegistry();
registry.register(echoCapability);
registry.register(fileMetadataCapability);
const policy = new PolicyEngine('medium');
const port = Number(process.env.PORT ?? 8787);

function json(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'hermeious' });
    if (req.method === 'GET' && url.pathname === '/capabilities') return json(res, 200, { capabilities: registry.list() });
    if (req.method === 'POST' && url.pathname === '/capabilities/execute') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { capability?: string; input?: Record<string, unknown>; approved?: boolean };
      if (!body.capability) return json(res, 400, { error: 'capability is required' });
      const approved = body.approved === true;
      const decision = policy.check(registry, body.capability, approved);
      if (!decision.allowed) return json(res, 403, { error: decision.reason });
      const result = await registry.execute(body.capability, body.input ?? {}, { requestId: randomUUID(), approved });
      return json(res, 200, { ok: true, result });
    }
    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => console.log(`Hermeious listening on :${port}`));
