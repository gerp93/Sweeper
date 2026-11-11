// A standalone record of physical cash on hand as of a date. Deliberately not linked to
// transactions, balances, or anything else in the app.
export interface CashEntry {
  id: string;
  amount: number;
  date: string;
  note: string | null;
  createdAt: string;
}

export interface CreateCashEntryInput {
  amount: number;
  date: string;
  note?: string | null;
}
