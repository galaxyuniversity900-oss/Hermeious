import type { CapabilityManifest } from './types.js';
import { CapabilityRegistry } from './registry.js';

function tokens(value: string): Set<string> { return new Set(value.toLowerCase().split(/[^a-z0-9_.-]+/).filter(Boolean)); }
function keyOverlap(query: Set<string>, values: string[]): number { if (!query.size || !values.length) return 0; let hits = 0; for (const value of values) if (query.has(value.toLowerCase())) hits++; return hits / Math.max(1, query.size); }
export interface RouteCandidate { capability: string; score: number; manifest: CapabilityManifest; }

export class CapabilityRouter {
  constructor(private readonly registry: CapabilityRegistry) {}
  route(goal: string, limit = 8): RouteCandidate[] {
    const query = tokens(goal);
    return this.registry.list().map(manifest => {
      const haystack = tokens([manifest.id, manifest.description, ...(manifest.tags ?? []), ...(manifest.aliases ?? []), ...(manifest.examples ?? [])].join(' '));
      let lexicalHits = 0; for (const token of query) if (haystack.has(token)) lexicalHits++;
      const lexical = query.size ? lexicalHits / query.size : 0;
      const inputKeys = this.schemaKeys(manifest.inputSchema); const outputKeys = this.schemaKeys(manifest.outputSchema);
      const io = (keyOverlap(query, inputKeys) + keyOverlap(query, outputKeys)) * 0.5;
      let score = lexical * 0.8 + io * 0.2;
      const reliability = typeof manifest.metadata?.reliability === 'number' ? manifest.metadata.reliability : 1;
      score *= Math.max(0.1, Math.min(1, reliability));
      if (manifest.id.startsWith('system.')) score *= 0.5;
      return { capability: manifest.id, score, manifest };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.capability.localeCompare(b.capability)).slice(0, limit);
  }
  private schemaKeys(schema: Record<string, unknown>): string[] { const properties = schema.properties; return properties && typeof properties === 'object' ? Object.keys(properties as Record<string, unknown>) : []; }
}
