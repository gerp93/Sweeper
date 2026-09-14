import { Database } from 'sql.js';
import {
  IncomeProjection,
  CreateIncomeProjectionInput,
  UpdateIncomeProjectionInput,
  ProjectedBalancePoint,
  ProjectionSeriesPoint,
} from '../../shared/types/projection';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';
import { BalanceService } from './balanceService';
import { ObligationService } from './obligationService';

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

function addDays(dateStr: string, days: number): string {
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

// Every occurrence date of a projection landing in [windowStart, windowEnd], honoring the
// projection's own end_date if it cuts the window shorter.
export function expandOccurrences(
  projection: Pick<IncomeProjection, 'frequency' | 'startDate' | 'endDate'>,
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
    const occurrence = addMonthsClamped(projection.startDate, n);
    if (occurrence > effectiveEnd) break;
    if (occurrence >= windowStart) dates.push(occurrence);
  }
  return dates;
}

export class ProjectionService {
  constructor(
    private db: Database,
    private balanceService: BalanceService,
    private obligationService: ObligationService
  ) {}

  getAllProjections(): IncomeProjection[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM income_projections ORDER BY start_date ASC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToProjection(results[0].columns, row));
  }

  createProjection(input: CreateIncomeProjectionInput): IncomeProjection {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO income_projections (id, label, amount, frequency, start_date, end_date, account_id, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.label,
        input.amount,
        input.frequency,
        input.startDate,
        input.endDate ?? null,
        input.accountId ?? null,
        input.note ?? null,
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

  private obligationsDueBy(date: string): number {
    return this.obligationService
      .getAllObligations()
      .flatMap((o) => o.dateGroups)
      .filter((g) => g.targetDate != null && g.targetDate <= date)
      .reduce((sum, g) => sum + g.remaining, 0);
  }

  getProjectedBalance(targetDate: string): ProjectedBalancePoint {
    const today = new Date().toISOString().slice(0, 10);
    const baseline = this.balanceService.getSpendableBalance(today);

    const projectedIncome =
      targetDate > today
        ? this.getAllProjections()
            .flatMap((p) => expandOccurrences(p, addDays(today, 1), targetDate).map(() => p.amount))
            .reduce((sum, amount) => sum + amount, 0)
        : 0;

    const projectedSpendableBalance = baseline.balance + projectedIncome;
    const obligationsDueByDate = this.obligationsDueBy(targetDate);

    return {
      asOf: targetDate,
      baselineBalance: baseline.balance,
      projectedIncome,
      projectedSpendableBalance,
      obligationsDueByDate,
      projectedTrulyAvailable: projectedSpendableBalance - obligationsDueByDate,
    };
  }

  // One point per month-end for the next `months` months, so the UI can render a table in a
  // single call instead of one round trip per month.
  getProjectionSeries(months: number): ProjectionSeriesPoint[] {
    const today = new Date().toISOString().slice(0, 10);
    const [y, m] = today.split('-').map(Number);
    const points: ProjectionSeriesPoint[] = [];

    for (let i = 1; i <= months; i++) {
      const totalMonths = (m - 1) + i;
      const targetYear = y + Math.floor(totalMonths / 12);
      const targetMonth = totalMonths % 12; // 0-indexed
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const monthEnd = `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const monthLabel = new Date(Date.UTC(targetYear, targetMonth, 1)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });

      points.push({ ...this.getProjectedBalance(monthEnd), monthLabel });
    }

    return points;
  }
}
