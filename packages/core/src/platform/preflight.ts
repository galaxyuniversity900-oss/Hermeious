import type { CapabilityManifest } from '../types.js';
import type { CapabilityPlan } from '../composer.js';
import { CapabilityRegistry } from '../registry.js';
export interface PreflightIssue { stepId?: string; capability?: string; severity: 'error'|'warning'; code: string; message: string; }
export interface PreflightReport { ok: boolean; issues: PreflightIssue[]; checkedSteps: number; }
export function validatePlanPreflight(plan: CapabilityPlan, registry: CapabilityRegistry, approved = false): PreflightReport {
  const issues: PreflightIssue[] = []; const ids = new Set<string>();
  for (const step of plan.steps) { if (ids.has(step.id)) issues.push({ stepId: step.id, severity: 'error', code: 'duplicate_step', message: `Duplicate step: ${step.id}` }); ids.add(step.id); }
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) if (!ids.has(dep)) issues.push({ stepId: step.id, severity: 'error', code: 'unknown_dependency', message: `Unknown dependency: ${dep}` });
    const manifest = registry.get(step.capability)?.manifest;
    if (!manifest) { issues.push({ stepId: step.id, capability: step.capability, severity: 'error', code: 'missing_capability', message: `Capability not registered: ${step.capability}` }); continue; }
    if (!approved && manifest.risk !== 'low') issues.push({ stepId: step.id, capability: step.capability, severity: 'error', code: 'approval_required', message: `Capability requires approval: ${step.capability}` });
    const required = Array.isArray(manifest.inputSchema?.required) ? manifest.inputSchema.required : [];
    const input = step.input ?? {};
    for (const key of required) if (typeof key === 'string' && !(key in input) && !(step.inputBindings ?? []).some(b => b.inputKey === key)) issues.push({ stepId: step.id, capability: step.capability, severity: 'error', code: 'missing_input', message: `Missing required input: ${key}` });
  }
  return { ok: issues.every(i => i.severity !== 'error'), issues, checkedSteps: plan.steps.length };
}
export function manifestRequiredInputs(manifest: CapabilityManifest): string[] { return Array.isArray(manifest.inputSchema?.required) ? manifest.inputSchema.required.filter((x): x is string => typeof x === 'string') : []; }
