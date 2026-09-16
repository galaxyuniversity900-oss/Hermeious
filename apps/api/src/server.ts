import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CapabilityRegistry } from '../../../packages/core/src/registry.js';
import { PolicyEngine } from '../../../packages/core/src/policy.js';
import { echoCapability, fileMetadataCapability } from '../../../packages/core/src/builtin.js';

const registry = new CapabilityRegistry();
registry.register(echoCapability);
registry.register(fileMetadataCapability);
const policy = new PolicyEngine('medium');
const port = Number(process.env.PORT ?? 8787);

function json(res: any, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, service: 'hermeious' });
    if (req.method === 'GET' && req.url === '/capabilities') return json(res, 200, { capabilities: registry.list() });
    if (req.method === 'POST' && req.url === '/execute') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const id = body.capability;
      const input = body.input ?? {};
      const approved = body.approved === true;
      const decision = policy.check(registry, id, approved);
      if (!decision.allowed) return json(res, 403, { ok: false, ...decision });
      const result = await registry.execute(id, input, { requestId: randomUUID(), approved });
      return json(res, 200, { ok: true, capability: id, result });
    }
    return json(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    return json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => console.log(`Hermeious runtime listening on :${port}`));
