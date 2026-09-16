import type { CapabilityContract, CapabilityInvocation, CapabilityOutcome } from './contracts.js';

export interface CapabilityPlugin<I = unknown, O = unknown> {
  contract: CapabilityContract<I, O>;
  execute(invocation: CapabilityInvocation<I>): Promise<CapabilityOutcome<O>>;
  health?(): Promise<{ ok: boolean; message?: string }>;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, CapabilityPlugin>();
  register(plugin: CapabilityPlugin): void {
    if (this.plugins.has(plugin.contract.id)) throw new Error(`Capability already registered: ${plugin.contract.id}`);
    this.plugins.set(plugin.contract.id, plugin);
  }
  get(id: string): CapabilityPlugin | undefined { return this.plugins.get(id); }
  list(): CapabilityContract[] { return [...this.plugins.values()].map(p => p.contract); }
}
