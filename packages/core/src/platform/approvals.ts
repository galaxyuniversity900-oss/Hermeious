export interface ApprovalRequest {
  id: string;
  taskId: string;
  action: string;
  risk: 'medium' | 'high' | 'critical';
  reason: string;
  estimatedCost?: number;
  createdAt: string;
}

export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export class ApprovalManager {
  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly decisions = new Map<string, ApprovalDecision>();

  request(input: Omit<ApprovalRequest, 'createdAt'>): ApprovalRequest {
    const value = { ...input, createdAt: new Date().toISOString() };
    this.requests.set(value.id, value);
    this.decisions.set(value.id, 'pending');
    return value;
  }
  decide(id: string, decision: Exclude<ApprovalDecision, 'pending'>): void {
    if (!this.requests.has(id)) throw new Error(`Approval not found: ${id}`);
    this.decisions.set(id, decision);
  }
  status(id: string): ApprovalDecision { return this.decisions.get(id) ?? 'rejected'; }
  list(): Array<ApprovalRequest & { decision: ApprovalDecision }> {
    return [...this.requests.values()].map(request => ({ ...request, decision: this.status(request.id) }));
  }
}
