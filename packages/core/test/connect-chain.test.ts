import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/registry.js';
import { PolicyEngine } from '../src/policy.js';
import { echoCapability } from '../src/builtins.js';
import { ConnectChain } from '../src/connect-chain.js';

test('connect chain plans, preflights and executes registered capability', async () => {
  const registry = new CapabilityRegistry();
  registry.register(echoCapability);
  const chain = new ConnectChain({
    registry,
    policy: new PolicyEngine('medium'),
    approved: true,
    model: {
      async chat() {
        return JSON.stringify({
          goal: 'echo hello',
          steps: [{ id: 'echo', capability: 'system.echo', input: { value: 'hello' }, dependsOn: [] }],
        });
      },
    },
  });
  const result = await chain.run('echo hello');
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.result?.ok, true);
  assert.equal(result.state.preflight?.ok, true);
  assert.equal(result.state.result?.outputs.echo, 'hello');
  assert.equal(result.candidates[0]?.capability, 'system.echo');
  assert.equal(chain.getTrace().length, 1);
});

test('connect chain rejects planner dependencies that do not exist', async () => {
  const registry = new CapabilityRegistry();
  registry.register(echoCapability);
  const chain = new ConnectChain({
    registry,
    policy: new PolicyEngine('medium'),
    approved: true,
    model: { async chat() { return JSON.stringify({ goal: 'echo', steps: [{ id: 'echo', capability: 'system.echo', input: { value: 'x' }, dependsOn: ['missing'] }] }); } },
  });
  await assert.rejects(() => chain.run('echo'), /Planner dependency not found/);
});
