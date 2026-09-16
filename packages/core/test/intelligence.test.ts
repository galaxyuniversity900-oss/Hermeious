import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/registry.js';
import { DependencyAwareExecutor } from '../src/dag-executor.js';
import { InMemoryCapabilityCache, dependencyAwareCacheKey } from '../src/cache.js';
import { PolicyEngine } from '../src/policy.js';
import { echoCapability } from '../src/builtins.js';

test('cache key changes when dependency output changes', () => {
  const a = dependencyAwareCacheKey({ goal: 'x', capability: 'c', version: '1', input: {}, dependencyOutputs: { a: { value: 1 } } });
  const b = dependencyAwareCacheKey({ goal: 'x', capability: 'c', version: '1', input: {}, dependencyOutputs: { a: { value: 2 } } });
  const c = dependencyAwareCacheKey({ goal: 'x', capability: 'c', version: '2', input: {}, dependencyOutputs: { a: { value: 1 } } });
  assert.notEqual(a, b); assert.notEqual(a, c);
});

test('DAG execution reuses successful cached output', async () => {
  const registry = new CapabilityRegistry(); registry.register(echoCapability);
  const cache = new InMemoryCapabilityCache();
  const executor = new DependencyAwareExecutor(registry, new PolicyEngine('medium'), 2, { cache });
  const plan = { id: 'cache-test', goal: 'echo', steps: [{ id: 'one', capability: 'system.echo', input: { value: 7 }, dependsOn: [] }] };
  const first = await executor.execute(plan); const second = await executor.execute(plan);
  assert.equal(first.ok, true); assert.equal(second.results[0]?.cached, true); assert.equal(cache.size(), 1);
});
