import { createHash } from 'node:crypto';

export interface CacheKeyInput { goal?: string; capability: string; version: string; input: unknown; dependencyOutputs?: Record<string, unknown>; constraints?: unknown; }
export interface CacheEntry<T = unknown> { key: string; value: T; createdAt: string; expiresAt?: string; qualityScore?: number; provenance?: Record<string, unknown>; }
export interface CapabilityCache<T = unknown> { get(key: string): CacheEntry<T> | undefined; set(key: string, entry: CacheEntry<T>): void; delete(key: string): boolean; clear(): void; size(): number; }

export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(',')}}`;
}
export function dependencyAwareCacheKey(input: CacheKeyInput): string {
  const canonical = stableSerialize({ goal: input.goal?.trim().replace(/\s+/g, ' ').toLowerCase(), capability: input.capability, version: input.version, input: input.input, dependencyOutputs: input.dependencyOutputs ?? {}, constraints: input.constraints ?? {} });
  return createHash('sha256').update(canonical).digest('hex');
}
export class InMemoryCapabilityCache<T = unknown> implements CapabilityCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  constructor(private readonly ttlMs = 0) {}
  get(key: string): CacheEntry<T> | undefined { const e = this.entries.get(key); if (!e) return undefined; if (e.expiresAt && Date.parse(e.expiresAt) <= Date.now()) { this.entries.delete(key); return undefined; } return e; }
  set(key: string, entry: CacheEntry<T>): void { const expiresAt = entry.expiresAt ?? (this.ttlMs > 0 ? new Date(Date.now() + this.ttlMs).toISOString() : undefined); this.entries.set(key, { ...entry, key, expiresAt }); }
  delete(key: string): boolean { return this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
  size(): number { return this.entries.size; }
}
