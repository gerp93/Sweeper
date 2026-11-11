import { Database } from 'sql.js';
import { CashEntry, CreateCashEntryInput } from '../../shared/types/cashEntry';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToEntry(columns: string[], row: any[]): CashEntry {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    amount: obj.amount,
    date: obj.date,
    note: obj.note,
    createdAt: obj.createdAt,
  };
}

const SELECT_COLUMNS = `
  id,
  amount,
  date,
  note,
  created_at as createdAt
`;

export class CashEntryService {
  constructor(private db: Database) {}

  getAllEntries(): CashEntry[] {
    const results = this.db.exec(
      `SELECT ${SELECT_COLUMNS} FROM cash_entries ORDER BY date DESC, created_at DESC`
    );
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToEntry(results[0].columns, row));
  }

  getEntryById(id: string): CashEntry | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM cash_entries WHERE id = ?`);
    stmt.bind([id]);
    const entry = stmt.step() ? rowToEntry(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return entry;
  }

  createEntry(input: CreateCashEntryInput): CashEntry {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(`INSERT INTO cash_entries (id, amount, date, note, created_at) VALUES (?, ?, ?, ?, ?)`, [
      id,
      input.amount,
      input.date,
      input.note ?? null,
      now,
    ]);

    saveDatabase(this.db);

    return this.getEntryById(id)!;
  }

  deleteEntry(id: string): void {
    this.db.run(`DELETE FROM cash_entries WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }
}
