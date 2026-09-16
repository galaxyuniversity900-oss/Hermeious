import type { CapabilityHandler } from './registry.js';

export const echoCapability: CapabilityHandler = {
  manifest: {
    id: 'system.echo', version: '1.0.0', provider: 'builtin',
    description: 'Return the supplied payload unchanged.', interfaces: ['local'],
    inputSchema: { type: 'object' }, outputSchema: { type: 'object' },
    permissions: [], risk: 'low'
  },
  async execute(input) { return input; }
};

export const fileMetadataCapability: CapabilityHandler = {
  manifest: {
    id: 'file.metadata', version: '1.0.0', provider: 'builtin',
    description: 'Read metadata for a file path explicitly supplied by the caller.', interfaces: ['local'],
    inputSchema: { path: { type: 'string' } }, outputSchema: { type: 'object' },
    permissions: ['filesystem.read'], risk: 'medium'
  },
  async execute(input) {
    const path = input.path;
    if (typeof path !== 'string' || path.length === 0) throw new Error('path is required');
    const { stat } = await import('node:fs/promises');
    const info = await stat(path);
    return { path, size: info.size, isFile: info.isFile(), isDirectory: info.isDirectory(), modifiedAt: info.mtime.toISOString() };
  }
};
