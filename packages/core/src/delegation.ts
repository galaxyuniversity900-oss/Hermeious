import { randomUUID } from 'node:crypto';
export interface DelegatedTask { id: string; goal: string; parentTaskId?: string; status: 'queued'|'running'|'completed'|'failed'; result?: unknown; error?: string; }
export type Worker = (goal: string, context?: Record<string, unknown>) => Promise<unknown>;
export class DelegationManager {
  private readonly tasks = new Map<string, DelegatedTask>();
  constructor(private readonly worker: Worker) {}
  list(): DelegatedTask[] { return [...this.tasks.values()]; }
  async delegate(goal: string, parentTaskId?: string): Promise<DelegatedTask> { if (!goal.trim()) throw new Error('delegation_goal_required'); const task: DelegatedTask = { id: randomUUID(), goal, parentTaskId, status: 'queued' }; this.tasks.set(task.id, task); task.status = 'running'; try { task.result = await this.worker(goal, { taskId: task.id, parentTaskId }); task.status = 'completed'; } catch (e) { task.status = 'failed'; task.error = e instanceof Error ? e.message : String(e); } return task; }
}
