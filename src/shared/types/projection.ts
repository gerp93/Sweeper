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
  // Only meaningful when frequency is 'monthly': ignore startDate's day-of-month and land
  // each occurrence on whatever the last day of that month happens to be (28-31).
  lastDayOfMonth: boolean;
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
  lastDayOfMonth?: boolean;
}

export interface UpdateIncomeProjectionInput {
  label?: string;
  amount?: number;
  frequency?: ProjectionFrequency;
  startDate?: string;
  endDate?: string | null;
  accountId?: string | null;
  note?: string | null;
  lastDayOfMonth?: boolean;
}

// A single point-in-time projection: today's real balance carried forward with planned
// income, an assumed historical spending rate, and Obligations assumed paid off on their
// due date. Always an estimate -- never blended into the real "Truly Available" figure
// shown elsewhere in the app.
export interface ProjectedBalancePoint {
  asOf: string;
  baselineBalance: number;
  projectedIncome: number;
  // Negative. Average monthly spend over the trailing lookback window, excluding accounts
  // linked to an active (unpaid) Obligation and any Obligation-allocated transaction.
  monthlyBurnRate: number;
  // Negative. monthlyBurnRate scaled to the number of months between today and asOf.
  projectedBurn: number;
  // Obligation dollars assumed paid off (cash out the door) by asOf.
  obligationsPaidByDate: number;
  // Obligation dollars not yet paid off by asOf -- still held back out of spendable balance.
  obligationsStillOutstanding: number;
  projectedSpendableBalance: number;
  projectedTrulyAvailable: number;
}

export interface ProjectionSeriesPoint extends ProjectedBalancePoint {
  monthLabel: string;
}
