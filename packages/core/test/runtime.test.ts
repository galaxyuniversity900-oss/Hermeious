import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/registry.js';
import { CapabilityRouter } from '../src/router.js';
import { CapabilityExecutor } from '../src/executor.js';
import { PolicyEngine } from '../src/policy.js';
import { echoCapability } from '../src/builtins.js';

test('router finds matching capabilities', () => {
  const registry = new CapabilityRegistry();
  registry.register(echoCapability);
  const results = new CapabilityRouter(registry).route('echo this payload');
  assert.equal(results[0]?.capability, 'system.echo');
});

test('policy blocks medium risk without approval', () => {
  const registry = new CapabilityRegistry();
  registry.register({ ...echoCapability, manifest: { ...echoCapability.manifest, id: 'test.medium', risk: 'medium' } });
  const decision = new PolicyEngine('medium').check(registry, 'test.medium', false);
  assert.equal(decision.allowed, false);
});

test('executor runs an approved plan', async () => {
  const registry = new CapabilityRegistry();
  registry.register(echoCapability);
  const executor = new CapabilityExecutor(registry, new PolicyEngine('medium'));
  const results = await executor.executePlan({ goal: 'echo', steps: [{ capability: 'system.echo', input: { ok: true } }] });
  assert.equal(results[0]?.ok, true);
  assert.deepEqual(results[0]?.result, { ok: true });
});
