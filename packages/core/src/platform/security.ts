export type AuditAction = 'capability.execute' | 'provider.select' | 'approval.request' | 'approval.decision' | 'artifact.create' | 'workflow.replan';
export interface AuditEntry { id: string; timestamp: string; action: AuditAction; actor: string; taskId?: string; capability?: string; provider?: string; metadata?: Record<string, unknown>; }

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  append(entry: AuditEntry): void { this.entries.push(Object.freeze({ ...entry })); }
  list(taskId?: string): AuditEntry[] { return taskId ? this.entries.filter(e => e.taskId === taskId) : [...this.entries]; }
}

export function assertSafeProviderUrl(raw: string, allowHosts: string[]): URL {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported provider protocol');
  if (url.username || url.password) throw new Error('Provider URL credentials are not allowed');
  if (!allowHosts.includes(url.hostname)) throw new Error(`Provider host not allowed: ${url.hostname}`);
  return url;
}
