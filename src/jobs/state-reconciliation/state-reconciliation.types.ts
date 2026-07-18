export type DriftType =
  | 'missing_loan_row'
  | 'stale_loan_status'
  | 'provisional_loan_id'
  | 'orphaned_pending_transaction'
  | 'missing_transaction_row'
  | 'stale_liquidity_position'
  | 'stale_reputation';

export interface DriftItem {
  type: DriftType;
  key: string;
  repaired: boolean;
  details: Record<string, unknown>;
}

export interface DriftReport {
  startedAt: string;
  completedAt: string;
  driftCount: number;
  repairedCount: number;
  byType: Record<DriftType, number>;
  items: DriftItem[];
}
