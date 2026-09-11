import { Database } from 'sql.js';
import {
  Reserve,
  ReserveLineItem,
  ReserveDateGroup,
  CreateReserveInput,
  UpdateReserveInput,
  CreateReserveLineItemInput,
  UpdateReserveLineItemInput,
} from '../../shared/types/reserve';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

interface RawLineItem {
  id: string;
  reserveId: string;
  label: string | null;
  amount: number;
  targetDate: string | null;
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
    reserveId: obj.reserveId,
    label: obj.label,
    amount: obj.amount,
    targetDate: obj.targetDate,
    priority: obj.priority,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const LINE_ITEM_COLUMNS = `
  id,
  reserve_id as reserveId,
  label,
  amount,
  target_date as targetDate,
  priority,
  created_at as createdAt,
  updated_at as updatedAt
`;

// Precedence order: lowest priority number goes first, ties broken by the soonest target
// date (undated items last), then by creation order.
const LINE_ITEM_PRECEDENCE_ORDER = `ORDER BY priority ASC, (target_date IS NULL), target_date ASC, created_at ASC`;

// A transaction allocated to a reserve doesn't say which specific line item it's for (the
// whole point -- e.g. three same-day store-card promo balances that a single payment can't
// be told apart between). Instead, the reserve's total allocated dollars cascade through its
// line items in precedence order: fully pay off the first, then spill into the next, etc.
function applyWaterfall(items: RawLineItem[], totalAllocated: number): ReserveLineItem[] {
  let pool = Math.max(totalAllocated, 0);
  return items.map((item) => {
    const allocated = Math.min(item.amount, pool);
    pool -= allocated;
    return { ...item, allocated, remaining: item.amount - allocated };
  });
}

function buildDateGroups(items: ReserveLineItem[]): ReserveDateGroup[] {
  const groups = new Map<string | null, ReserveDateGroup>();
  for (const item of items) {
    const key = item.targetDate;
    const existing = groups.get(key);
    if (existing) {
      existing.amount += item.amount;
      existing.allocated += item.allocated;
      existing.remaining += item.remaining;
    } else {
      groups.set(key, { targetDate: key, amount: item.amount, allocated: item.allocated, remaining: item.remaining });
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.targetDate === b.targetDate) return 0;
    if (a.targetDate === null) return 1;
    if (b.targetDate === null) return -1;
    return a.targetDate < b.targetDate ? -1 : 1;
  });
}

export class ReserveService {
  constructor(private db: Database) {}

