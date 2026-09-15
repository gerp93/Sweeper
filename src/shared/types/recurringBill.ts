import { ProjectionFrequency } from './projection';

export type RecurringBillAmountMode = 'fixed' | 'auto-average';

export interface RecurringBill {
  id: string;
  label: string;
  amountMode: RecurringBillAmountMode;
  // Negative, like Transaction.amount. Required when amountMode === 'fixed'; null when
  // 'auto-average' (the resolved amount is computed on read from linked transaction history).
  fixedAmount: number | null;
  frequency: ProjectionFrequency;
  startDate: string;
  endDate: string | null;
  accountId: string | null;
  note: string | null;
  // Only meaningful when frequency is 'monthly' -- see IncomeProjection's identical field.
  lastDayOfMonth: boolean;
  // Pause without deleting -- an inactive bill stops generating occurrences/virtual rows/burn
  // contributions, but keeps its definition and any transactions already linked to it.
  active: boolean;
  amountToleranceType: 'percent' | 'flat';
  // e.g. 0.15 for 15% when amountToleranceType is 'percent', or a flat dollar figure.
  amountTolerance: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringBillInput {
  label: string;
  amountMode: RecurringBillAmountMode;
  fixedAmount?: number | null;
  frequency: ProjectionFrequency;
  startDate: string;
  endDate?: string | null;
  accountId?: string | null;
  note?: string | null;
  lastDayOfMonth?: boolean;
  active?: boolean;
  amountToleranceType?: 'percent' | 'flat';
  amountTolerance?: number;
}

export type UpdateRecurringBillInput = Partial<CreateRecurringBillInput>;

// One computed occurrence of a bill in a given window. Never persisted -- computed live from
// the bill's definition, the same way IncomeProjection occurrences are.
export type BillOccurrenceStatus = 'upcoming' | 'reconciled' | 'overdue';

export interface RecurringBillOccurrence {
  billId: string;
  billLabel: string;
  expectedDate: string;
  // Negative. The resolved fixed-or-averaged amount at query time.
  expectedAmount: number;
  status: BillOccurrenceStatus;
  matchedTransactionId: string | null;
}

// A real, already-imported transaction that plausibly satisfies one or more RecurringBills --
// surfaced for the user to confirm or skip. Never auto-applied.
export interface RecurringBillMatchCandidate {
  transactionId: string;
  transactionDate: string;
  transactionDescription: string;
  transactionAmount: number;
  candidateBillIds: string[];
}
