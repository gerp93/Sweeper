export interface Reconciliation {
  id: string;
  asOfDate: string;
  bankBalance: number;
  computedBalance: number;
  difference: number;
  note: string | null;
  createdAt: string;
}

export interface CreateReconciliationInput {
  asOfDate: string;
  bankBalance: number;
  note?: string | null;
}
