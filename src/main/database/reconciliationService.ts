import { Database } from 'sql.js';
import { Reconciliation, CreateReconciliationInput } from '../../shared/types/reconciliation';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';
import { BalanceService } from './balanceService';

function rowToReconciliation(columns: string[], row: any[]): Reconciliation {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    asOfDate: obj.asOfDate,
    bankBalance: obj.bankBalance,
    computedBalance: obj.computedBalance,
    difference: obj.difference,
    note: obj.note,
    createdAt: obj.createdAt,
  };
}

const SELECT_COLUMNS = `
  id,
  as_of_date as asOfDate,
  bank_balance as bankBalance,
  computed_balance as computedBalance,
  difference,
  note,
  created_at as createdAt
`;

export class ReconciliationService {
  constructor(private db: Database, private balanceService: BalanceService) {}

  getAllReconciliations(): Reconciliation[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM reconciliations ORDER BY as_of_date DESC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToReconciliation(results[0].columns, row));
  }

  getReconciliationById(id: string): Reconciliation | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM reconciliations WHERE id = ?`);
    stmt.bind([id]);
    const reconciliation = stmt.step() ? rowToReconciliation(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return reconciliation;
  }

  createReconciliation(input: CreateReconciliationInput): Reconciliation {
    const today = new Date().toISOString().slice(0, 10);
    if (input.asOfDate > today) {
      throw new Error('Cannot reconcile a date in the future.');
    }

    const computedBalance = this.balanceService.getSpendableBalance(input.asOfDate).balance;
    const difference = input.bankBalance - computedBalance;

    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO reconciliations (id, as_of_date, bank_balance, computed_balance, difference, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.asOfDate, input.bankBalance, computedBalance, difference, input.note ?? null, now]
    );

    saveDatabase(this.db);

    return this.getReconciliationById(id)!;
  }

  deleteReconciliation(id: string): void {
    this.db.run(`DELETE FROM reconciliations WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }
}
