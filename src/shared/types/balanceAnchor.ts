export interface BalanceAnchor {
  id: string;
  balance: number;
  asOfDate: string;
  note: string | null;
  createdAt: string;
}

export interface CreateBalanceAnchorInput {
  balance: number;
  asOfDate: string;
  note?: string | null;
}

export interface SpendableBalance {
  balance: number;
  anchor: BalanceAnchor | null;
  netSinceAnchor: number;
  asOf: string;
}
