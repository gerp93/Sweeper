import { Database } from 'sql.js';
import { Reserve, CreateReserveInput, UpdateReserveInput } from '../../shared/types/reserve';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToReserve(columns: string[], row: any[]): Reserve {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  const amount = obj.amount;
  const allocated = Number(obj.allocated ?? 0);
  return {
    id: obj.id,
    label: obj.label,
    amount,
    targetDate: obj.targetDate,
    note: obj.note,
    accountId: obj.accountId,
    autoAllocate: Boolean(obj.autoAllocate),
    allocated,
    remaining: amount - allocated,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// Allocated = the sum of every transaction's signed amount that's been assigned to this
// reserve (a payment towards it is a positive amount, so allocating one brings the
// reserve's remaining need down, same as the user pays down the real HELOC balance).
const SELECT_WITH_ALLOCATIONS = `
  SELECT
    r.id,
    r.label,
    r.amount,
    r.target_date as targetDate,
    r.note,
    r.account_id as accountId,
    r.auto_allocate as autoAllocate,
    r.created_at as createdAt,
    r.updated_at as updatedAt,
    COALESCE(SUM(t.amount), 0) as allocated
  FROM heloc_reserves r
  LEFT JOIN transactions t ON t.reserve_id = r.id
`;

export class ReserveService {
  constructor(private db: Database) {}

  getAllReserves(): Reserve[] {
    // Reserves with a target date soonest-first, undated ones (no deadline) last.
    const results = this.db.exec(`
      ${SELECT_WITH_ALLOCATIONS}
      GROUP BY r.id
      ORDER BY (r.target_date IS NULL), r.target_date ASC, r.created_at ASC
    `);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToReserve(results[0].columns, row));
  }

  getReserveById(id: string): Reserve | null {
    const stmt = this.db.prepare(`${SELECT_WITH_ALLOCATIONS} WHERE r.id = ? GROUP BY r.id`);
    stmt.bind([id]);
    const reserve = stmt.step() ? rowToReserve(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return reserve;
  }

  getTotalReserved(): number {
    return this.getAllReserves().reduce((sum, r) => sum + r.remaining, 0);
  }

  createReserve(input: CreateReserveInput): Reserve {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO heloc_reserves (id, label, amount, target_date, note, account_id, auto_allocate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.label,
        input.amount,
        input.targetDate ?? null,
        input.note ?? null,
        input.accountId ?? null,
        input.autoAllocate ? 1 : 0,
        now,
        now,
      ]
    );

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
    if (input.amount !== undefined) {
      updates.push('amount = ?');
      params.push(input.amount);
    }
    if (input.targetDate !== undefined) {
      updates.push('target_date = ?');
      params.push(input.targetDate);
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
}
