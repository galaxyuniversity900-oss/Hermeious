import { randomUUID } from 'node:crypto';
import type { ExecutableCapabilityPlan, DagExecutionResult, DependencyAwareExecutor } from '../dag-executor.js';
import type { FailureAwareExecutor, FailureAwareExecutionResult } from '../replanner.js';
import { ApprovalManager } from './approvals.js';
import { ArtifactStore } from './artifacts.js';
import { EventBus, type RuntimeEvent, type RuntimeEventType } from './events.js';

export type TaskStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
type RunnableExecutor = Pick<DependencyAwareExecutor, 'execute'> | Pick<FailureAwareExecutor, 'execute'>;
	export interface TaskRecord {
  id: string;
  goal: string;
  status: TaskStatus;
  plan: ExecutableCapabilityPlan;
  result?: DagExecutionResult | FailureAwareExecutionResult;
  error?: string;
  approvalId?: string;
  createdAt: string;
  updatedAt: string;
}

export class TaskManager {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly eventHistory = new Map<string, RuntimeEvent[]>();
  private readonly subscribers = new Map<string, Set<(event: RuntimeEvent) => void>>();

  constructor(
    private readonly executor: RunnableExecutor,
    private readonly approvals: ApprovalManager,
    private readonly artifacts: ArtifactStore,
    private readonly bus: EventBus,
    private readonly defaultApprovalRisk: 'medium' | 'high' | 'critical' = 'high',
  ) {
    this.bus.subscribe(event => {
      const history = this.eventHistory.get(event.taskId) ?? [];
      history.push(event);
      if (history.length > 1000) history.shift();
      this.eventHistory.set(event.taskId, history);
      for (const listener of this.subscribers.get(event.taskId) ?? []) listener(event);
    });
  }

  create(plan: ExecutableCapabilityPlan, approved = false): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      goal: plan.goal,
      status: approved ? 'queued' : 'paused',
      plan,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    if (!approved) {
      const request = this.approvals.request({
        id: randomUUID(),
        taskId: task.id,
        action: `execute:${plan.goal}`,
        risk: this.defaultApprovalRisk,
        reason: 'Interactive execution approval required',
      });
      task.approvalId = request.id;
      this.publish(task, 'approval.required', { approvalId: request.id, risk: request.risk });
    }
    if (approved) {
      this.publish(task, 'task.started', { queued: true });
      void this.run(task.id, true);
    } else {
      this.publish(task, 'task.paused', { reason: 'approval_required' });
    }
    return task;
  }

  async approve(taskId: string): Promise<TaskRecord> {
    const task = this.require(taskId);
    if (task.status !== 'paused') return task;
    if (task.approvalId) this.approvals.decide(task.approvalId, 'approved');
    task.status = 'queued';
    task.updatedAt = new Date().toISOString();
    this.publish(task, 'task.paused', { resumed: true });
    void this.run(task.id, true);
    return task;
  }

  reject(taskId: string): TaskRecord {
    const task = this.require(taskId);
    if (task.approvalId) this.approvals.decide(task.approvalId, 'rejected');
    task.status = 'cancelled';
    task.updatedAt = new Date().toISOString();
    this.publish(task, 'task.paused', { rejected: true });
    return task;
  }

  cancel(taskId: string): TaskRecord {
    const task = this.require(taskId);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return task;
    task.status = 'cancelled';
    task.updatedAt = new Date().toISOString();
    this.publish(task, 'task.paused', { cancelled: true });
    return task;
  }

  get(taskId: string): TaskRecord | undefined { return this.tasks.get(taskId); }
  list(): TaskRecord[] { return [...this.tasks.values()]; }
  events(taskId: string): RuntimeEvent[] { return [...(this.eventHistory.get(taskId) ?? [])]; }
  artifactsFor(taskId: string) { return this.artifacts.list().filter(a => a.metadata.taskId === taskId); }

  subscribe(taskId: string, listener: (event: RuntimeEvent) => void): () => void {
    const set = this.subscribers.get(taskId) ?? new Set<(event: RuntimeEvent) => void>();
    set.add(listener);
    this.subscribers.set(taskId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.subscribers.delete(taskId);
    };
  }

  private async run(taskId: string, approved: boolean): Promise<void> {
    const task = this.require(taskId);
    if (task.status === 'cancelled') return;
    task.status = 'running';
    task.updatedAt = new Date().toISOString();
    this.publish(task, 'task.started');
    try {
      const result = await this.executor.execute(task.plan, approved);
      task.result = result;
      this.publish(task, 'step.progress', { completedSteps: result.results.filter(r => r.ok).length, totalSteps: result.results.length });
      for (const [stepId, value] of Object.entries(result.outputs)) {
        if (value && typeof value === 'object' && 'uri' in value && typeof (value as Record<string, unknown>).uri === 'string') {
          const artifact = this.artifacts.create({
            name: stepId,
            kind: 'file',
            mimeType: typeof (value as Record<string, unknown>).mimeType === 'string' ? String((value as Record<string, unknown>).mimeType) : 'application/octet-stream',
            uri: String((value as Record<string, unknown>).uri),
            sourceStep: stepId,
            metadata: { taskId, capability: task.plan.steps.find(step => step.id === stepId)?.capability },
          });
          this.publish(task, 'artifact.created', artifact);
        }
      }
      task.status = result.ok ? 'completed' : 'failed';
      task.updatedAt = new Date().toISOString();
      this.publish(task, 'task.completed', { ok: result.ok, replanned: 'replanned' in result ? result.replanned : false });
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date().toISOString();
      this.publish(task, 'step.failed', { error: task.error });
      this.publish(task, 'task.completed', { ok: false, error: task.error });
    }
  }

  private require(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private publish(task: TaskRecord, type: RuntimeEventType, data?: unknown): void {
    this.bus.publish({ id: randomUUID(), type, taskId: task.id, timestamp: new Date().toISOString(), data });
  }
}
