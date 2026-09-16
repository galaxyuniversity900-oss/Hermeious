import { isIP } from 'node:net';

export type AuditAction = 'capability.execute' | 'provider.select' | 'approval.request' | 'approval.decision' | 'artifact.create' | 'workflow.replan';
export interface AuditEntry { id: string; timestamp: string; action: AuditAction; actor: string; taskId?: string; capability?: string; provider?: string; metadata?: Record<string, unknown>; }

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  append(entry: AuditEntry): void { this.entries.push(Object.freeze({ ...entry })); }
  list(taskId?: string): AuditEntry[] { return taskId ? this.entries.filter(e => e.taskId === taskId) : [...this.entries]; }
}

function isPrivateIp(hostname: string): boolean {
  const version = isIP(hostname);
  if (version === 4) {
    const [a, b] = hostname.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0;
  }
  if (version === 6) {
    const value = hostname.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }
  return false;
}

export function assertSafeProviderUrl(raw: string, allowHosts: string[]): URL {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported provider protocol');
  if (url.username || url.password) throw new Error('Provider URL credentials are not allowed');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (isPrivateIp(hostname)) throw new Error(`Provider host resolves to a private address: ${hostname}`);
  const allowed = allowHosts.map(host => host.toLowerCase().replace(/\.$/, ''));
  if (!allowed.includes(hostname)) throw new Error(`Provider host not allowed: ${hostname}`);
  return url;
}
