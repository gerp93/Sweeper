import { Database } from 'sql.js';
import {
  Obligation,
  ObligationLineItem,
  ObligationDateGroup,
  CreateObligationInput,
  UpdateObligationInput,
  CreateObligationLineItemInput,
  UpdateObligationLineItemInput,
} from '../../shared/types/obligation';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

interface RawLineItem {
  id: string;
  obligationId: string;
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
    obligationId: obj.obligationId,
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
  obligation_id as obligationId,
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

function buildDateGroups(items: ObligationLineItem[]): ObligationDateGroup[] {
  const groups = new Map<string | null, ObligationDateGroup>();
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
    createdAt: string;
    updatedAt: string;
  }): Obligation {
    const rawItems = this.getRawLineItems(obligationRow.id);
    const totalAllocated = this.getTotalAllocated(obligationRow.id);
    const lineItems = applyWaterfall(rawItems, totalAllocated);
    const dateGroups = buildDateGroups(lineItems);
    const amount = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const allocated = lineItems.reduce((sum, i) => sum + i.allocated, 0);

    return {
      ...obligationRow,
      lineItems,
      dateGroups,
      amount,
      allocated,
      remaining: amount - allocated,
    };
  }

  getAllObligations(): Obligation[] {
    const results = this.db.exec(`
      SELECT id, label, note, account_id as accountId, auto_allocate as autoAllocate, created_at as createdAt, updated_at as updatedAt
      FROM heloc_obligations
      ORDER BY created_at ASC
    `);
    if (results.length === 0) return [];
    const obligations = results[0].values.map((row) => {
      const obj: any = {};
      results[0].columns.forEach((col, idx) => (obj[col] = row[idx]));
      return this.buildObligation({ ...obj, autoAllocate: Boolean(obj.autoAllocate) });
    });

    // Soonest due date first -- dateGroups is already sorted ascending with undated groups
    // last, so each obligation's own earliest due date is just its first date group.
    // Obligations with no dated amounts at all sort to the end.
    return obligations.sort((a, b) => {
      const aDate = a.dateGroups[0]?.targetDate ?? null;
      const bDate = b.dateGroups[0]?.targetDate ?? null;
      if (aDate === bDate) return 0;
      if (aDate === null) return 1;
      if (bDate === null) return -1;
      return aDate < bDate ? -1 : 1;
    });
  }

  getObligationById(id: string): Obligation | null {
    const stmt = this.db.prepare(
      `SELECT id, label, note, account_id as accountId, auto_allocate as autoAllocate, created_at as createdAt, updated_at as updatedAt
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
    return this.buildObligation({ ...obj, autoAllocate: Boolean(obj.autoAllocate) });
  }

  getTotalObligated(): number {
    return this.getAllObligations().reduce((sum, o) => sum + o.remaining, 0);
  }

  createObligation(input: CreateObligationInput): Obligation {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO heloc_obligations (id, label, note, account_id, auto_allocate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.label, input.note ?? null, input.accountId ?? null, input.autoAllocate ? 1 : 0, now, now]
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

  private insertLineItem(obligationId: string, input: CreateObligationLineItemInput, defaultPriority: number): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO obligation_line_items (id, obligation_id, label, amount, target_date, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        obligationId,
        input.label ?? null,
        input.amount,
        input.targetDate ?? null,
        input.priority ?? defaultPriority,
        now,
        now,
      ]
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
