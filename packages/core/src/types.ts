export type CapabilityRisk = 'low' | 'medium' | 'high' | 'critical';

export interface CapabilityManifest {
  id: string;
  version: string;
  description: string;
  interfaces: Array<'local' | 'http' | 'mcp'>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: string[];
  risk: CapabilityRisk;
  provider?: string;
  tags?: string[];
}

export interface CapabilityContext {
  requestId: string;
  approved: boolean;
  signal?: AbortSignal;
}

export interface CapabilityHandler {
  manifest: CapabilityManifest;
  execute(input: Record<string, unknown>, context: CapabilityContext): Promise<unknown>;
}

export interface CapabilityPlanStep {
  capability: string;
  input: Record<string, unknown>;
  reason?: string;
  approved?: boolean;
}

export interface CapabilityPlan {
  goal: string;
  steps: CapabilityPlanStep[];
}
