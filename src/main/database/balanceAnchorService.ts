import { Database } from 'sql.js';
import { BalanceAnchor, CreateBalanceAnchorInput } from '../../shared/types/balanceAnchor';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToAnchor(columns: string[], row: any[]): BalanceAnchor {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    balance: obj.balance,
    asOfDate: obj.asOfDate,
    note: obj.note,
    createdAt: obj.createdAt,
  };
}

const SELECT_COLUMNS = `
  id,
  balance,
  as_of_date as asOfDate,
  note,
  created_at as createdAt
`;

export class BalanceAnchorService {
  constructor(private db: Database) {}

  getAllAnchors(): BalanceAnchor[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM balance_anchors ORDER BY as_of_date DESC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToAnchor(results[0].columns, row));
  }

  getAnchorById(id: string): BalanceAnchor | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM balance_anchors WHERE id = ?`);
    stmt.bind([id]);
    const anchor = stmt.step() ? rowToAnchor(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return anchor;
  }

  getLatestAnchorAsOf(date: string): BalanceAnchor | null {
    const stmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM balance_anchors WHERE as_of_date <= ? ORDER BY as_of_date DESC LIMIT 1`
    );
    stmt.bind([date]);
    const anchor = stmt.step() ? rowToAnchor(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return anchor;
  }

  getEarliestAnchorAfter(date: string): BalanceAnchor | null {
    const stmt = this.db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM balance_anchors WHERE as_of_date > ? ORDER BY as_of_date ASC LIMIT 1`
    );
    stmt.bind([date]);
    const anchor = stmt.step() ? rowToAnchor(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return anchor;
  }

  createAnchor(input: CreateBalanceAnchorInput): BalanceAnchor {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO balance_anchors (id, balance, as_of_date, note, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, input.balance, input.asOfDate, input.note ?? null, now]
    );

    saveDatabase(this.db);

    return this.getAnchorById(id)!;
  }

  deleteAnchor(id: string): void {
    this.db.run(`DELETE FROM balance_anchors WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }
}
