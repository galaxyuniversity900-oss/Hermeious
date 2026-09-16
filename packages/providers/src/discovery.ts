import type { CapabilityDiscoveryCandidate, ProviderBinding } from './provider-types.js';

export class CapabilityDiscovery {
  private readonly candidates: CapabilityDiscoveryCandidate[] = [];

  register(candidate: CapabilityDiscoveryCandidate): void {
    if (candidate.trust === 'blocked') return;
    const existing = this.candidates.findIndex(item =>
      item.provider.providerId === candidate.provider.providerId &&
      item.provider.logicalCapability === candidate.provider.logicalCapability
    );
    if (existing >= 0) this.candidates[existing] = candidate;
    else this.candidates.push(candidate);
  }

  discover(logicalCapability: string, options: { trustedOnly?: boolean } = {}): CapabilityDiscoveryCandidate[] {
    return this.candidates
      .filter(candidate => candidate.provider.logicalCapability === logicalCapability)
      .filter(candidate => !options.trustedOnly || candidate.trust === 'trusted')
      .map(candidate => ({ ...candidate, provider: { ...candidate.provider } }));
  }

  trust(providerId: string, logicalCapability: string): void {
    const candidate = this.candidates.find(item =>
      item.provider.providerId === providerId && item.provider.logicalCapability === logicalCapability
    );
    if (!candidate) throw new Error(`Discovery candidate not found: ${providerId}/${logicalCapability}`);
    candidate.trust = 'trusted';
  }

  list(): CapabilityDiscoveryCandidate[] {
    return this.candidates.map(candidate => ({ ...candidate, provider: { ...candidate.provider } }));
  }

  static fromManifest(manifest: Record<string, unknown>, source: string, trust: CapabilityDiscoveryCandidate['trust'] = 'review'): CapabilityDiscoveryCandidate {
    const provider = manifest.provider as Record<string, unknown> | undefined;
    if (!provider?.id || !manifest.capabilityId) throw new Error('Discovery manifest requires provider.id and capabilityId');
    const binding: ProviderBinding = {
      providerId: String(provider.id),
      logicalCapability: String(manifest.capabilityId),
      capabilityId: String(manifest.implementationId ?? manifest.capabilityId),
      kind: (provider.kind as ProviderBinding['kind']) ?? 'http',
      endpoint: provider.endpoint ? String(provider.endpoint) : undefined,
      priority: Number(provider.priority ?? 0),
      costScore: Number(provider.costScore ?? 0.5),
      latencyScore: Number(provider.latencyScore ?? 0.5),
      qualityScore: Number(provider.qualityScore ?? 0.7),
      tags: Array.isArray(manifest.tags) ? manifest.tags.map(String) : undefined
    };
    return { provider: binding, manifest, source, trust };
  }
}
