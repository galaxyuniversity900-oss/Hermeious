import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep, dirname } from 'node:path';
export interface WorkspaceFile { path: string; size: number; modifiedAt: string; }
export class LocalWorkspace {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  private safe(path: string): string { const target = resolve(this.root, path); if (target !== this.root && !target.startsWith(this.root + sep)) throw new Error('workspace_path_outside_root'); return target; }
  async init(): Promise<void> { await mkdir(this.root, { recursive: true }); }
  async read(path: string): Promise<string> { return readFile(this.safe(path), 'utf8'); }
  async write(path: string, content: string): Promise<void> { const target = this.safe(path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }
  async list(): Promise<WorkspaceFile[]> { await this.init(); const out: WorkspaceFile[] = []; const walk = async (dir: string): Promise<void> => { for (const entry of await readdir(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (entry.isDirectory()) await walk(p); else { const s = await stat(p); out.push({ path: p.slice(this.root.length + 1), size: s.size, modifiedAt: s.mtime.toISOString() }); } } }; await walk(this.root); return out; }
}
