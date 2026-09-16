import type { CapabilityRegistry } from './registry.js';

export interface PolicyDecision { allowed: boolean; reason: string; }

const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export class PolicyEngine {
  constructor(private readonly maxRisk: keyof typeof riskOrder = 'medium') {}

  check(registry: CapabilityRegistry, capabilityId: string, approved = false): PolicyDecision {
    const handler = registry.get(capabilityId);
    if (!handler) return { allowed: false, reason: 'capability_not_found' };
    const risk = handler.manifest.risk;
    if (riskOrder[risk] > riskOrder[this.maxRisk] && !approved) {
      return { allowed: false, reason: `risk_${risk}_requires_approval` };
    }
    if (risk !== 'low' && !approved) return { allowed: false, reason: 'approval_required' };
    return { allowed: true, reason: 'policy_allowed' };
  }
}
