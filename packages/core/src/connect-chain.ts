import { randomUUID } from 'node:crypto';
import type { CapabilityPlan } from './composer.js';
import type { ExecutableCapabilityPlan, DagExecutionResult, DagExecutorOptions } from './dag-executor.js';
import { FailureAwareExecutor, type FailureAwareExecutionResult } from './replanner.js';
import { CapabilityRegistry } from './registry.js';
import { PolicyEngine } from './policy.js';
import { SemanticCapabilityRouter, type EmbeddingProvider, type CapabilityRouteConstraints, type SemanticRouteCandidate } from './semantic-router.js';
import { validatePlanPreflight, type PreflightReport } from './platform/preflight.js';
import { Observability } from './observability.js';
import { VersionedJsonStore } from './persistence.js';

export interface ConnectChainModel {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string>;
}

export interface ConnectChainOptions {
  model: ConnectChainModel;
  registry: CapabilityRegistry;
  policy: PolicyEngine;
  embeddingProvider?: EmbeddingProvider;
  constraints?: CapabilityRouteConstraints;
  candidateLimit?: number;
  concurrency?: number;
  maxReplans?: number;
  executorOptions?: DagExecutorOptions;
  approved?: boolean;
  stateStore?: VersionedJsonStore<ConnectChainState>;
}

export interface ConnectChainState {
  id: string;
  goal: string;
  status: 'planned' | 'running' | 'completed' | 'failed';
  plan?: ExecutableCapabilityPlan;
  preflight?: PreflightReport;
  result?: DagExecutionResult | FailureAwareExecutionResult;
  error?: string;
  updatedAt: string;
}

export interface ConnectChainResult {
  state: ConnectChainState;
  candidates: SemanticRouteCandidate[];
}

const SYSTEM = `You are the Hermeious orchestration planner. Return ONLY JSON.
Schema: {"goal":string,"steps":[{"id":string,"capability":string,"input":object,"dependsOn":string[]}]}
Use only capability ids from Candidates. Build a minimal executable DAG. Every dependency must reference an existing step id. Do not invent capabilities. If the goal cannot be satisfied by the candidates, return an empty steps array.`;

export class ConnectChain {
  private readonly router: SemanticCapabilityRouter;
  private readonly observability = new Observability();

  constructor(private readonly options: ConnectChainOptions) {
    this.router = new SemanticCapabilityRouter(options.registry);
  }

  async run(goal: string): Promise<ConnectChainResult> {
    const id = randomUUID();
    const span = this.observability.start('connect-chain', { goal, taskId: id });
    let state: ConnectChainState = { id, goal, status: 'planned', updatedAt: new Date().toISOString() };
    try {
      const candidates = await this.router.route(goal, {
        limit: this.options.candidateLimit ?? 12,
        embeddingProvider: this.options.embeddingProvider,
        constraints: this.options.constraints,
      });
      if (!candidates.length) throw new Error('No capability candidates satisfy the request');

      const plan = await this.plan(goal, candidates);
      const preflight = validatePlanPreflight(plan, this.options.registry, this.options.approved ?? false);
      state = { ...state, plan, preflight, status: 'planned', updatedAt: new Date().toISOString() };
      await this.persist(state);
      if (!preflight.ok) throw new Error(`Plan preflight failed: ${preflight.issues.filter(i => i.severity === 'error').map(i => i.message).join('; ')}`);

      state = { ...state, status: 'running', updatedAt: new Date().toISOString() };
      await this.persist(state);
      const executor = new FailureAwareExecutor(
        this.options.registry,
        this.options.policy,
        ({ capability, step }) => this.alternatives(capability, step.capability),
        this.options.concurrency ?? 4,
        this.options.maxReplans ?? 2,
        this.options.executorOptions ?? {},
      );
      const result = await executor.execute(plan, this.options.approved ?? false);
      state = { ...state, result, status: result.ok ? 'completed' : 'failed', updatedAt: new Date().toISOString() };
      await this.persist(state);
      this.observability.end(span, { ok: result.ok, replanned: 'replanned' in result ? result.replanned : false });
      return { state, candidates };
    } catch (error) {
      state = { ...state, status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() };
      await this.persist(state);
      this.observability.end(span, { ok: false, error: state.error });
      throw Object.assign(new Error(state.error), { state });
    }
  }

  getTrace() { return this.observability.list(); }

  private async plan(goal: string, candidates: SemanticRouteCandidate[]): Promise<ExecutableCapabilityPlan> {
    const prompt = JSON.stringify(candidates.map(candidate => ({
      id: candidate.capability,
      description: candidate.manifest.description,
      inputSchema: candidate.manifest.inputSchema,
      outputSchema: candidate.manifest.outputSchema,
      risk: candidate.manifest.risk,
      score: candidate.score,
    })));
    const raw = await this.options.model.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Goal: ${goal}\nCandidates: ${prompt}` },
    ]);
    const parsed = parsePlan(raw);
    const allowed = new Set(candidates.map(candidate => candidate.capability));
    const steps = parsed.steps
      .filter(step => allowed.has(step.capability))
      .map((step, index) => ({
        id: step.id?.trim() || `step-${index + 1}`,
        capability: step.capability,
        input: step.input ?? {},
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      }));
    if (!steps.length) throw new Error('Planner produced no executable steps');
    const ids = new Set(steps.map(step => step.id));
    for (const step of steps) for (const dep of step.dependsOn) if (!ids.has(dep)) throw new Error(`Planner dependency not found: ${dep}`);
    return { id: randomUUID(), goal, steps };
  }

  private alternatives(requested: string, failedCapability: string): string[] {
    const candidates = this.options.registry.list().filter(manifest => manifest.id !== failedCapability);
    const target = requested.toLowerCase();
    return candidates
      .map(manifest => ({ id: manifest.id, score: this.aliasScore(target, manifest.id, manifest.description, manifest.tags ?? [], manifest.aliases ?? []) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map(item => item.id);
  }

  private aliasScore(target: string, id: string, description: string, tags: string[], aliases: string[]): number {
    const words = new Set(target.split(/[^a-z0-9_.-]+/).filter(Boolean));
    const text = [id, description, ...tags, ...aliases].join(' ').toLowerCase();
    let score = 0;
    for (const word of words) if (text.includes(word)) score += word.length > 3 ? 2 : 1;
    return score;
  }

  private async persist(state: ConnectChainState): Promise<void> {
    if (!this.options.stateStore) return;
    await this.options.stateStore.save(state.id, state);
  }
}

function parsePlan(raw: string): CapabilityPlan {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Planner returned no JSON object');
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as CapabilityPlan;
  if (!parsed || typeof parsed.goal !== 'string' || !Array.isArray(parsed.steps)) throw new Error('Invalid capability plan');
  return parsed;
}
