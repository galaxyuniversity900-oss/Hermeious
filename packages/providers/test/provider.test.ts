import test from 'node:test';
import assert from 'node:assert/strict';
import { FallbackExecutor, ProviderResolver } from '../src/index.js';

test('resolver ranks providers and fallback learns from failures', async () => {
  const resolver = new ProviderResolver();
  resolver.registerMany([
    { providerId: 'primary', logicalCapability: 'video.generate', capabilityId: 'video.primary', kind: 'http', qualityScore: 0.95, priority: 10 },
    { providerId: 'fallback', logicalCapability: 'video.generate', capabilityId: 'video.fallback', kind: 'http', qualityScore: 0.8, priority: 5 }
  ]);

  const executor = new FallbackExecutor(resolver);
  const result = await executor.execute('video.generate', { prompt: 'test' }, async capabilityId => {
    if (capabilityId === 'video.primary') throw new Error('primary unavailable');
    return { provider: capabilityId };
  });

  assert.equal(result.ok, true);
  assert.equal(result.providerId, 'fallback');
  assert.equal(result.attempts.length, 2);
  assert.equal(resolver.performance.get('primary').failures, 1);
  assert.equal(resolver.performance.get('fallback').successes, 1);
});
