export interface Transaction {
  id: string;
  accountId: string | null;
  date: string;
  description: string;
  refCheck: string | null;
  amount: number;
  memo: string | null;
  category: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTransactionInput {
  accountId: string | null;
  date: string;
  description: string;
  refCheck?: string | null;
  amount: number;
  memo?: string | null;
  category?: string | null;
  importBatchId?: string | null;
}

export interface UpdateTransactionInput {
  accountId?: string | null;
  date?: string;
  description?: string;
  refCheck?: string | null;
  amount?: number;
  memo?: string | null;
  category?: string | null;
}
