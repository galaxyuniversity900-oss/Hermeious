import type { ProviderStats } from './provider-types.js';

export class ProviderPerformanceMemory {
  private readonly stats = new Map<string, ProviderStats>();

  get(providerId: string): ProviderStats {
    return this.stats.get(providerId) ?? {
      attempts: 0,
      successes: 0,
      failures: 0,
      totalLatencyMs: 0
    };
  }

  recordSuccess(providerId: string, latencyMs: number): void {
    const current = this.get(providerId);
    this.stats.set(providerId, {
      ...current,
      attempts: current.attempts + 1,
      successes: current.successes + 1,
      totalLatencyMs: current.totalLatencyMs + Math.max(0, latencyMs),
      lastUsedAt: new Date().toISOString()
    });
  }

  recordFailure(providerId: string, latencyMs: number, error: string): void {
    const current = this.get(providerId);
    this.stats.set(providerId, {
      ...current,
      attempts: current.attempts + 1,
      failures: current.failures + 1,
      totalLatencyMs: current.totalLatencyMs + Math.max(0, latencyMs),
      lastError: error,
      lastUsedAt: new Date().toISOString()
    });
  }

  snapshot(): Record<string, ProviderStats> {
    return Object.fromEntries([...this.stats.entries()].map(([id, value]) => [id, { ...value }]));
  }
}
