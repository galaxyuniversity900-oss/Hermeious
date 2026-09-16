export type CapabilityRequirement = {
  capability: string;
  requiredInputs?: string[];
  expectedOutputs?: string[];
  constraints?: { quality?: number; latencyMs?: number; costLimit?: number };
};

export type CapabilityStep = {
  id: string;
  capability: string;
  input?: Record<string, unknown>;
  dependsOn: string[];
  optional?: boolean;
};

export type CapabilityPlan = {
  id: string;
  goal: string;
  steps: CapabilityStep[];
};

export type CapabilityTemplate = {
  id: string;
  description: string;
  requires: string[];
  produces: string[];
  steps: Array<{ id: string; capability: string; dependsOn?: string[]; optional?: boolean }>;
};

export class CapabilityComposer {
  private readonly templates = new Map<string, CapabilityTemplate>();

  registerTemplate(template: CapabilityTemplate): void {
    if (!template.id || template.steps.length === 0) throw new Error('Invalid capability template');
    this.templates.set(template.id, template);
  }

  listTemplates(): CapabilityTemplate[] {
    return [...this.templates.values()];
  }

  compose(goal: string, requirements: CapabilityRequirement[], templateId?: string): CapabilityPlan {
    if (!goal.trim()) throw new Error('goal is required');
    const template = templateId ? this.templates.get(templateId) : undefined;
    if (templateId && !template) throw new Error(`Unknown capability template: ${templateId}`);

    const steps: CapabilityStep[] = template
      ? template.steps.map(step => ({ ...step, dependsOn: [...(step.dependsOn ?? [])] }))
      : requirements.map((req, index) => ({
          id: `step-${index + 1}`,
          capability: req.capability,
          dependsOn: index === 0 ? [] : [`step-${index}`]
        }));

    this.validateDag(steps);
    return { id: `plan-${Date.now().toString(36)}`, goal, steps };
  }

  topologicalOrder(plan: CapabilityPlan): CapabilityStep[] {
    const byId = new Map(plan.steps.map(step => [step.id, step]));
    const indegree = new Map(plan.steps.map(step => [step.id, step.dependsOn.length]));
    const outgoing = new Map<string, string[]>();
    for (const step of plan.steps) {
      for (const dependency of step.dependsOn) {
        const list = outgoing.get(dependency) ?? [];
        list.push(step.id);
        outgoing.set(dependency, list);
      }
    }
    const queue = plan.steps.filter(step => indegree.get(step.id) === 0).map(step => step.id);
    const ordered: CapabilityStep[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      ordered.push(byId.get(id)!);
      for (const next of outgoing.get(id) ?? []) {
        indegree.set(next, indegree.get(next)! - 1);
        if (indegree.get(next) === 0) queue.push(next);
      }
    }
    if (ordered.length !== plan.steps.length) throw new Error('Capability plan contains a dependency cycle');
    return ordered;
  }

  private validateDag(steps: CapabilityStep[]): void {
    const ids = new Set<string>();
    for (const step of steps) {
      if (ids.has(step.id)) throw new Error(`Duplicate plan step: ${step.id}`);
      ids.add(step.id);
    }
    for (const step of steps) {
      for (const dependency of step.dependsOn) {
        if (!ids.has(dependency)) throw new Error(`Unknown dependency: ${dependency}`);
      }
    }
    this.topologicalOrder({ id: 'validation', goal: 'validation', steps });
  }
}
