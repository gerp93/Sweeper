export interface Reserve {
  id: string;
  label: string;
  amount: number;
  targetDate: string | null;
  note: string | null;
  accountId: string | null;
  autoAllocate: boolean;
  allocated: number;
  remaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReserveInput {
  label: string;
  amount: number;
  targetDate?: string | null;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
}

export interface UpdateReserveInput {
  label?: string;
  amount?: number;
  targetDate?: string | null;
  note?: string | null;
  accountId?: string | null;
  autoAllocate?: boolean;
}
