import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, join } from 'node:path';
import type { CapabilityHandler } from './types.js';

const root = resolve(process.env.HERMEIOUS_WORKSPACE ?? process.cwd());

function safePath(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('path is required');
  const candidate = resolve(root, input);
  const rel = relative(root, candidate);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('path escapes workspace');
  return candidate;
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} is required`);
  return value;
}

export const fileReadCapability: CapabilityHandler = {
  manifest: {
    id: 'file.read', version: '1.0.0', provider: 'local',
    description: 'Read UTF-8 text from a workspace file.', interfaces: ['local'],
    inputSchema: { path: { type: 'string' }, maxBytes: { type: 'number' } },
    outputSchema: { type: 'object' }, permissions: ['filesystem.read'], risk: 'medium', tags: ['file', 'filesystem']
  },
  async execute(input) {
    const path = safePath(input.path);
    const info = await stat(path);
    if (!info.isFile()) throw new Error('path is not a file');
    const maxBytes = typeof input.maxBytes === 'number' ? Math.max(1, Math.floor(input.maxBytes)) : 5_000_000;
    if (info.size > maxBytes) throw new Error(`file exceeds maxBytes (${maxBytes})`);
    return { path: relative(root, path), content: await readFile(path, 'utf8'), size: info.size };
  }
};

export const fileWriteCapability: CapabilityHandler = {
  manifest: {
    id: 'file.write', version: '1.0.0', provider: 'local',
    description: 'Write UTF-8 text to a workspace file.', interfaces: ['local'],
    inputSchema: { path: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } },
    outputSchema: { type: 'object' }, permissions: ['filesystem.write'], risk: 'high', tags: ['file', 'filesystem']
  },
  async execute(input) {
    const path = safePath(input.path);
    const content = text(input.content, 'content');
    await writeFile(path, content, { encoding: 'utf8', flag: input.append === true ? 'a' : 'w' });
    return { path: relative(root, path), bytes: Buffer.byteLength(content, 'utf8'), appended: input.append === true };
  }
};

export const fileBrowserCapability: CapabilityHandler = {
  manifest: {
    id: 'file.list', version: '1.0.0', provider: 'local',
    description: 'List entries in the workspace or a workspace subdirectory.', interfaces: ['local'],
    inputSchema: { path: { type: 'string' } }, outputSchema: { type: 'array' },
    permissions: ['filesystem.read'], risk: 'medium', tags: ['file', 'browser', 'filesystem']
  },
  async execute(input) {
    const path = safePath(typeof input.path === 'string' ? input.path : '.');
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
  }
};

export interface HttpCapabilityConfig { id: string; description: string; endpointEnv: string; risk?: 'low' | 'medium' | 'high' | 'critical'; permissions?: string[]; tags?: string[]; }

export function httpCapability(config: HttpCapabilityConfig): CapabilityHandler {
  return {
    manifest: {
      id: config.id, version: '1.0.0', provider: 'http', description: config.description,
      interfaces: ['http'], inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
      permissions: config.permissions ?? ['network.outbound'], risk: config.risk ?? 'high', tags: config.tags
    },
    async execute(input, context) {
      if (context.signal?.aborted) throw new Error('execution aborted');
      const endpoint = process.env[config.endpointEnv];
      if (!endpoint) throw new Error(`${config.endpointEnv} is not configured`);
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capability: config.id, input, requestId: context.requestId }), signal: context.signal
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`${config.id} provider returned ${response.status}: ${body.slice(0, 500)}`);
      try { return JSON.parse(body); } catch { return { output: body }; }
    }
  };
}

export const realCapabilities: CapabilityHandler[] = [
  fileReadCapability,
  fileWriteCapability,
  fileBrowserCapability,
  httpCapability({ id: 'search.web', description: 'Search the web through a configured search provider.', endpointEnv: 'HERMEIOUS_SEARCH_URL', risk: 'medium', permissions: ['network.outbound'], tags: ['search', 'web'] }),
  httpCapability({ id: 'code.execute', description: 'Execute code through a configured sandbox provider.', endpointEnv: 'HERMEIOUS_CODE_EXECUTOR_URL', risk: 'critical', permissions: ['code.execute'], tags: ['code', 'sandbox'] }),
  httpCapability({ id: 'document.pdf', description: 'Create or transform PDF documents through a configured document provider.', endpointEnv: 'HERMEIOUS_PDF_URL', risk: 'high', tags: ['pdf', 'document'] }),
  httpCapability({ id: 'document.docx', description: 'Create or transform DOCX documents through a configured document provider.', endpointEnv: 'HERMEIOUS_DOCX_URL', risk: 'high', tags: ['docx', 'document'] }),
  httpCapability({ id: 'document.xlsx', description: 'Create or transform XLSX workbooks through a configured document provider.', endpointEnv: 'HERMEIOUS_XLSX_URL', risk: 'high', tags: ['xlsx', 'spreadsheet'] }),
  httpCapability({ id: 'image.generate', description: 'Generate images through a configured image provider.', endpointEnv: 'HERMEIOUS_IMAGE_URL', risk: 'high', tags: ['image', 'generation'] }),
  httpCapability({ id: 'video.generate', description: 'Generate video through a configured video provider.', endpointEnv: 'HERMEIOUS_VIDEO_URL', risk: 'high', tags: ['video', 'generation'] })
];
