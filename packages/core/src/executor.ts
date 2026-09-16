import { randomUUID } from 'node:crypto';
import type { CapabilityPlan } from './types.js';
import { CapabilityRegistry } from './registry.js';
import { PolicyEngine } from './policy.js';

export interface ExecutionResult { capability: string; ok: boolean; result?: unknown; error?: string; }

export class CapabilityExecutor {
  constructor(private readonly registry: CapabilityRegistry, private readonly policy: PolicyEngine) {}

  async executePlan(plan: CapabilityPlan, approved = false): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    for (const step of plan.steps) {
      const stepApproved = approved || step.approved === true;
      const decision = this.policy.check(this.registry, step.capability, stepApproved);
      if (!decision.allowed) {
        results.push({ capability: step.capability, ok: false, error: decision.reason });
        continue;
      }
      try {
        const result = await this.registry.execute(step.capability, step.input ?? {}, { requestId: randomUUID(), approved: stepApproved });
        results.push({ capability: step.capability, ok: true, result });
      } catch (error) {
        results.push({ capability: step.capability, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }
}
