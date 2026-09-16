import test from 'node:test';
import assert from 'node:assert/strict';
import { DependencyAwareExecutor } from '../src/dag-executor.js';
import { CapabilityRegistry } from '../src/registry.js';
import { PolicyEngine } from '../src/policy.js';
import type { CapabilityHandler } from '../src/types.js';

const capability = (id: string, fn: (input: Record<string, unknown>) => unknown, delay = 0): CapabilityHandler => ({
  manifest: {
    id,
    version: '1.0.0',
    description: id,
    interfaces: ['local'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    permissions: [],
    risk: 'low'
  },
  async execute(input) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    return fn(input);
  }
});

test('dependency-aware executor runs independent steps and binds outputs', async () => {
  const registry = new CapabilityRegistry();
  registry.register(capability('a', () => ({ value: 7 }), 15));
  registry.register(capability('b', () => ({ value: 5 }), 15));
  registry.register(capability('sum', input => ({ total: Number(input.left) + Number(input.right) })));
  const executor = new DependencyAwareExecutor(registry, new PolicyEngine('low'), 2);

  const result = await executor.execute({
    id: 'plan-1',
    goal: 'sum values',
    steps: [
      { id: 'a', capability: 'a', dependsOn: [] },
      { id: 'b', capability: 'b', dependsOn: [] },
      {
        id: 'sum',
        capability: 'sum',
        dependsOn: ['a', 'b'],
        inputBindings: [
          { fromStep: 'a', outputPath: 'value', inputKey: 'left' },
          { fromStep: 'b', outputPath: 'value', inputKey: 'right' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal((result.outputs.sum as { total: number }).total, 12);
  assert.equal(result.results.length, 3);
});

test('dependency-aware executor rejects cycles', async () => {
  const registry = new CapabilityRegistry();
  registry.register(capability('a', () => 1));
  const executor = new DependencyAwareExecutor(registry, new PolicyEngine('low'));
  await assert.rejects(() => executor.execute({
    id: 'cycle',
    goal: 'cycle',
    steps: [
      { id: 'a', capability: 'a', dependsOn: ['b'] },
      { id: 'b', capability: 'a', dependsOn: ['a'] }
    ]
  }), /dependency cycle/);
});
