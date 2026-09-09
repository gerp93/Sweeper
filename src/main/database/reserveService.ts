import { Database } from 'sql.js';
import { Reserve, CreateReserveInput, UpdateReserveInput } from '../../shared/types/reserve';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToReserve(columns: string[], row: any[]): Reserve {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    label: obj.label,
    amount: obj.amount,
    targetDate: obj.targetDate,
    note: obj.note,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  label,
  amount,
  target_date as targetDate,
  note,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class ReserveService {
  constructor(private db: Database) {}

  getAllReserves(): Reserve[] {
    // Reserves with a target date soonest-first, undated ones (no deadline) last.
    const results = this.db.exec(`
      SELECT ${SELECT_COLUMNS} FROM heloc_reserves
      ORDER BY (target_date IS NULL), target_date ASC, created_at ASC
    `);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToReserve(results[0].columns, row));
  }

  getReserveById(id: string): Reserve | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM heloc_reserves WHERE id = ?`);
    stmt.bind([id]);
    const reserve = stmt.step() ? rowToReserve(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return reserve;
  }

  getTotalReserved(): number {
    const results = this.db.exec(`SELECT COALESCE(SUM(amount), 0) as total FROM heloc_reserves`);
    if (results.length === 0) return 0;
    return Number(results[0].values[0][0]);
  }

  createReserve(input: CreateReserveInput): Reserve {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO heloc_reserves (id, label, amount, target_date, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.label, input.amount, input.targetDate ?? null, input.note ?? null, now, now]
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
