import { Database } from 'sql.js';
import { AccountAlias } from '../../shared/types/accountAlias';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToAlias(columns: string[], row: any[]): AccountAlias {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    accountId: obj.accountId,
    rawName: obj.rawName,
    createdAt: obj.createdAt,
  };
}

const SELECT_COLUMNS = `
  id,
  account_id as accountId,
  raw_name as rawName,
  created_at as createdAt
`;

export class AccountAliasService {
  constructor(private db: Database) {}

  getAllAliases(): AccountAlias[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM account_aliases ORDER BY raw_name COLLATE NOCASE`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToAlias(results[0].columns, row));
  }

  getAliasesForAccount(accountId: string): AccountAlias[] {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM account_aliases WHERE account_id = ? ORDER BY raw_name COLLATE NOCASE`);
    stmt.bind([accountId]);
    const out: AccountAlias[] = [];
    while (stmt.step()) {
      out.push(rowToAlias(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return out;
  }

  createAlias(accountId: string, rawName: string): AccountAlias {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(`INSERT INTO account_aliases (id, account_id, raw_name, created_at) VALUES (?, ?, ?, ?)`, [
      id,
      accountId,
      rawName,
      now,
    ]);

    saveDatabase(this.db);

    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM account_aliases WHERE id = ?`);
    stmt.bind([id]);
    stmt.step();
    const alias = rowToAlias(stmt.getColumnNames(), stmt.get());
    stmt.free();
    return alias;
  }

  deleteAlias(id: string): void {
    this.db.run(`DELETE FROM account_aliases WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }
}
