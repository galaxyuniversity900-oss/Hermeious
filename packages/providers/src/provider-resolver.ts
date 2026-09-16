import type { ProviderBinding, ProviderCandidate } from './provider-types.js';
import { ProviderPerformanceMemory } from './provider-memory.js';

export class ProviderResolver {
  private readonly bindings = new Map<string, ProviderBinding[]>();

  constructor(private readonly memory = new ProviderPerformanceMemory()) {}

  register(binding: ProviderBinding): void {
    const list = this.bindings.get(binding.logicalCapability) ?? [];
    const filtered = list.filter(item => item.providerId !== binding.providerId);
    filtered.push({ ...binding, enabled: binding.enabled !== false });
    this.bindings.set(binding.logicalCapability, filtered);
  }

  registerMany(bindings: ProviderBinding[]): void {
    for (const binding of bindings) this.register(binding);
  }

  list(logicalCapability?: string): ProviderBinding[] {
    if (logicalCapability) return [...(this.bindings.get(logicalCapability) ?? [])];
    return [...this.bindings.values()].flat().map(binding => ({ ...binding }));
  }

  resolve(logicalCapability: string): ProviderCandidate[] {
    return (this.bindings.get(logicalCapability) ?? [])
      .filter(binding => binding.enabled !== false)
      .map(binding => {
        const stats = this.memory.get(binding.providerId);
        const reliability = stats.attempts === 0 ? 0.75 : (stats.successes + 1) / (stats.attempts + 2);
        const avgLatency = stats.attempts === 0 ? 0 : stats.totalLatencyMs / stats.attempts;
        const latency = avgLatency === 0 ? 0.75 : 1 / (1 + avgLatency / 5000);
        const score =
          (binding.qualityScore ?? 0.7) * 0.35 +
          reliability * 0.30 +
          latency * 0.15 +
          (binding.priority ?? 0) / 100 * 0.10 +
          (1 - Math.min(1, binding.costScore ?? 0.5)) * 0.10;
        return { ...binding, score, stats };
      })
      .sort((a, b) => b.score - a.score);
  }

  get performance() { return this.memory; }
}
