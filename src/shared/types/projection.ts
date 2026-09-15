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

// Lets the caller preview "what if" a projection ran with a different spending assumption,
// without saving anything -- never persisted, only affects the single calculation it's
// passed to.
export interface ProjectionScenarioOptions {
  // Replaces the historical 3-month-average burn rate with this flat monthly figure
  // (negative = spend). Omit or null to use the historical default. Ignored when
  // burnRateMode is 'recurringBills'.
  burnRateOverride?: number | null;
  // 'recurringBills' replaces the flat historical/custom burn rate entirely with the real sum
  // of active Recurring Bills' expected occurrences in the actual window being calculated --
  // not a flat monthly figure scaled by months elapsed, since a non-monthly bill would be
  // misrepresented by that scaling. Omit or 'historical' for the existing behavior.
  burnRateMode?: 'historical' | 'custom' | 'recurringBills';
}

// A single point-in-time projection: today's real balance carried forward with planned
// income, an assumed historical spending rate, and Obligations assumed paid off on their
// due date. Always an estimate -- never blended into the real "Truly Available" figure
// shown elsewhere in the app.
export interface ProjectedBalancePoint {
  asOf: string;
  baselineBalance: number;
  projectedIncome: number;
  // Negative. The monthly spend rate actually used for this point -- either the historical
  // trailing-average or a caller-supplied override (see ProjectionScenarioOptions).
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
  // Obligation dollars whose due date falls within this calendar month specifically (not
  // cumulative like obligationsPaidByDate), using current remaining amounts.
  obligationsDueThisMonth: number;
  // Display-only figure for this calendar month: still-to-come projected occurrences (the
  // same forward-only amount baked into projectedIncome/projectedSpendableBalance) plus, for
  // the current month only, real deposits already received on a linked account since the
  // month started. Never feeds the balance math -- baseline already reflects real money, so
  // adding it there would double-count.
  incomeThisMonth: number;
}
