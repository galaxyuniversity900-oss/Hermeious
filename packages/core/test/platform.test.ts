import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../src/platform/artifacts.js';
import { ApprovalManager } from '../src/platform/approvals.js';
import { CostController } from '../src/platform/cost.js';
import { validateQuality, rules } from '../src/platform/validation.js';
import { PluginRegistry } from '../src/platform/plugins.js';
import { assertSafeProviderUrl } from '../src/platform/security.js';
import { EventBus } from '../src/platform/events.js';
import { TaskManager } from '../src/platform/tasks.js';
import { CapabilityGapAnalyzer } from '../src/platform/gap-analyzer.js';

test('artifact lifecycle versions outputs', () => {
  const store = new ArtifactStore();
  const a = store.create({ name: 'report.pdf', kind: 'file', mimeType: 'application/pdf', uri: 'workspace://report.pdf', metadata: {} });
  const b = store.version(a.id, { metadata: { pages: 10 } });
  assert.equal(b.version, 2);
  assert.equal(store.list().length, 1);
});

test('artifact content storage calculates checksum and persists to disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'hermeious-artifacts-'));
  try {
    const store = new ArtifactStore(root);
    const artifact = store.create({ name: 'hello.txt', kind: 'file', mimeType: 'text/plain', uri: 'artifact://hello.txt', metadata: {} });
    const written = store.putContent(artifact.id, 'hello world');
    const read = store.readContent(artifact.id);
    assert.equal(written.size, 11);
    assert.equal(written.checksum, read.checksum);
    assert.equal(read.bytes.toString('utf8'), 'hello world');
    assert.equal(store.get(artifact.id)?.size, 11);
    assert.equal(store.get(artifact.id)?.checksum, written.checksum);
    assert.equal(store.hasContent(artifact.id), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('provider URL safety rejects untrusted and private hosts', () => {
  assert.throws(() => assertSafeProviderUrl('https://evil.example/api', ['api.example']));
  assert.throws(() => assertSafeProviderUrl('http://127.0.0.1:8080', ['127.0.0.1']));
  assert.equal(assertSafeProviderUrl('https://api.example/v1', ['API.EXAMPLE']).hostname, 'api.example');
});

test('capability gap analyzer resolves exact and related capabilities', () => {
  const analyzer = new CapabilityGapAnalyzer({ 'web.browse': ['search.web', 'browser.web'] });
  const report = analyzer.analyze('research', [
    { capability: 'search.web' },
    { capability: 'web.browse' },
    { capability: 'video.generate' },
  ], ['search.web', 'browser.web', 'document.pdf']);
  assert.equal(report.gaps[0].missing, false);
  assert.equal(report.gaps[1].missing, false);
  assert.equal(report.gaps[2].missing, true);
  assert.equal(report.complete, false);
});

test('TaskManager emits approval and completion lifecycle events', async () => {
  const approvals = new ApprovalManager();
  const artifacts = new ArtifactStore();
  const bus = new EventBus();
  const emitted: string[] = [];
  bus.subscribe(event => emitted.push(event.type));
  const executor = {
    async execute(plan: any) {
      return {
        planId: plan.id,
        goal: plan.goal,
        ok: true,
        results: plan.steps.map((step: any) => ({ stepId: step.id, capability: step.capability, ok: true, result: {}, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() })),
        outputs: {},
      };
    },
  };
  const manager = new TaskManager(executor as any, approvals, artifacts, bus);
  const task = manager.create({ id: 'p-task', goal: 'test', steps: [{ id: 's1', capability: 'system.echo', dependsOn: [], input: { value: 'ok' } }] }, false);
  assert.equal(task.status, 'paused');
  assert.equal(approvals.list().length, 1);
  await manager.approve(task.id);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(manager.get(task.id)?.status, 'completed');
  assert.ok(emitted.includes('approval.required'));
  assert.ok(emitted.includes('task.completed'));
});
