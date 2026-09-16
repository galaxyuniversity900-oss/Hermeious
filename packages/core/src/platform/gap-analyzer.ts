import type { CapabilityRequirement } from '../composer.js';

export interface CapabilityGap {
  requirement: CapabilityRequirement;
  resolvedCapability?: string;
  candidates: string[];
  missing: boolean;
  reason?: string;
}

export interface CapabilityGapReport {
  goal: string;
  available: string[];
  gaps: CapabilityGap[];
  complete: boolean;
}

export class CapabilityGapAnalyzer {
  constructor(private readonly aliases: Record<string, string[]> = {}) {}

  analyze(goal: string, requirements: CapabilityRequirement[], availableCapabilities: string[]): CapabilityGapReport {
    const available = [...new Set(availableCapabilities)];
    const normalized = new Map(available.map(id => [this.normalize(id), id]));
    const gaps = requirements.map(requirement => {
      const candidates = this.candidates(requirement.capability, available);
      const direct = normalized.get(this.normalize(requirement.capability));
      const alias = candidates.find(id => this.matchesAlias(requirement.capability, id));
      const resolvedCapability = direct ?? alias ?? candidates[0];
      return resolvedCapability
        ? { requirement, resolvedCapability, candidates, missing: false }
        : {
            requirement,
            candidates,
            missing: true,
            reason: `No registered capability satisfies ${requirement.capability}`,
          };
    });

    return { goal, available, gaps, complete: gaps.every(gap => !gap.missing) };
  }

  suggest(capability: string, availableCapabilities: string[]): string[] {
    return this.candidates(capability, availableCapabilities);
  }

  private candidates(capability: string, available: string[]): string[] {
    const target = this.normalize(capability);
    const aliases = (this.aliases[capability] ?? this.aliases[target] ?? []).map(this.normalize);
    return available
      .filter(id => {
        const normalized = this.normalize(id);
        return normalized === target || normalized.includes(target) || target.includes(normalized) || aliases.includes(normalized);
      })
      .sort((a, b) => this.distance(target, a) - this.distance(target, b));
  }

  private matchesAlias(requested: string, candidate: string): boolean {
    const aliases = (this.aliases[requested] ?? this.aliases[this.normalize(requested)] ?? []).map(this.normalize);
    return aliases.includes(this.normalize(candidate));
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  }

  private distance(target: string, candidate: string): number {
    if (target === this.normalize(candidate)) return 0;
    if (this.normalize(candidate).startsWith(target)) return 1;
    if (this.normalize(candidate).includes(target)) return 2;
    return 3;
  }
}
