import { Database } from 'sql.js';
import {
  Obligation,
  ObligationLineItem,
  ObligationRecurrence,
  CreateObligationInput,
  UpdateObligationInput,
  CreateObligationLineItemInput,
  UpdateObligationLineItemInput,
} from '../../shared/types/obligation';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';
import { addDays } from './projectionService';

interface RawLineItem {
  id: string;
  obligationId: string;
  label: string | null;
  amount: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

function rowToRawLineItem(columns: string[], row: any[]): RawLineItem {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    obligationId: obj.obligationId,
    label: obj.label,
    amount: obj.amount,
    priority: obj.priority,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const LINE_ITEM_COLUMNS = `
  id,
  obligation_id as obligationId,
  label,
  amount,
  priority,
  created_at as createdAt,
  updated_at as updatedAt
`;

// Precedence order: lowest priority number goes first, ties broken by creation order.
const LINE_ITEM_PRECEDENCE_ORDER = `ORDER BY priority ASC, created_at ASC`;

// A transaction allocated to an obligation doesn't say which specific line item it's for
// (the whole point -- e.g. three same-day store-card promo balances that a single payment
// can't be told apart between). Instead, the obligation's total allocated dollars cascade
// through its line items in precedence order: fully pay off the first, then spill into the
// next, etc.
function applyWaterfall(items: RawLineItem[], totalAllocated: number): ObligationLineItem[] {
  let pool = Math.max(totalAllocated, 0);
  return items.map((item) => {
    const allocated = Math.min(item.amount, pool);
    pool -= allocated;
    return { ...item, allocated, remaining: item.amount - allocated };
  });
}

function rowToRecurrence(row: { recurrenceUnit: string | null; recurrenceInterval: number | null; recurrenceLastDayOfMonth: boolean }): ObligationRecurrence | null {
  if (!row.recurrenceUnit || !row.recurrenceInterval) return null;
  return {
    unit: row.recurrenceUnit as ObligationRecurrence['unit'],
    interval: row.recurrenceInterval,
    lastDayOfMonth: row.recurrenceLastDayOfMonth,
  };
}

// Adds N months to a date, clamping to the last valid day of the target month (e.g. Jan 31
// + 1 month -> Feb 28/29, not an overflow into March). Mirrors projectionService's identical
// helper -- kept local since obligation recurrence also supports day/week/year steps that
// don't apply there.
function addMonthsClamped(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const totalMonths = m - 1 + months;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  const iso = new Date(Date.UTC(targetYear, targetMonth, clampedDay)).toISOString();
  return iso.slice(0, 10);
}

function lastDayOfMonthFor(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

// The next occurrence date after `fromDate`, per the recurrence rule -- used to suggest a
// starting date when cloning a recurring obligation forward.
export function computeNextOccurrenceDate(fromDate: string, recurrence: ObligationRecurrence): string {
  let next: string;
  switch (recurrence.unit) {
    case 'day':
      next = addDays(fromDate, recurrence.interval);
      break;
    case 'week':
      next = addDays(fromDate, recurrence.interval * 7);
      break;
    case 'year':
      next = addMonthsClamped(fromDate, recurrence.interval * 12);
      break;
    case 'month':
    default:
      next = addMonthsClamped(fromDate, recurrence.interval);
      break;
  }
  if (recurrence.unit === 'month' && recurrence.lastDayOfMonth) {
    next = lastDayOfMonthFor(next);
  }
  return next;
}

export class ObligationService {
  constructor(private db: Database) {}

  private getRawLineItems(obligationId: string): RawLineItem[] {
    const stmt = this.db.prepare(
      `SELECT ${LINE_ITEM_COLUMNS} FROM obligation_line_items WHERE obligation_id = ? ${LINE_ITEM_PRECEDENCE_ORDER}`
    );
    stmt.bind([obligationId]);
    const out: RawLineItem[] = [];
    while (stmt.step()) {
      out.push(rowToRawLineItem(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return out;
  }

  private getTotalAllocated(obligationId: string): number {
    const stmt = this.db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE obligation_id = ?`);
    stmt.bind([obligationId]);
    const total = stmt.step() ? Number(stmt.get()[0]) : 0;
    stmt.free();
    return total;
  }

  private buildObligation(obligationRow: {
    id: string;
    label: string;
    note: string | null;
    accountId: string | null;
    autoAllocate: boolean;
    targetDate: string | null;
    recurrenceUnit: string | null;
    recurrenceInterval: number | null;
    recurrenceLastDayOfMonth: boolean;
    createdAt: string;
    updatedAt: string;
  }): Obligation {
    const rawItems = this.getRawLineItems(obligationRow.id);
    const totalAllocated = this.getTotalAllocated(obligationRow.id);
    const lineItems = applyWaterfall(rawItems, totalAllocated);
    const amount = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const allocated = lineItems.reduce((sum, i) => sum + i.allocated, 0);

    return {
      id: obligationRow.id,
      label: obligationRow.label,
      note: obligationRow.note,
      accountId: obligationRow.accountId,
      autoAllocate: obligationRow.autoAllocate,
      targetDate: obligationRow.targetDate,
      recurrence: rowToRecurrence(obligationRow),
      lineItems,
      amount,
      allocated,
      remaining: amount - allocated,
      createdAt: obligationRow.createdAt,
      updatedAt: obligationRow.updatedAt,
    };
  }

  getAllObligations(): Obligation[] {
    const results = this.db.exec(`
      SELECT
        id,
        label,
        note,
        account_id as accountId,
        auto_allocate as autoAllocate,
        target_date as targetDate,
        recurrence_unit as recurrenceUnit,
        recurrence_interval as recurrenceInterval,
        recurrence_last_day_of_month as recurrenceLastDayOfMonth,
        created_at as createdAt,
        updated_at as updatedAt
      FROM heloc_obligations
      ORDER BY created_at ASC
    `);
    if (results.length === 0) return [];
    const obligations = results[0].values.map((row) => {
      const obj: any = {};
      results[0].columns.forEach((col, idx) => (obj[col] = row[idx]));
      return this.buildObligation({
        ...obj,
        autoAllocate: Boolean(obj.autoAllocate),
        recurrenceLastDayOfMonth: Boolean(obj.recurrenceLastDayOfMonth),
      });
    });

    // Soonest due date first, undated obligations last -- TransactionForm/ImportTransactions
    // rely on this order to pick the soonest-due obligation when suggesting/auto-assigning an
    // account's transaction to whichever of its auto-allocate obligations is due first.
    return obligations.sort((a, b) => {
      if (a.targetDate === b.targetDate) return 0;
      if (a.targetDate === null) return 1;
      if (b.targetDate === null) return -1;
      return a.targetDate < b.targetDate ? -1 : 1;
    });
  }

  getObligationById(id: string): Obligation | null {
    const stmt = this.db.prepare(
      `SELECT
         id,
         label,
         note,
         account_id as accountId,
         auto_allocate as autoAllocate,
         target_date as targetDate,
         recurrence_unit as recurrenceUnit,
         recurrence_interval as recurrenceInterval,
         recurrence_last_day_of_month as recurrenceLastDayOfMonth,
         created_at as createdAt,
         updated_at as updatedAt
       FROM heloc_obligations WHERE id = ?`
    );
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const obj: any = {};
    stmt.getColumnNames().forEach((col, idx) => (obj[col] = stmt.get()[idx]));
    stmt.free();
    return this.buildObligation({
      ...obj,
      autoAllocate: Boolean(obj.autoAllocate),
      recurrenceLastDayOfMonth: Boolean(obj.recurrenceLastDayOfMonth),
    });
  }

  getTotalObligated(): number {
    return this.getAllObligations().reduce((sum, o) => sum + o.remaining, 0);
  }

  createObligation(input: CreateObligationInput): Obligation {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO heloc_obligations
         (id, label, note, account_id, auto_allocate, target_date, recurrence_unit, recurrence_interval, recurrence_last_day_of_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.label,
        input.note ?? null,
        input.accountId ?? null,
        input.autoAllocate ? 1 : 0,
        input.targetDate ?? null,
        input.recurrence?.unit ?? null,
        input.recurrence?.interval ?? null,
        input.recurrence?.lastDayOfMonth ? 1 : 0,
        now,
        now,
      ]
    );

    input.lineItems.forEach((item, index) => {
      this.insertLineItem(id, item, index);
    });

    saveDatabase(this.db);

    return this.getObligationById(id)!;
  }

  updateObligation(id: string, input: UpdateObligationInput): Obligation {
    const updates: string[] = [];
    const params: any[] = [];

    if (input.label !== undefined) {
      updates.push('label = ?');
      params.push(input.label);
    }
    if (input.note !== undefined) {
      updates.push('note = ?');
      params.push(input.note);
    }
    if (input.accountId !== undefined) {
      updates.push('account_id = ?');
      params.push(input.accountId);
    }
    if (input.autoAllocate !== undefined) {
      updates.push('auto_allocate = ?');
      params.push(input.autoAllocate ? 1 : 0);
    }
    if (input.targetDate !== undefined) {
      updates.push('target_date = ?');
      params.push(input.targetDate);
    }
    if (input.recurrence !== undefined) {
      updates.push('recurrence_unit = ?', 'recurrence_interval = ?', 'recurrence_last_day_of_month = ?');
      params.push(
        input.recurrence?.unit ?? null,
        input.recurrence?.interval ?? null,
        input.recurrence?.lastDayOfMonth ? 1 : 0
      );
    }
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE heloc_obligations SET ${updates.join(', ')} WHERE id = ?`, params);

    saveDatabase(this.db);

    return this.getObligationById(id)!;
  }

  deleteObligation(id: string): void {
    this.db.run(`DELETE FROM heloc_obligations WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }

  // Duplicates label/note/account/auto-allocate/recurrence and every line item's label+amount
  // (fresh ids, no allocation history) into a brand-new obligation on newTargetDate -- the way
  // to represent "the same obligation coming due again" without a single obligation trying to
  // carry more than one date.
  cloneObligation(id: string, newTargetDate: string | null): Obligation {
    const source = this.getObligationById(id);
    if (!source) throw new Error(`Obligation with id ${id} not found`);

    return this.createObligation({
      label: source.label,
      note: source.note,
      accountId: source.accountId,
      autoAllocate: source.autoAllocate,
      targetDate: newTargetDate,
      recurrence: source.recurrence,
      lineItems: source.lineItems.map((item) => ({ label: item.label, amount: item.amount })),
    });
  }

  private insertLineItem(obligationId: string, input: CreateObligationLineItemInput, defaultPriority: number): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO obligation_line_items (id, obligation_id, label, amount, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, obligationId, input.label ?? null, input.amount, input.priority ?? defaultPriority, now, now]
    );
    return id;
  }

  createLineItem(obligationId: string, input: CreateObligationLineItemInput): Obligation {
    const nextPriority = this.getRawLineItems(obligationId).length;
    this.insertLineItem(obligationId, input, nextPriority);
    this.db.run(`UPDATE heloc_obligations SET updated_at = ? WHERE id = ?`, [new Date().toISOString(), obligationId]);
    saveDatabase(this.db);
    return this.getObligationById(obligationId)!;
  }

  updateLineItem(id: string, input: UpdateObligationLineItemInput): Obligation {
    const obligationId = this.getLineItemObligationId(id);
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
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      params.push(input.priority);
    }
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE obligation_line_items SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDatabase(this.db);

    return this.getObligationById(obligationId)!;
  }

  deleteLineItem(id: string): Obligation {
    const obligationId = this.getLineItemObligationId(id);
    this.db.run(`DELETE FROM obligation_line_items WHERE id = ?`, [id]);
    saveDatabase(this.db);
    return this.getObligationById(obligationId)!;
  }

  // Swaps this line item's precedence with its neighbor in the current sort order, so
  // moving it up means it gets paid off sooner by auto-allocated transactions.
  moveLineItem(id: string, direction: 'up' | 'down'): Obligation {
    const obligationId = this.getLineItemObligationId(id);
    const items = this.getRawLineItems(obligationId);
    const index = items.findIndex((i) => i.id === id);
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;

    if (index === -1 || neighborIndex < 0 || neighborIndex >= items.length) {
      return this.getObligationById(obligationId)!;
    }

    const current = items[index];
    const neighbor = items[neighborIndex];
    const now = new Date().toISOString();

    this.db.run(`UPDATE obligation_line_items SET priority = ?, updated_at = ? WHERE id = ?`, [
      neighbor.priority,
      now,
      current.id,
    ]);
    this.db.run(`UPDATE obligation_line_items SET priority = ?, updated_at = ? WHERE id = ?`, [
      current.priority,
      now,
      neighbor.id,
    ]);
    saveDatabase(this.db);

    return this.getObligationById(obligationId)!;
  }

  private getLineItemObligationId(id: string): string {
    const stmt = this.db.prepare(`SELECT obligation_id FROM obligation_line_items WHERE id = ?`);
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      throw new Error(`Obligation line item with id ${id} not found`);
    }
    const obligationId = stmt.get()[0] as string;
    stmt.free();
    return obligationId;
  }
}
