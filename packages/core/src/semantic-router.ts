import type { CapabilityManifest } from './types.js';
import { CapabilityRegistry } from './registry.js';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export interface CapabilityRouteConstraints {
  requiredInputs?: string[];
  requiredOutputs?: string[];
  maxCost?: number;
  maxLatencyMs?: number;
  allowedRisks?: Array<CapabilityManifest['risk']>;
  interfaces?: CapabilityManifest['interfaces'];
}

export interface SemanticRouteOptions {
  limit?: number;
  constraints?: CapabilityRouteConstraints;
  embeddingProvider?: EmbeddingProvider;
  minScore?: number;
}

export interface SemanticRouteCandidate {
  capability: string;
  score: number;
  semanticScore: number;
  lexicalScore: number;
  inputCompatibility: number;
  outputCompatibility: number;
  manifest: CapabilityManifest;
}

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9_.-]+/).filter(Boolean));
}

function overlap(required: string[] | undefined, available: string[]): number {
  if (!required?.length) return 1;
  if (!available.length) return 0;
  const haystack = new Set(available.map(value => value.toLowerCase()));
  const matched = required.filter(value => haystack.has(value.toLowerCase())).length;
  return matched / required.length;
}

function lexicalSimilarity(query: string, manifest: CapabilityManifest): number {
  const queryTokens = tokens(query);
  if (!queryTokens.size) return 0;
  const searchable = [
    manifest.id,
    manifest.description,
    ...(manifest.tags ?? []),
    ...(manifest.aliases ?? []),
    ...(manifest.examples ?? [])
  ].join(' ');
  const haystack = tokens(searchable);
  let matches = 0;
  for (const token of queryTokens) if (haystack.has(token)) matches++;
  return matches / queryTokens.size;
}

function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!aa || !bb) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(aa) * Math.sqrt(bb))));
}

export class SemanticCapabilityRouter {
  constructor(private readonly registry: CapabilityRegistry) {}

  async route(goal: string, options: SemanticRouteOptions = {}): Promise<SemanticRouteCandidate[]> {
    const limit = options.limit ?? 8;
    const manifests = this.registry.list();
    const queryEmbedding = options.embeddingProvider ? await options.embeddingProvider.embed(goal) : undefined;
    const results = await Promise.all(manifests.map(async manifest => {
      const lexicalScore = lexicalSimilarity(goal, manifest);
      const semanticScore = queryEmbedding && options.embeddingProvider
        ? cosine(queryEmbedding, await options.embeddingProvider.embed(this.searchText(manifest)))
        : lexicalScore;

      const inputCompatibility = overlap(options.constraints?.requiredInputs, this.schemaKeys(manifest.inputSchema));
      const outputCompatibility = overlap(options.constraints?.requiredOutputs, this.schemaKeys(manifest.outputSchema));
      const c = options.constraints;
      if (c?.allowedRisks && !c.allowedRisks.includes(manifest.risk)) return undefined;
      if (c?.interfaces?.length && !manifest.interfaces.some(i => c.interfaces!.includes(i))) return undefined;

      const score = this.score(manifest, semanticScore, lexicalScore, inputCompatibility, outputCompatibility, c);
      return {
        capability: manifest.id,
        score,
        semanticScore,
        lexicalScore,
        inputCompatibility,
        outputCompatibility,
        manifest
      } satisfies SemanticRouteCandidate;
    }));

    return results
      .filter((candidate): candidate is SemanticRouteCandidate => Boolean(candidate) && candidate.score >= (options.minScore ?? 0))
      .sort((a, b) => b.score - a.score || a.capability.localeCompare(b.capability))
      .slice(0, limit);
  }

  private score(
    manifest: CapabilityManifest,
    semantic: number,
    lexical: number,
    inputCompatibility: number,
    outputCompatibility: number,
    constraints?: CapabilityRouteConstraints
  ): number {
    let score = semantic * 0.45 + lexical * 0.25 + inputCompatibility * 0.15 + outputCompatibility * 0.15;
    const metadata = manifest.metadata ?? {};
    const cost = typeof metadata.cost === 'number' ? metadata.cost : undefined;
    const latency = typeof metadata.latencyMs === 'number' ? metadata.latencyMs : undefined;
    if (constraints?.maxCost !== undefined && cost !== undefined) score *= cost <= constraints.maxCost ? 1 : 0.2;
    if (constraints?.maxLatencyMs !== undefined && latency !== undefined) score *= latency <= constraints.maxLatencyMs ? 1 : 0.2;
    if (manifest.risk === 'critical') score *= 0.65;
    else if (manifest.risk === 'high') score *= 0.8;
    return score;
  }

  private schemaKeys(schema: Record<string, unknown>): string[] {
    const properties = schema.properties;
    return properties && typeof properties === 'object' ? Object.keys(properties as Record<string, unknown>) : [];
  }

  private searchText(manifest: CapabilityManifest): string {
    return [manifest.id, manifest.description, ...(manifest.tags ?? []), ...(manifest.aliases ?? []), ...(manifest.examples ?? [])].join(' ');
  }
}
