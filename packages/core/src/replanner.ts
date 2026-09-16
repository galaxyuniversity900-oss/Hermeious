import type { ExecutableCapabilityPlan, DagExecutionResult, DagExecutorOptions } from './dag-executor.js';
import type { CapabilityStep } from './composer.js';
import { DependencyAwareExecutor } from './dag-executor.js';
import { CapabilityRegistry } from './registry.js';
import { PolicyEngine } from './policy.js';

export type CapabilityAlternativeResolver = (input: { capability: string; step: CapabilityStep; error?: string }) => string[];
export type ReplanAttempt = { attempt: number; failedStepId?: string; failedCapability?: string; error?: string; replacements: Array<{ stepId: string; from: string; to: string }>; };
export type FailureAwareExecutionResult = DagExecutionResult & { attempts: ReplanAttempt[]; replanned: boolean };

export class FailureAwareExecutor {
  constructor(private readonly registry: CapabilityRegistry, private readonly policy: PolicyEngine, private readonly resolveAlternatives: CapabilityAlternativeResolver, private readonly concurrency = 4, private readonly maxReplans = 2, private readonly executorOptions: DagExecutorOptions = {}) { if (maxReplans < 0) throw new Error('maxReplans must be non-negative'); }
  async execute(plan: ExecutableCapabilityPlan, approved = false): Promise<FailureAwareExecutionResult> {
    let current = clonePlan(plan); const attempts: ReplanAttempt[] = []; const usedAlternatives = new Map<string, Set<string>>();
    for (let attempt = 0; attempt <= this.maxReplans; attempt++) {
      const executor = new DependencyAwareExecutor(this.registry, this.policy, this.concurrency, this.executorOptions);
      const result = await executor.execute(current, approved);
      if (result.ok) return { ...result, attempts, replanned: attempts.length > 0 };
      const failed = result.results.find(item => !item.ok);
      if (!failed || attempt === this.maxReplans) return { ...result, attempts, replanned: attempts.length > 0 };
      const failedStep = current.steps.find(step => step.id === failed.stepId);
      if (!failedStep) return { ...result, attempts, replanned: attempts.length > 0 };
      const used = usedAlternatives.get(failedStep.id) ?? new Set<string>([failedStep.capability]);
      const alternatives = this.resolveAlternatives({ capability: failedStep.capability, step: failedStep, error: failed.error }).filter(candidate => candidate && !used.has(candidate));
      if (!alternatives.length) { attempts.push({ attempt: attempt + 1, failedStepId: failed.stepId, failedCapability: failedStep.capability, error: failed.error, replacements: [] }); return { ...result, attempts, replanned: attempts.length > 0 }; }
      const replacement = alternatives[0]; used.add(replacement); usedAlternatives.set(failedStep.id, used);
      current = replaceFailedStep(current, failedStep.id, replacement);
      attempts.push({ attempt: attempt + 1, failedStepId: failed.stepId, failedCapability: failedStep.capability, error: failed.error, replacements: [{ stepId: failedStep.id, from: failedStep.capability, to: replacement }] });
    }
    throw new Error('Failure-aware execution exhausted unexpectedly');
  }
}
function replaceFailedStep(plan: ExecutableCapabilityPlan, stepId: string, capability: string): ExecutableCapabilityPlan { return { ...plan, id: `${plan.id}-replan-${Date.now().toString(36)}`, steps: plan.steps.map(step => step.id === stepId ? { ...step, capability } : { ...step }) }; }
function clonePlan(plan: ExecutableCapabilityPlan): ExecutableCapabilityPlan { return { ...plan, steps: plan.steps.map(step => ({ ...step, dependsOn: [...step.dependsOn], input: step.input ? { ...step.input } : undefined, inputBindings: step.inputBindings ? step.inputBindings.map(binding => ({ ...binding })) : undefined })) }; }
