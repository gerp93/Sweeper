export interface Reserve {
  id: string;
  label: string;
  amount: number;
  targetDate: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReserveInput {
  label: string;
  amount: number;
  targetDate?: string | null;
  note?: string | null;
}

export interface UpdateReserveInput {
  label?: string;
  amount?: number;
  targetDate?: string | null;
  note?: string | null;
}
