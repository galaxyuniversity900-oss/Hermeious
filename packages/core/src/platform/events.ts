export type RuntimeEventType = 'task.started' | 'step.started' | 'step.progress' | 'step.completed' | 'step.failed' | 'provider.selected' | 'fallback.started' | 'replan.started' | 'artifact.created' | 'approval.required' | 'task.paused' | 'task.completed';

export interface RuntimeEvent<T = unknown> {
  id: string;
  type: RuntimeEventType;
  taskId: string;
  stepId?: string;
  timestamp: string;
  data?: T;
}

type Listener = (event: RuntimeEvent) => void;

export class EventBus {
  private readonly listeners = new Set<Listener>();
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish(event: RuntimeEvent): void { for (const listener of this.listeners) listener(event); }
}
