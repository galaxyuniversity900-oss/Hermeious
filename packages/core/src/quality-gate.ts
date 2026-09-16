import { rules, validateQuality, type QualityReport, type QualityRule } from './platform/validation.js';
export interface QualityEvaluator { evaluate(input: { capability: string; goal?: string; output: unknown; expectedOutputSchema?: Record<string, unknown> }): Promise<{ score: number; ok: boolean; reasons?: string[] }>; }
export interface QualityGateOptions { minScore?: number; rules?: QualityRule<any>[]; evaluator?: QualityEvaluator; expectedKeys?: string[]; }
export interface QualityGateResult extends QualityReport { evaluatorScore?: number; evaluatorReasons?: string[]; }
export async function runQualityGate(output: unknown, options: QualityGateOptions = {}, context: { capability?: string; goal?: string; expectedOutputSchema?: Record<string, unknown> } = {}): Promise<QualityGateResult> {
  const baseRules = [...(options.rules ?? [])];
  if (options.expectedKeys?.length && isRecord(output)) baseRules.push(rules.requiredKeys(options.expectedKeys));
  const deterministic = validateQuality(output, baseRules);
  let score = deterministic.score; const failures = [...deterministic.failures]; const warnings = [...deterministic.warnings];
  let evaluatorScore: number | undefined; let evaluatorReasons: string[] | undefined;
  if (options.evaluator) { const evaluated = await options.evaluator.evaluate({ capability: context.capability ?? '', goal: context.goal, output, expectedOutputSchema: context.expectedOutputSchema }); evaluatorScore = Math.max(0, Math.min(1, evaluated.score)); score = (score + evaluatorScore) / 2; evaluatorReasons = evaluated.reasons ?? []; if (!evaluated.ok) failures.push(...evaluatorReasons); else warnings.push(...evaluatorReasons); }
  const minScore = options.minScore ?? 1;
  return { ok: failures.length === 0 && score >= minScore, score, failures, warnings, evaluatorScore, evaluatorReasons };
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
