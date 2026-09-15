export type ProjectionFrequency = 'once' | 'weekly' | 'biweekly' | 'monthly';

export interface IncomeProjection {
  id: string;
  label: string;
  amount: number;
  frequency: ProjectionFrequency;
  startDate: string;
  endDate: string | null;
  accountId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIncomeProjectionInput {
  label: string;
  amount: number;
  frequency: ProjectionFrequency;
  startDate: string;
  endDate?: string | null;
  accountId?: string | null;
  note?: string | null;
}

export interface UpdateIncomeProjectionInput {
  label?: string;
  amount?: number;
  frequency?: ProjectionFrequency;
  startDate?: string;
  endDate?: string | null;
  accountId?: string | null;
  note?: string | null;
}

// A single point-in-time projection: today's real balance carried forward with planned
// income, minus whatever Obligations will be due by that date. Always an estimate -- never
// blended into the real "Truly Available" figure shown elsewhere in the app.
export interface ProjectedBalancePoint {
  asOf: string;
  baselineBalance: number;
  projectedIncome: number;
  projectedSpendableBalance: number;
  obligationsDueByDate: number;
  projectedTrulyAvailable: number;
}

export interface ProjectionSeriesPoint extends ProjectedBalancePoint {
  monthLabel: string;
}
