export interface ObligationLineItem {
  id: string;
  obligationId: string;
  label: string | null;
  amount: number;
  targetDate: string | null;
  priority: number;
  allocated: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateObligationLineItemInput {
  label?: string | null;
  amount: number;
  targetDate?: string | null;
  priority?: number;
}

export interface UpdateObligationLineItemInput {
  label?: string | null;
  amount?: number;
  targetDate?: string | null;
  priority?: number;
}

// One row per distinct target date across an obligation's line items, amounts summed --
// several same-day promo balances (e.g. three items bought the same day on a store
// card) collapse into a single displayed row.
export interface ObligationDateGroup {
  targetDate: string | null;
  amount: number;
  allocated: number;
  remaining: number;
}

export interface Obligation {
  id: string;
  label: string;
  note: string | null;
  accountId: string | null;
  autoAllocate: boolean;
  lineItems: ObligationLineItem[];
  dateGroups: ObligationDateGroup[];
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
  lineItems: CreateObligationLineItemInput[];
}

export interface UpdateObligationInput {
  label?: string;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
}
