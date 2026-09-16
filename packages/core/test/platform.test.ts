import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtifactStore } from '../src/platform/artifacts.js';
import { ApprovalManager } from '../src/platform/approvals.js';
import { CostController } from '../src/platform/cost.js';
import { validateQuality, rules } from '../src/platform/validation.js';
import { PluginRegistry } from '../src/platform/plugins.js';
import { assertSafeProviderUrl } from '../src/platform/security.js';

test('artifact lifecycle versions outputs', () => {
  const store = new ArtifactStore();
  const a = store.create({ name: 'report.pdf', kind: 'file', mimeType: 'application/pdf', uri: 'workspace://report.pdf', metadata: {} });
  const b = store.version(a.id, { metadata: { pages: 10 } });
  assert.equal(b.version, 2);
  assert.equal(store.list().length, 1);
});

test('approval manager gates decisions', () => {
  const approvals = new ApprovalManager();
  approvals.request({ id: 'a1', taskId: 't1', action: 'paid.video.generate', risk: 'high', reason: 'paid provider' });
  assert.equal(approvals.status('a1'), 'pending');
  approvals.decide('a1', 'approved');
  assert.equal(approvals.status('a1'), 'approved');
});

test('cost controller enforces budgets', () => {
  const c = new CostController({ maxCost: 2, maxLatencyMs: 1000 });
  assert.equal(c.canSpend({ cost: 1, latencyMs: 500 }), true);
  assert.equal(c.canSpend({ cost: 3, latencyMs: 500 }), false);
});

test('quality validation reports missing output', () => {
  const report = validateQuality({ title: 'ok' }, [rules.requiredKeys(['title', 'body'])]);
  assert.equal(report.ok, false);
  assert.equal(report.failures.length, 1);
});

test('plugin registry prevents duplicate capability ids', () => {
  const registry = new PluginRegistry();
  const plugin = { contract: { id: 'demo.test', version: '1.0.0', description: 'test', inputSchema: {}, outputSchema: {}, risk: 'low' as const, permissions: [], sideEffects: [] }, execute: async () => ({ ok: true, durationMs: 0 }) };
  registry.register(plugin);
  assert.throws(() => registry.register(plugin));
});

test('provider URL safety rejects untrusted hosts', () => {
  assert.throws(() => assertSafeProviderUrl('https://evil.example/api', ['api.example']));
  assert.equal(assertSafeProviderUrl('https://api.example/v1', ['api.example']).hostname, 'api.example');
});
