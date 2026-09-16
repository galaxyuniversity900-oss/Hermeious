import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

export interface ArtifactContent {
  bytes: Buffer;
  checksum: string;
  size: number;
}

export class ArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly content = new Map<string, Buffer>();
  private readonly root?: string;

  constructor(rootDir?: string) {
    this.root = rootDir ? resolve(rootDir) : undefined;
    if (this.root) mkdirSync(this.root, { recursive: true });
  }

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

  putContent(id: string, data: Buffer | string): ArtifactContent {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    const bytes = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, 'utf8');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    this.content.set(id, bytes);
    if (this.root) writeFileSync(this.pathFor(id), bytes, { flag: 'w' });
    const updated = this.version(id, { size: bytes.length, checksum });
    return { bytes, checksum: updated.checksum!, size: updated.size! };
  }

  hasContent(id: string): boolean {
    return this.content.has(id) || Boolean(this.root && this.existsOnDisk(id));
  }

  readContent(id: string): ArtifactContent {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    const memory = this.content.get(id);
    const bytes = memory ? Buffer.from(memory) : this.root && this.existsOnDisk(id) ? readFileSync(this.pathFor(id)) : undefined;
    if (!bytes) throw new Error(`Artifact content not found: ${id}`);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    return { bytes, checksum, size: bytes.length };
  }

  deleteContent(id: string): void {
    this.content.delete(id);
    if (this.root) rmSync(this.pathFor(id), { force: true });
  }

  private pathFor(id: string): string {
    if (!this.root) throw new Error('Artifact filesystem storage is disabled');
    return join(this.root, `${id}.bin`);
  }

  private existsOnDisk(id: string): boolean {
    try {
      readFileSync(this.pathFor(id), { flag: 'r' });
      return true;
    } catch {
      return false;
    }
  }
}
