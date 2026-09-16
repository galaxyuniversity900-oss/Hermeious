export type ProviderKind = 'local' | 'http' | 'mcp' | 'model';

export interface ProviderBinding {
  providerId: string;
  logicalCapability: string;
  capabilityId: string;
  kind: ProviderKind;
  endpoint?: string;
  enabled?: boolean;
  priority?: number;
  costScore?: number;
  latencyScore?: number;
  qualityScore?: number;
  tags?: string[];
}

export interface ProviderStats {
  attempts: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  lastError?: string;
  lastUsedAt?: string;
}

export interface ProviderCandidate extends ProviderBinding {
  score: number;
  stats: ProviderStats;
}

export interface CapabilityDiscoveryCandidate {
  provider: ProviderBinding;
  manifest?: Record<string, unknown>;
  source: string;
  trust: 'trusted' | 'review' | 'blocked';
}
