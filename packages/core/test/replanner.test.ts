import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/registry.js';
import { PolicyEngine } from '../src/policy.js';
import { FailureAwareExecutor } from '../src/replanner.js';
import type { ExecutableCapabilityPlan } from '../src/dag-executor.js';

const manifest = (id: string) => ({
  id,
  version: '1.0.0',
  description: id,
  interfaces: ['local'] as const,
  inputSchema: {},
  outputSchema: {},
  permissions: [],
  risk: 'low' as const
});

test('failure-aware executor replaces a failed capability and completes the graph', async () => {
  const registry = new CapabilityRegistry();
  registry.register({ manifest: manifest('primary'), execute: async () => { throw new Error('provider unavailable'); } });
  registry.register({ manifest: manifest('fallback'), execute: async () => ({ value: 'ok' }) });
  registry.register({ manifest: manifest('consumer'), execute: async input => ({ received: input.value }) });

  const plan: ExecutableCapabilityPlan = {
    id: 'plan-replan',
    goal: 'test fallback',
    steps: [
      { id: 'produce', capability: 'primary', dependsOn: [] },
      { id: 'consume', capability: 'consumer', dependsOn: ['produce'], inputBindings: [{ fromStep: 'produce', outputPath: 'value', inputKey: 'value' }] }
    ]
  };

  const executor = new FailureAwareExecutor(
    registry,
    new PolicyEngine(),
    ({ capability }) => capability === 'primary' ? ['fallback'] : [],
    2,
    1
  );

  const result = await executor.execute(plan);
  assert.equal(result.ok, true);
  assert.equal(result.replanned, true);
  assert.equal(result.outputs.produce && (result.outputs.produce as { value: string }).value, 'ok');
  assert.deepEqual(result.outputs.consume, { received: 'ok' });
  assert.equal(result.attempts[0]?.replacements[0]?.to, 'fallback');
});

test('failure-aware executor stops when no alternative exists', async () => {
  const registry = new CapabilityRegistry();
  registry.register({ manifest: manifest('only'), execute: async () => { throw new Error('hard failure'); } });

  const plan: ExecutableCapabilityPlan = {
    id: 'plan-no-fallback',
    goal: 'test terminal failure',
    steps: [{ id: 'step', capability: 'only', dependsOn: [] }]
  };

  const executor = new FailureAwareExecutor(registry, new PolicyEngine(), () => [], 1, 1);
  const result = await executor.execute(plan);
  assert.equal(result.ok, false);
  assert.equal(result.replanned, true);
  assert.equal(result.attempts[0]?.replacements.length, 0);
});
