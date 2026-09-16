import type { CapabilityManifest } from './types.js';

export interface DiscoveredCapability {
  manifest: CapabilityManifest;
  source: string;
}

export class CapabilityDiscovery {
  async fromManifestUrl(url: string): Promise<DiscoveredCapability> {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Discovery HTTP ${response.status}`);
    const manifest = await response.json() as CapabilityManifest;
    this.validate(manifest);
    return { manifest, source: url };
  }

  validate(manifest: CapabilityManifest): void {
    if (!manifest?.id || !manifest.version || !manifest.description) throw new Error('Invalid capability manifest');
    if (!Array.isArray(manifest.interfaces) || manifest.interfaces.length === 0) throw new Error('Manifest interfaces required');
    if (!Array.isArray(manifest.permissions)) throw new Error('Manifest permissions required');
    if (!['low', 'medium', 'high', 'critical'].includes(manifest.risk)) throw new Error('Invalid manifest risk');
  }
}
