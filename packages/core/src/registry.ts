import type { CapabilityContext, CapabilityHandler, CapabilityManifest } from './types.js';

export class CapabilityRegistry {
  private readonly handlers = new Map<string, CapabilityHandler>();

  register(handler: CapabilityHandler, options: { replace?: boolean } = {}): void {
    if (this.handlers.has(handler.manifest.id) && !options.replace) {
      throw new Error(`Capability already registered: ${handler.manifest.id}`);
    }
    this.handlers.set(handler.manifest.id, handler);
  }

  registerMany(handlers: CapabilityHandler[]): void {
    for (const handler of handlers) this.register(handler);
  }

  get(id: string): CapabilityHandler | undefined { return this.handlers.get(id); }
  list(): CapabilityManifest[] { return [...this.handlers.values()].map(handler => handler.manifest); }

  async execute(id: string, input: Record<string, unknown>, context: CapabilityContext): Promise<unknown> {
    const handler = this.get(id);
    if (!handler) throw new Error(`Capability not found: ${id}`);
    if (!context.approved && handler.manifest.risk !== 'low') {
      throw new Error(`Capability requires approval: ${id}`);
    }
    return handler.execute(input, context);
  }
}
