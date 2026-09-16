export type CapabilityRisk = 'low' | 'medium' | 'high' | 'critical';

export interface CapabilityContract<I = unknown, O = unknown> {
  id: string;
  version: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  risk: CapabilityRisk;
  permissions: string[];
  sideEffects: string[];
  supportsStreaming?: boolean;
  deterministic?: boolean;
  estimate?: (input: I) => { cost?: number; latencyMs?: number };
}

export interface CapabilityInvocation<I = unknown> {
  capability: string;
  input: I;
  requestId: string;
  traceId: string;
  budget?: { maxCost?: number; maxLatencyMs?: number };
}

export interface CapabilityOutcome<O = unknown> {
  ok: boolean;
  output?: O;
  error?: { code: string; message: string; retryable?: boolean };
  provider?: string;
  durationMs: number;
  cost?: number;
  artifacts?: string[];
}
