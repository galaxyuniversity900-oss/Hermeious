export type Risk = 'low' | 'medium' | 'high' | 'critical';
export type InterfaceType = 'local' | 'http' | 'mcp';

export interface CapabilityManifest {
  id: string;
  version: string;
  description: string;
  interfaces: InterfaceType[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  permissions: string[];
  risk: Risk;
  provider?: string;
}

export interface CapabilityContext {
  requestId: string;
  approved: boolean;
  signal?: AbortSignal;
}

export interface CapabilityHandler {
  manifest: CapabilityManifest;
  execute(input: Record<string, unknown>, context: CapabilityContext): Promise<unknown>;
}

export class CapabilityRegistry {
  private readonly handlers = new Map<string, CapabilityHandler>();

  register(handler: CapabilityHandler): void {
    if (this.handlers.has(handler.manifest.id)) throw new Error(`Capability already registered: ${handler.manifest.id}`);
    this.handlers.set(handler.manifest.id, handler);
  }

  get(id: string): CapabilityHandler | undefined { return this.handlers.get(id); }
  list(): CapabilityManifest[] { return [...this.handlers.values()].map(h => h.manifest); }

  async execute(id: string, input: Record<string, unknown>, context: CapabilityContext): Promise<unknown> {
    const handler = this.get(id);
    if (!handler) throw new Error(`Capability not found: ${id}`);
    if (!context.approved && handler.manifest.risk !== 'low') {
      throw new Error(`Capability requires approval: ${id}`);
    }
    return handler.execute(input, context);
  }
}
