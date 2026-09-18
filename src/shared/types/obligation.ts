export type ObligationRecurrenceUnit = 'day' | 'week' | 'month' | 'year';

export interface ObligationRecurrence {
  unit: ObligationRecurrenceUnit;
  // "every N <unit>s" -- e.g. unit: 'month', interval: 3 is "every 3 months".
  interval: number;
  // Only meaningful when unit === 'month': ignore the day-of-month and land each occurrence
  // on whatever the last day of that month happens to be (28-31).
  lastDayOfMonth: boolean;
}

export interface ObligationLineItem {
  id: string;
  obligationId: string;
  label: string | null;
  amount: number;
  priority: number;
  allocated: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateObligationLineItemInput {
  label?: string | null;
  amount: number;
  priority?: number;
}

export interface UpdateObligationLineItemInput {
  label?: string | null;
  amount?: number;
  priority?: number;
}

export interface Obligation {
  id: string;
  label: string;
  note: string | null;
  accountId: string | null;
  autoAllocate: boolean;
  // The one date this obligation's whole amount is due -- a single obligation can only carry
  // one date, even when it holds several target amounts. A different date means a different
  // obligation (see clone).
  targetDate: string | null;
  // Null means one-off (no recurrence).
  recurrence: ObligationRecurrence | null;
  lineItems: ObligationLineItem[];
  amount: number;
  allocated: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateObligationInput {
  label: string;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
  targetDate?: string | null;
  recurrence?: ObligationRecurrence | null;
  lineItems: CreateObligationLineItemInput[];
}

export interface UpdateObligationInput {
  label?: string;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
  targetDate?: string | null;
  recurrence?: ObligationRecurrence | null;
}