  private getRawLineItems(reserveId: string): RawLineItem[] {
    const stmt = this.db.prepare(
      `SELECT ${LINE_ITEM_COLUMNS} FROM reserve_line_items WHERE reserve_id = ? ${LINE_ITEM_PRECEDENCE_ORDER}`
    );
    stmt.bind([reserveId]);
    const out: RawLineItem[] = [];
    while (stmt.step()) {
      out.push(rowToRawLineItem(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return out;
  }

  private getTotalAllocated(reserveId: string): number {
    const stmt = this.db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE reserve_id = ?`);
    stmt.bind([reserveId]);
    const total = stmt.step() ? Number(stmt.get()[0]) : 0;
    stmt.free();
    return total;
  }

  private buildReserve(reserveRow: { id: string; label: string; note: string | null; accountId: string | null; autoAllocate: boolean; createdAt: string; updatedAt: string }): Reserve {
    const rawItems = this.getRawLineItems(reserveRow.id);
    const totalAllocated = this.getTotalAllocated(reserveRow.id);
    const lineItems = applyWaterfall(rawItems, totalAllocated);
    const dateGroups = buildDateGroups(lineItems);
    const amount = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const allocated = lineItems.reduce((sum, i) => sum + i.allocated, 0);

    return {
      ...reserveRow,
      lineItems,
      dateGroups,
      amount,
      allocated,
      remaining: amount - allocated,
    };
  }

  getAllReserves(): Reserve[] {
    const results = this.db.exec(`
      SELECT id, label, note, account_id as accountId, auto_allocate as autoAllocate, created_at as createdAt, updated_at as updatedAt
      FROM heloc_reserves
      ORDER BY created_at ASC
    `);
    if (results.length === 0) return [];
    return results[0].values.map((row) => {
      const obj: any = {};
      results[0].columns.forEach((col, idx) => (obj[col] = row[idx]));
      return this.buildReserve({ ...obj, autoAllocate: Boolean(obj.autoAllocate) });
    });
  }

  getReserveById(id: string): Reserve | null {
    const stmt = this.db.prepare(
      `SELECT id, label, note, account_id as accountId, auto_allocate as autoAllocate, created_at as createdAt, updated_at as updatedAt
       FROM heloc_reserves WHERE id = ?`
    );
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const obj: any = {};
    stmt.getColumnNames().forEach((col, idx) => (obj[col] = stmt.get()[idx]));
    stmt.free();
    return this.buildReserve({ ...obj, autoAllocate: Boolean(obj.autoAllocate) });
  }

  getTotalReserved(): number {
    return this.getAllReserves().reduce((sum, r) => sum + r.remaining, 0);
  }

  createReserve(input: CreateReserveInput): Reserve {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO heloc_reserves (id, label, note, account_id, auto_allocate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.label, input.note ?? null, input.accountId ?? null, input.autoAllocate ? 1 : 0, now, now]
    );

    input.lineItems.forEach((item, index) => {
      this.insertLineItem(id, item, index);
    });

    saveDatabase(this.db);

    return this.getReserveById(id)!;
  }

  updateReserve(id: string, input: UpdateReserveInput): Reserve {
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
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE heloc_reserves SET ${updates.join(', ')} WHERE id = ?`, params);

    saveDatabase(this.db);

    return this.getReserveById(id)!;
  }

  deleteReserve(id: string): void {
    this.db.run(`DELETE FROM heloc_reserves WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }

  private insertLineItem(reserveId: string, input: CreateReserveLineItemInput, defaultPriority: number): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO reserve_line_items (id, reserve_id, label, amount, target_date, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, reserveId, input.label ?? null, input.amount, input.targetDate ?? null, input.priority ?? defaultPriority, now, now]
    );
    return id;
  }

  createLineItem(reserveId: string, input: CreateReserveLineItemInput): Reserve {
    const nextPriority = this.getRawLineItems(reserveId).length;
    this.insertLineItem(reserveId, input, nextPriority);
    this.db.run(`UPDATE heloc_reserves SET updated_at = ? WHERE id = ?`, [new Date().toISOString(), reserveId]);
    saveDatabase(this.db);
    return this.getReserveById(reserveId)!;
  }

  updateLineItem(id: string, input: UpdateReserveLineItemInput): Reserve {
    const reserveId = this.getLineItemReserveId(id);
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
    if (input.targetDate !== undefined) {
      updates.push('target_date = ?');
      params.push(input.targetDate);
    }
    if (input.priority !== undefined) {
      updates.push('priority = ?');
      params.push(input.priority);
    }
    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE reserve_line_items SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDatabase(this.db);

    return this.getReserveById(reserveId)!;
  }

  deleteLineItem(id: string): Reserve {
    const reserveId = this.getLineItemReserveId(id);
    this.db.run(`DELETE FROM reserve_line_items WHERE id = ?`, [id]);
    saveDatabase(this.db);
    return this.getReserveById(reserveId)!;
  }

  // Swaps this line item's precedence with its neighbor in the current sort order, so
  // moving it up means it gets paid off sooner by auto-allocated transactions.
  moveLineItem(id: string, direction: 'up' | 'down'): Reserve {
    const reserveId = this.getLineItemReserveId(id);
    const items = this.getRawLineItems(reserveId);
    const index = items.findIndex((i) => i.id === id);
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;

    if (index === -1 || neighborIndex < 0 || neighborIndex >= items.length) {
      return this.getReserveById(reserveId)!;
    }

    const current = items[index];
    const neighbor = items[neighborIndex];
    const now = new Date().toISOString();

    this.db.run(`UPDATE reserve_line_items SET priority = ?, updated_at = ? WHERE id = ?`, [
      neighbor.priority,
      now,
      current.id,
    ]);
    this.db.run(`UPDATE reserve_line_items SET priority = ?, updated_at = ? WHERE id = ?`, [
      current.priority,
      now,
      neighbor.id,
    ]);
    saveDatabase(this.db);

    return this.getReserveById(reserveId)!;
  }

  private getLineItemReserveId(id: string): string {
    const stmt = this.db.prepare(`SELECT reserve_id FROM reserve_line_items WHERE id = ?`);
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      throw new Error(`Reserve line item with id ${id} not found`);
    }
    const reserveId = stmt.get()[0] as string;
    stmt.free();
    return reserveId;
  }
}
