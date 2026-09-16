export interface Budget { maxCost?: number; maxLatencyMs?: number; }
export interface Spend { cost: number; latencyMs: number; }

export class CostController {
  constructor(private readonly budget: Budget = {}) {}
  canSpend(spend: Spend): boolean {
    return (this.budget.maxCost === undefined || spend.cost <= this.budget.maxCost) &&
      (this.budget.maxLatencyMs === undefined || spend.latencyMs <= this.budget.maxLatencyMs);
  }
  remaining(spent: Spend): Spend {
    return {
      cost: this.budget.maxCost === undefined ? Infinity : Math.max(0, this.budget.maxCost - spent.cost),
      latencyMs: this.budget.maxLatencyMs === undefined ? Infinity : Math.max(0, this.budget.maxLatencyMs - spent.latencyMs)
    };
  }
}
