import { randomUUID } from 'node:crypto';

export interface Artifact {
  id: string;
  name: string;
  kind: 'file' | 'data' | 'stream';
  mimeType: string;
  size?: number;
  uri: string;
  checksum?: string;
  version: number;
  sourceStep?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class ArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();

  create(input: Omit<Artifact, 'id' | 'version' | 'createdAt'>): Artifact {
    const artifact: Artifact = { ...input, id: randomUUID(), version: 1, createdAt: new Date().toISOString() };
    this.artifacts.set(artifact.id, artifact);
    return artifact;
  }

  get(id: string): Artifact | undefined { return this.artifacts.get(id); }
  list(): Artifact[] { return [...this.artifacts.values()]; }

  version(id: string, patch: Partial<Omit<Artifact, 'id' | 'version' | 'createdAt'>>): Artifact {
    const current = this.artifacts.get(id);
    if (!current) throw new Error(`Artifact not found: ${id}`);
    const next = { ...current, ...patch, version: current.version + 1 };
    this.artifacts.set(id, next);
    return next;
  }
}
