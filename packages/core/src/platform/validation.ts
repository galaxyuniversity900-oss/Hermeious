export interface QualityRule<T = unknown> { id: string; description: string; validate(value: T): { ok: boolean; message?: string }; }

export interface QualityReport { ok: boolean; score: number; failures: string[]; warnings: string[]; }

export function validateQuality<T>(value: T, rules: QualityRule<T>[]): QualityReport {
  const failures: string[] = [];
  for (const rule of rules) {
    const result = rule.validate(value);
    if (!result.ok) failures.push(result.message ?? rule.id);
  }
  return { ok: failures.length === 0, score: rules.length ? (rules.length - failures.length) / rules.length : 1, failures, warnings: [] };
}

export const rules = {
  requiredKeys: (keys: string[]): QualityRule<Record<string, unknown>> => ({
    id: 'required-keys', description: 'Required output keys exist',
    validate(value) { const missing = keys.filter(k => !(k in value)); return { ok: missing.length === 0, message: missing.length ? `Missing keys: ${missing.join(', ')}` : undefined }; }
  })
};
