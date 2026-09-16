import type { CapabilityPlan } from './types.js';
import { CapabilityRouter } from './router.js';

export interface PlannerModel {
  chat(messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>): Promise<string>;
}

const SYSTEM = `You are the Hermeious capability planner. Return ONLY valid JSON.
Schema: {"goal":string,"steps":[{"capability":string,"input":object,"reason":string}]}
Choose only capabilities supplied in the candidate list. Never invent a capability. If no capability is suitable, return steps: [].`;

function parsePlan(raw: string): CapabilityPlan {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Planner returned no JSON object');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!parsed || typeof parsed.goal !== 'string' || !Array.isArray(parsed.steps)) throw new Error('Invalid capability plan');
  return parsed as CapabilityPlan;
}

export class CapabilityPlanner {
  constructor(private readonly model: PlannerModel, private readonly router: CapabilityRouter) {}

  async plan(goal: string): Promise<CapabilityPlan> {
    const candidates = this.router.route(goal);
    const prompt = JSON.stringify(candidates.map(candidate => ({
      id: candidate.capability,
      description: candidate.manifest.description,
      inputSchema: candidate.manifest.inputSchema,
      risk: candidate.manifest.risk,
      tags: candidate.manifest.tags ?? []
    })));
    const raw = await this.model.chat([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Goal: ${goal}\nCandidates: ${prompt}` }
    ]);
    const plan = parsePlan(raw);
    const allowed = new Set(candidates.map(candidate => candidate.capability));
    plan.steps = plan.steps.filter(step => allowed.has(step.capability));
    return plan;
  }
}
