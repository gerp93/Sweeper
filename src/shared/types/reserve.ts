export interface ReserveLineItem {
  id: string;
  reserveId: string;
  label: string | null;
  amount: number;
  targetDate: string | null;
  priority: number;
  allocated: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReserveLineItemInput {
  label?: string | null;
  amount: number;
  targetDate?: string | null;
  priority?: number;
}

export interface UpdateReserveLineItemInput {
  label?: string | null;
  amount?: number;
  targetDate?: string | null;
  priority?: number;
}

// One row per distinct target date across a reserve's line items, amounts summed --
// several same-day promo balances (e.g. three items bought the same day on a store
// card) collapse into a single displayed row.
export interface ReserveDateGroup {
  targetDate: string | null;
  amount: number;
  allocated: number;
  remaining: number;
}

export interface Reserve {
  id: string;
  label: string;
  note: string | null;
  accountId: string | null;
  autoAllocate: boolean;
  lineItems: ReserveLineItem[];
  dateGroups: ReserveDateGroup[];
  amount: number;
  allocated: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReserveInput {
  label: string;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
  lineItems: CreateReserveLineItemInput[];
}

export interface UpdateReserveInput {
  label?: string;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
}
