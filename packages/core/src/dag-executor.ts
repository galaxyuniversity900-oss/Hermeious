import { randomUUID } from 'node:crypto';
import type { CapabilityStep, CapabilityPlan } from './composer.js';
import { CapabilityRegistry } from './registry.js';
import { PolicyEngine } from './policy.js';
import { dependencyAwareCacheKey, InMemoryCapabilityCache, type CapabilityCache } from './cache.js';
import { runQualityGate, type QualityEvaluator } from './quality-gate.js';

export type InputBinding = { fromStep: string; outputPath?: string; inputKey: string };
export type ExecutableCapabilityStep = CapabilityStep & { inputBindings?: InputBinding[] };
export type ExecutableCapabilityPlan = Omit<CapabilityPlan, 'steps'> & { steps: ExecutableCapabilityStep[] };
export type DagStepResult = { stepId: string; capability: string; ok: boolean; result?: unknown; error?: string; cached?: boolean; qualityScore?: number; startedAt: string; finishedAt: string };
export type DagExecutionResult = { planId: string; goal: string; ok: boolean; results: DagStepResult[]; outputs: Record<string, unknown> };

export interface DagExecutorOptions {
  cache?: CapabilityCache;
  qualityEvaluator?: QualityEvaluator;
  qualityMinScore?: number;
}

export class DependencyAwareExecutor {
  private readonly cache: CapabilityCache;
  constructor(private readonly registry: CapabilityRegistry, private readonly policy: PolicyEngine, private readonly concurrency = 4, private readonly options: DagExecutorOptions = {}) {
    if (concurrency < 1) throw new Error('concurrency must be at least 1');
    this.cache = options.cache ?? new InMemoryCapabilityCache();
  }

  async execute(plan: ExecutableCapabilityPlan, approved = false): Promise<DagExecutionResult> {
    this.validate(plan);
    const pending = new Map(plan.steps.map(step => [step.id, step]));
    const completed = new Map<string, DagStepResult>();
    const outputs: Record<string, unknown> = {};
    while (pending.size) {
      const ready = [...pending.values()].filter(step => step.dependsOn.every(id => completed.has(id)));
      if (!ready.length) throw new Error('Capability plan cannot make progress: unresolved dependency or cycle');
      const blocked = ready.filter(step => step.dependsOn.some(id => !completed.get(id)!.ok));
      for (const step of blocked) {
        const failedDependencies = step.dependsOn.filter(id => !completed.get(id)!.ok);
        completed.set(step.id, { stepId: step.id, capability: step.capability, ok: false, error: `Skipped because dependency failed: ${failedDependencies.join(', ')}`, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() });
        pending.delete(step.id);
      }
      const runnable = ready.filter(step => !blocked.includes(step));
      if (!runnable.length) continue;
      const batch = runnable.slice(0, this.concurrency);
      const batchResults = await Promise.all(batch.map(step => this.runStep(step, outputs, approved, plan.goal)));
      for (const result of batchResults) { completed.set(result.stepId, result); pending.delete(result.stepId); if (result.ok) outputs[result.stepId] = result.result; }
    }
    const results = [...completed.values()];
    return { planId: plan.id, goal: plan.goal, ok: results.every(result => result.ok), results, outputs };
  }

  private async runStep(step: ExecutableCapabilityStep, outputs: Record<string, unknown>, approved: boolean, goal: string): Promise<DagStepResult> {
    const startedAt = new Date().toISOString();
    try {
      const input = this.resolveInput(step, outputs);
      const manifest = this.registry.get(step.capability)?.manifest;
      if (!manifest) throw new Error(`Capability not found: ${step.capability}`);
      const decision = this.policy.check(this.registry, step.capability, approved);
      if (!decision.allowed) throw new Error(decision.reason);
      const dependencyOutputs: Record<string, unknown> = {};
      for (const dep of step.dependsOn) dependencyOutputs[dep] = outputs[dep];
      const key = dependencyAwareCacheKey({ goal, capability: manifest.id, version: manifest.version, input, dependencyOutputs });
      const cached = this.cache.get(key);
      if (cached) return { stepId: step.id, capability: step.capability, ok: true, result: cached.value, cached: true, qualityScore: cached.qualityScore, startedAt, finishedAt: new Date().toISOString() };
      const result = await this.registry.execute(step.capability, input, { requestId: randomUUID(), approved });
      const expected = manifest.outputSchema?.required;
      const gate = await runQualityGate(result, { minScore: this.options.qualityMinScore ?? 0, evaluator: this.options.qualityEvaluator, expectedKeys: Array.isArray(expected) ? expected.filter((v): v is string => typeof v === 'string') : undefined }, { capability: manifest.id, goal, expectedOutputSchema: manifest.outputSchema });
      if (!gate.ok) throw new Error(`Quality gate failed: ${gate.failures.join('; ') || `score ${gate.score}`}`);
      this.cache.set(key, { key, value: result, createdAt: new Date().toISOString(), qualityScore: gate.score, provenance: { capability: manifest.id, version: manifest.version, goal } });
      return { stepId: step.id, capability: step.capability, ok: true, result, qualityScore: gate.score, startedAt, finishedAt: new Date().toISOString() };
    } catch (error) {
      return { stepId: step.id, capability: step.capability, ok: false, error: error instanceof Error ? error.message : String(error), startedAt, finishedAt: new Date().toISOString() };
    }
  }

  private resolveInput(step: ExecutableCapabilityStep, outputs: Record<string, unknown>): Record<string, unknown> {
    const input: Record<string, unknown> = { ...(step.input ?? {}) };
    for (const binding of step.inputBindings ?? []) {
      if (!(binding.fromStep in outputs)) throw new Error(`Missing output from dependency: ${binding.fromStep}`);
      const source = binding.outputPath ? getPath(outputs[binding.fromStep], binding.outputPath) : outputs[binding.fromStep];
      if (source === undefined) throw new Error(`Output path not found: ${binding.fromStep}.${binding.outputPath ?? ''}`);
      input[binding.inputKey] = source;
    }
    return input;
  }

  private validate(plan: ExecutableCapabilityPlan): void {
    const ids = new Set<string>();
    for (const step of plan.steps) { if (ids.has(step.id)) throw new Error(`Duplicate plan step: ${step.id}`); ids.add(step.id); }
    for (const step of plan.steps) { for (const dependency of step.dependsOn) if (!ids.has(dependency)) throw new Error(`Unknown dependency: ${dependency}`); for (const binding of step.inputBindings ?? []) if (!ids.has(binding.fromStep)) throw new Error(`Unknown input binding source: ${binding.fromStep}`); }
    const indegree = new Map(plan.steps.map(step => [step.id, step.dependsOn.length]));
    const outgoing = new Map<string, string[]>();
    for (const step of plan.steps) for (const dependency of step.dependsOn) { const list = outgoing.get(dependency) ?? []; list.push(step.id); outgoing.set(dependency, list); }
    const queue = [...plan.steps.filter(step => indegree.get(step.id) === 0).map(step => step.id)]; let visited = 0;
    while (queue.length) { const id = queue.shift()!; visited++; for (const next of outgoing.get(id) ?? []) { indegree.set(next, indegree.get(next)! - 1); if (indegree.get(next) === 0) queue.push(next); } }
    if (visited !== plan.steps.length) throw new Error('Capability plan contains a dependency cycle');
  }
}

function getPath(value: unknown, path: string): unknown { if (!path) return value; return path.split('.').reduce<unknown>((current, key) => current === null || current === undefined || typeof current !== 'object' ? undefined : (current as Record<string, unknown>)[key], value); }
