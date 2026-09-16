import type { CapabilityManifest } from './types.js';
import { CapabilityRegistry } from './registry.js';

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9_.-]+/).filter(Boolean));
}

export interface RouteCandidate { capability: string; score: number; manifest: CapabilityManifest; }

export class CapabilityRouter {
  constructor(private readonly registry: CapabilityRegistry) {}

  route(goal: string, limit = 8): RouteCandidate[] {
    const query = tokens(goal);
    return this.registry.list()
      .map(manifest => {
        const haystack = tokens([manifest.id, manifest.description, ...(manifest.tags ?? [])].join(' '));
        let score = 0;
        for (const token of query) if (haystack.has(token)) score += 1;
        if (manifest.id.startsWith('system.')) score *= 0.5;
        return { capability: manifest.id, score, manifest };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
