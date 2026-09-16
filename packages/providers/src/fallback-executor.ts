import { ProviderResolver } from './provider-resolver.js';

export interface FallbackAttempt {
  providerId: string;
  capabilityId: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface FallbackResult {
  ok: boolean;
  providerId?: string;
  capabilityId?: string;
  result?: unknown;
  attempts: FallbackAttempt[];
}

export class FallbackExecutor {
  constructor(private readonly resolver: ProviderResolver) {}

  async execute(
    logicalCapability: string,
    input: Record<string, unknown>,
    executeCapability: (capabilityId: string, input: Record<string, unknown>) => Promise<unknown>
  ): Promise<FallbackResult> {
    const candidates = this.resolver.resolve(logicalCapability);
    if (!candidates.length) throw new Error(`No provider available for capability: ${logicalCapability}`);

    const attempts: FallbackAttempt[] = [];
    for (const candidate of candidates) {
      const started = Date.now();
      try {
        const result = await executeCapability(candidate.capabilityId, input);
        const latencyMs = Date.now() - started;
        this.resolver.performance.recordSuccess(candidate.providerId, latencyMs);
        attempts.push({ providerId: candidate.providerId, capabilityId: candidate.capabilityId, ok: true, latencyMs });
        return { ok: true, providerId: candidate.providerId, capabilityId: candidate.capabilityId, result, attempts };
      } catch (error) {
        const latencyMs = Date.now() - started;
        const message = error instanceof Error ? error.message : String(error);
        this.resolver.performance.recordFailure(candidate.providerId, latencyMs, message);
        attempts.push({ providerId: candidate.providerId, capabilityId: candidate.capabilityId, ok: false, latencyMs, error: message });
      }
    }

    return { ok: false, attempts };
  }
}
