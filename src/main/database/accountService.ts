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
    friendlyName: obj.friendlyName,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
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

  createAccount(input: CreateAccountInput): Account {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(`INSERT INTO accounts (id, friendly_name, created_at, updated_at) VALUES (?, ?, ?, ?)`, [
      id,
      input.friendlyName,
      now,
      now,
    ]);

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

  // Reassigns the source account's aliases to the target (so every raw description that
  // used to match the source keeps matching on future imports -- merging used to just
  // delete them, which meant the next import of that description silently recreated the
  // "duplicate" account the merge was supposed to get rid of), moves its transactions over,
  // then removes the now-empty source account.
  mergeAccounts(sourceId: string, targetId: string, memo?: string | null): Account {
    if (sourceId === targetId) {
      throw new Error('Cannot merge an account into itself');
    }
    const source = this.getAccountById(sourceId);
    const target = this.getAccountById(targetId);
    if (!source) throw new Error(`Account with id ${sourceId} not found`);
    if (!target) throw new Error(`Account with id ${targetId} not found`);

    const now = new Date().toISOString();
    const trimmedMemo = memo?.trim();

    this.db.run(`UPDATE account_aliases SET account_id = ? WHERE account_id = ?`, [targetId, sourceId]);
    // recurring_bills.account_id has ON DELETE SET NULL for a fresh FK, which would silently
    // orphan a bill's account link when the source account gets deleted below -- reassign it
    // explicitly first, same as aliases and transactions, so the merge preserves the link.
    this.db.run(`UPDATE recurring_bills SET account_id = ? WHERE account_id = ?`, [targetId, sourceId]);

    if (trimmedMemo) {
      // Only the transactions moving over from the source account get the memo appended --
      // ones already sitting on the target account are left untouched.
      this.db.run(
        `UPDATE transactions
         SET account_id = ?,
             memo = CASE WHEN memo IS NULL OR memo = '' THEN ? ELSE memo || '; ' || ? END,
             updated_at = ?
         WHERE account_id = ?`,
        [targetId, trimmedMemo, trimmedMemo, now, sourceId]
      );
    } else {
      this.db.run(`UPDATE transactions SET account_id = ?, updated_at = ? WHERE account_id = ?`, [
        targetId,
        now,
        sourceId,
      ]);
    }

    this.db.run(`DELETE FROM accounts WHERE id = ?`, [sourceId]);

    saveDatabase(this.db);

    return this.getAccountById(targetId)!;
  }
}
