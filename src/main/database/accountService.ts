import { Database } from 'sql.js';
import { Account, CreateAccountInput, UpdateAccountInput } from '../../shared/types/account';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToAccount(columns: string[], row: any[]): Account {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    rawName: obj.rawName,
    friendlyName: obj.friendlyName,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  raw_name as rawName,
  friendly_name as friendlyName,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class AccountService {
  constructor(private db: Database) {}

  getAllAccounts(): Account[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM accounts ORDER BY friendly_name COLLATE NOCASE`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToAccount(results[0].columns, row));
  }

  getAccountById(id: string): Account | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM accounts WHERE id = ?`);
    stmt.bind([id]);
    const account = stmt.step() ? rowToAccount(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return account;
  }

  getAccountByRawName(rawName: string): Account | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM accounts WHERE raw_name = ?`);
    stmt.bind([rawName]);
    const account = stmt.step() ? rowToAccount(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return account;
  }

  createAccount(input: CreateAccountInput): Account {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO accounts (id, raw_name, friendly_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, input.rawName, input.friendlyName, now, now]
    );

    saveDatabase(this.db);

    return this.getAccountById(id)!;
  }

  updateAccount(id: string, input: UpdateAccountInput): Account {
    const existing = this.getAccountById(id);
    if (!existing) {
      throw new Error(`Account with id ${id} not found`);
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: any[] = [];

    if (input.rawName !== undefined) {
      updates.push('raw_name = ?');
      params.push(input.rawName);
    }
    if (input.friendlyName !== undefined) {
      updates.push('friendly_name = ?');
      params.push(input.friendlyName);
    }

    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);

    this.db.run(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDatabase(this.db);

    return this.getAccountById(id)!;
  }

  deleteAccount(id: string): void {
    this.db.run(`DELETE FROM accounts WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }

  findOrCreateByRawName(rawName: string, friendlyName: string): Account {
    const existing = this.getAccountByRawName(rawName);
    if (existing) return existing;
    return this.createAccount({ rawName, friendlyName });
  }

  mergeAccounts(sourceId: string, targetId: string): Account {
    if (sourceId === targetId) {
      throw new Error('Cannot merge an account into itself');
    }
    const source = this.getAccountById(sourceId);
    const target = this.getAccountById(targetId);
    if (!source) throw new Error(`Account with id ${sourceId} not found`);
    if (!target) throw new Error(`Account with id ${targetId} not found`);

    const now = new Date().toISOString();
    this.db.run(`UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ?`, [
      targetId,
      now,
      sourceId,
    ]);
    this.db.run(`DELETE FROM accounts WHERE id = ?`, [sourceId]);

    saveDatabase(this.db);

    return this.getAccountById(targetId)!;
  }
}
