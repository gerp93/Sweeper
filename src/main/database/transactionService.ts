import { Database } from 'sql.js';
import { Transaction, CreateTransactionInput, UpdateTransactionInput } from '../../shared/types/transaction';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToTransaction(columns: string[], row: any[]): Transaction {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    accountId: obj.accountId,
    date: obj.date,
    description: obj.description,
    refCheck: obj.refCheck,
    amount: obj.amount,
    memo: obj.memo,
    category: obj.category,
    importBatchId: obj.importBatchId,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  account_id as accountId,
  date,
  description,
  ref_check as refCheck,
  amount,
  memo,
  category,
  import_batch_id as importBatchId,
  created_at as createdAt,
  updated_at as updatedAt
`;

export class TransactionService {
  constructor(private db: Database) {}

  getAllTransactions(): Transaction[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM transactions ORDER BY date DESC, created_at DESC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToTransaction(results[0].columns, row));
  }

  getTransactionById(id: string): Transaction | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM transactions WHERE id = ?`);
    stmt.bind([id]);
    const tx = stmt.step() ? rowToTransaction(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return tx;
  }

  getTransactionsAfterDate(date: string): Transaction[] {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM transactions WHERE date > ? ORDER BY date ASC`);
    stmt.bind([date]);
    const out: Transaction[] = [];
    while (stmt.step()) {
      out.push(rowToTransaction(stmt.getColumnNames(), stmt.get()));
    }
    stmt.free();
    return out;
  }

  createTransaction(input: CreateTransactionInput): Transaction {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO transactions (
        id, account_id, date, description, ref_check, amount, memo, category, import_batch_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.accountId,
        input.date,
        input.description,
        input.refCheck ?? null,
        input.amount,
        input.memo ?? null,
        input.category ?? null,
        input.importBatchId ?? null,
        now,
        now,
      ]
    );

    saveDatabase(this.db);

    return this.getTransactionById(id)!;
  }

  createTransactionsBulk(inputs: CreateTransactionInput[]): Transaction[] {
    const created: Transaction[] = [];
    for (const input of inputs) {
      const id = uuidv4();
      const now = new Date().toISOString();
      this.db.run(
        `INSERT INTO transactions (
          id, account_id, date, description, ref_check, amount, memo, category, import_batch_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.accountId,
          input.date,
          input.description,
          input.refCheck ?? null,
          input.amount,
          input.memo ?? null,
          input.category ?? null,
          input.importBatchId ?? null,
          now,
          now,
        ]
      );
      created.push(this.getTransactionById(id)!);
    }

    saveDatabase(this.db);

    return created;
  }

  updateTransaction(id: string, input: UpdateTransactionInput): Transaction {
    const existing = this.getTransactionById(id);
    if (!existing) {
      throw new Error(`Transaction with id ${id} not found`);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (input.accountId !== undefined) {
      updates.push('account_id = ?');
      params.push(input.accountId);
    }
    if (input.date !== undefined) {
      updates.push('date = ?');
      params.push(input.date);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description);
    }
    if (input.refCheck !== undefined) {
      updates.push('ref_check = ?');
      params.push(input.refCheck);
    }
    if (input.amount !== undefined) {
      updates.push('amount = ?');
      params.push(input.amount);
    }
    if (input.memo !== undefined) {
      updates.push('memo = ?');
      params.push(input.memo);
    }
    if (input.category !== undefined) {
      updates.push('category = ?');
      params.push(input.category);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDatabase(this.db);

    return this.getTransactionById(id)!;
  }

  deleteTransaction(id: string): void {
    this.db.run(`DELETE FROM transactions WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }
}
