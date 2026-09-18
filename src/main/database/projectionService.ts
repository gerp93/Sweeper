import { Database } from 'sql.js';
import {
  IncomeProjection,
  CreateIncomeProjectionInput,
  UpdateIncomeProjectionInput,
  ProjectedBalancePoint,
  ProjectionSeriesPoint,
  ProjectionScenarioOptions,
  IncomeProjectionOccurrence,
} from '../../shared/types/projection';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';
import { BalanceService } from './balanceService';
import { ObligationService } from './obligationService';
import { TransactionService } from './transactionService';
import type { RecurringBillService } from './recurringBillService';

function rowToProjection(columns: string[], row: any[]): IncomeProjection {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    label: obj.label,
    amount: obj.amount,
    frequency: obj.frequency,
    startDate: obj.startDate,
    endDate: obj.endDate,
    accountId: obj.accountId,
    note: obj.note,
    lastDayOfMonth: !!obj.lastDayOfMonth,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  label,
  amount,
  frequency,
  start_date as startDate,
  end_date as endDate,
  account_id as accountId,
  note,
  last_day_of_month as lastDayOfMonth,
  created_at as createdAt,
  updated_at as updatedAt
`;

const MAX_OCCURRENCES = 1000; // guards against a runaway loop on a pathological date range

function isoFromUTC(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return isoFromUTC(new Date(Date.UTC(y, m - 1, d + days)));
}

// Adds N months to a date, clamping to the last valid day of the target month (e.g. Jan 31
// + 1 month -> Feb 28/29, not an overflow into March).
function addMonthsClamped(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = (m - 1) + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return isoFromUTC(new Date(Date.UTC(targetYear, targetMonth, clampedDay)));
}

// The last calendar day of dateStr's own month (28-31, whatever that month has).
function lastDayOfMonthFor(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function daysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return (to - from) / (1000 * 60 * 60 * 24);
}

// Fractional calendar months between two dates, using the average month length -- good
// enough for a "rough estimate" burn-rate scale, not meant to be exact.
function monthsBetween(fromDate: string, toDate: string): number {
  return daysBetween(fromDate, toDate) / 30.4368;
}

// Every occurrence date of a projection landing in [windowStart, windowEnd], honoring the
// projection's own end_date if it cuts the window shorter.
export function expandOccurrences(
  projection: Pick<IncomeProjection, 'frequency' | 'startDate' | 'endDate' | 'lastDayOfMonth'>,
  windowStart: string,
  windowEnd: string
): string[] {
  const effectiveEnd = projection.endDate && projection.endDate < windowEnd ? projection.endDate : windowEnd;
  if (projection.startDate > effectiveEnd) return [];

  const dates: string[] = [];

  if (projection.frequency === 'once') {
    if (projection.startDate >= windowStart && projection.startDate <= effectiveEnd) {
      dates.push(projection.startDate);
    }
    return dates;
  }

  if (projection.frequency === 'weekly' || projection.frequency === 'biweekly') {
    const stepDays = projection.frequency === 'weekly' ? 7 : 14;
    let current = projection.startDate;
    let guard = 0;
    while (current <= effectiveEnd && guard++ < MAX_OCCURRENCES) {
      if (current >= windowStart) dates.push(current);
      current = addDays(current, stepDays);
    }
    return dates;
  }

  // monthly -- compute each occurrence independently from the original start date so a
  // clamped short month (e.g. Feb 28) doesn't permanently shift later occurrences.
  for (let n = 0; n < MAX_OCCURRENCES; n++) {
    let occurrence = addMonthsClamped(projection.startDate, n);
    if (projection.lastDayOfMonth) occurrence = lastDayOfMonthFor(occurrence);
    if (occurrence > effectiveEnd) break;
    if (occurrence >= windowStart) dates.push(occurrence);
  }
  return dates;
}

const BURN_LOOKBACK_MONTHS = 3;

export class ProjectionService {
  constructor(
    private db: Database,
    private balanceService: BalanceService,
    private obligationService: ObligationService,
    private transactionService: TransactionService,
    private recurringBillService: RecurringBillService
  ) {}

  getAllProjections(): IncomeProjection[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM income_projections ORDER BY start_date ASC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToProjection(results[0].columns, row));
  }

  // Every income projection's occurrence in [monthStart, monthEnd], clamped to strictly after
  // today (today's baseline already reflects anything on or before it as real cash) -- for the
  // Transactions ledger's "pencilled in" reminder rows. No "overdue"/reconciled concept here
  // unlike Recurring Bills: there's no link from a real transaction back to a specific income
  // projection occurrence, only the account-level "actualIncomeReceivedInMonth" aggregate used
  // elsewhere, so an occurrence just stops being returned once its month is in the past.
  getMonthlyIncomeOccurrences(
    monthStart: string,
    monthEnd: string,
    excludedIds: string[] = []
  ): IncomeProjectionOccurrence[] {
    const today = new Date().toISOString().slice(0, 10);
    const windowStart = monthStart > addDays(today, 1) ? monthStart : addDays(today, 1);
    if (windowStart > monthEnd) return [];

    const excluded = new Set(excludedIds);
    return this.getAllProjections()
      .filter((p) => !excluded.has(p.id))
      .flatMap((p) =>
        expandOccurrences(p, windowStart, monthEnd).map((expectedDate) => ({
          projectionId: p.id,
          label: p.label,
          expectedDate,
          expectedAmount: p.amount,
        }))
      );
  }

  createProjection(input: CreateIncomeProjectionInput): IncomeProjection {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO income_projections (id, label, amount, frequency, start_date, end_date, account_id, note, last_day_of_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.label,
        input.amount,
        input.frequency,
        input.startDate,
        input.endDate ?? null,
        input.accountId ?? null,
        input.note ?? null,
        input.lastDayOfMonth ? 1 : 0,
        now,
        now,
      ]
    );

    saveDatabase(this.db);

    return this.getAllProjections().find((p) => p.id === id)!;
  }

  updateProjection(id: string, input: UpdateIncomeProjectionInput): IncomeProjection {
    const updates: string[] = [];
    const params: any[] = [];

    if (input.label !== undefined) {
      updates.push('label = ?');
      params.push(input.label);
    }
    if (input.amount !== undefined) {
      updates.push('amount = ?');
      params.push(input.amount);
    }
    if (input.frequency !== undefined) {
      updates.push('frequency = ?');
      params.push(input.frequency);
    }
    if (input.startDate !== undefined) {
      updates.push('start_date = ?');
      params.push(input.startDate);
    }
    if (input.endDate !== undefined) {
      updates.push('end_date = ?');
      params.push(input.endDate);
    }
    if (input.accountId !== undefined) {
      updates.push('account_id = ?');
      params.push(input.accountId);
    }
    if (input.note !== undefined) {
      updates.push('note = ?');
      params.push(input.note);
    }
    if (input.lastDayOfMonth !== undefined) {
      updates.push('last_day_of_month = ?');
      params.push(input.lastDayOfMonth ? 1 : 0);
    }
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE income_projections SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDatabase(this.db);

    return this.getAllProjections().find((p) => p.id === id)!;
  }

  deleteProjection(id: string): void {
    this.db.run(`DELETE FROM income_projections WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }

  // Obligation dollars (current remaining, across all obligations) whose due date falls at
  // or before `date` -- i.e. assumed paid off, in cash, by then.
  private obligationsPaidBy(date: string): number {
    return this.obligationService
      .getAllObligations()
      .filter((o) => o.targetDate != null && o.targetDate <= date)
      .reduce((sum, o) => sum + o.remaining, 0);
  }

  // Accounts holding money already spoken for by an unpaid Obligation -- their transactions
  // are obligation payments/reserves, not everyday spending, so the burn rate excludes them.
  private getObligationAccountIds(): Set<string> {
    const ids = this.obligationService
      .getAllObligations()
      .filter((o) => o.remaining > 0 && o.accountId)
      .map((o) => o.accountId as string);
    return new Set(ids);
  }

  // Real deposits already received between monthStart and today (clamped -- 0 for a month
  // that hasn't started yet) on an account some included projection is linked to. Display-only:
  // there's no link from a real transaction to the projection it corresponds to, so this is an
  // additive "what's actually landed" figure, not a one-to-one match.
  private actualIncomeReceivedInMonth(monthStart: string, monthEnd: string, excludedIds: Set<string>): number {
    const today = new Date().toISOString().slice(0, 10);
    const rangeEnd = monthEnd < today ? monthEnd : today;
    if (monthStart > rangeEnd) return 0;

    const linkedAccountIds = new Set(
      this.getAllProjections()
        .filter((p) => !excludedIds.has(p.id) && p.accountId)
        .map((p) => p.accountId as string)
    );
    if (linkedAccountIds.size === 0) return 0;

    return this.transactionService
      .getAllTransactions()
      .filter((tx) => tx.date >= monthStart && tx.date <= rangeEnd)
      .filter((tx) => tx.amount > 0)
      .filter((tx) => tx.accountId && linkedAccountIds.has(tx.accountId))
      .reduce((sum, tx) => sum + tx.amount, 0);
  }

  // Average monthly spend (negative) over the trailing lookback window, on accounts not tied
  // to an active Obligation and excluding any transaction already allocated to one -- so
  // Obligation payments (modeled separately via obligationsPaidBy) aren't double-counted here.
  private getMonthlyBurnRate(): number {
    const today = new Date().toISOString().slice(0, 10);
    const windowStart = addMonthsClamped(today, -BURN_LOOKBACK_MONTHS);
    const excludedAccountIds = this.getObligationAccountIds();

    const spend = this.transactionService
      .getAllTransactions()
      .filter((tx) => tx.date >= windowStart && tx.date <= today)
      .filter((tx) => tx.amount < 0)
      .filter((tx) => tx.obligationId == null)
      .filter((tx) => !tx.accountId || !excludedAccountIds.has(tx.accountId))
      .reduce((sum, tx) => sum + tx.amount, 0);

    return spend / BURN_LOOKBACK_MONTHS;
  }

  getProjectedBalance(
    targetDate: string,
    excludedIds: string[] = [],
    options: ProjectionScenarioOptions = {}
  ): ProjectedBalancePoint {
    const today = new Date().toISOString().slice(0, 10);
    const baseline = this.balanceService.getSpendableBalance(today);
    const excluded = new Set(excludedIds);
    const isFuture = targetDate > today;

    const projectedIncome = isFuture
      ? this.getAllProjections()
          .filter((p) => !excluded.has(p.id))
          .flatMap((p) => expandOccurrences(p, addDays(today, 1), targetDate).map(() => p.amount))
          .reduce((sum, amount) => sum + amount, 0)
      : 0;

    let monthlyBurnRate: number;
    let projectedBurn: number;
    if (options.burnRateMode === 'recurringBills') {
      // Real per-window expansion, not a flat monthly figure scaled by months elapsed -- a
      // non-monthly bill (e.g. biweekly) would be misrepresented by that scaling.
      projectedBurn = isFuture ? this.recurringBillService.getExpectedBillTotal(addDays(today, 1), targetDate) : 0;
      const months = monthsBetween(today, targetDate);
      monthlyBurnRate = months > 0 ? projectedBurn / months : 0;
    } else {
      monthlyBurnRate = options.burnRateOverride ?? this.getMonthlyBurnRate();
      projectedBurn = isFuture ? monthlyBurnRate * monthsBetween(today, targetDate) : 0;
    }

    const obligationsPaidByDate = this.obligationsPaidBy(targetDate);
    const totalObligated = this.obligationService.getTotalObligated();
    const obligationsStillOutstanding = Math.max(totalObligated - obligationsPaidByDate, 0);

    const projectedSpendableBalance = baseline.balance + projectedIncome + projectedBurn - obligationsPaidByDate;

    return {
      asOf: targetDate,
      baselineBalance: baseline.balance,
      projectedIncome,
      monthlyBurnRate,
      projectedBurn,
      obligationsPaidByDate,
      obligationsStillOutstanding,
      projectedSpendableBalance,
      projectedTrulyAvailable: projectedSpendableBalance - obligationsStillOutstanding,
    };
  }

  // One point per month-end, starting with the current (partial) month through the next
  // `months` months, so the UI can render a table in a single call instead of one round trip
  // per month.
  getProjectionSeries(
    months: number,
    excludedIds: string[] = [],
    options: ProjectionScenarioOptions = {}
  ): ProjectionSeriesPoint[] {
    const today = new Date().toISOString().slice(0, 10);
    const [y, m] = today.split('-').map(Number);
    const excludedSet = new Set(excludedIds);
    const points: ProjectionSeriesPoint[] = [];
    let previousIncome = 0;

    for (let i = 0; i <= months; i++) {
      const totalMonths = (m - 1) + i;
      const targetYear = y + Math.floor(totalMonths / 12);
      const targetMonth = totalMonths % 12; // 0-indexed
      const monthStart = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const monthEnd = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const monthLabel = new Date(Date.UTC(targetYear, targetMonth, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });

      const obligationsDueThisMonth = this.obligationsPaidBy(monthEnd) - this.obligationsPaidBy(addDays(monthStart, -1));

      const point = this.getProjectedBalance(monthEnd, excludedIds, options);
      const stillToCome = point.projectedIncome - previousIncome;
      previousIncome = point.projectedIncome;
      const actualReceived = this.actualIncomeReceivedInMonth(monthStart, monthEnd, excludedSet);
      const incomeThisMonth = stillToCome + actualReceived;

      points.push({ ...point, monthLabel, obligationsDueThisMonth, incomeThisMonth });
    }

    return points;
  }
}
