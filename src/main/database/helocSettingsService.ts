import { Database } from 'sql.js';
import { HelocSettings, UpdateHelocSettingsInput } from '../../shared/types/helocSettings';
import { saveDatabase } from './schema';

const SINGLETON_ID = 'heloc';

function rowToSettings(columns: string[], row: any[]): HelocSettings {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    originalAmount: obj.originalAmount,
    originationDate: obj.originationDate,
    annualFeeAmount: obj.annualFeeAmount,
    annualFeeMonthDay: obj.annualFeeMonthDay,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  original_amount as originalAmount,
  origination_date as originationDate,
  annual_fee_amount as annualFeeAmount,
  annual_fee_month_day as annualFeeMonthDay,
  updated_at as updatedAt
`;

export class HelocSettingsService {
  constructor(private db: Database) {}

  get(): HelocSettings | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM heloc_settings WHERE id = ?`);
    stmt.bind([SINGLETON_ID]);
    const settings = stmt.step() ? rowToSettings(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return settings;
  }

  update(input: UpdateHelocSettingsInput): HelocSettings {
    const now = new Date().toISOString();
    const existing = this.get();

    if (!existing) {
      this.db.run(
        `INSERT INTO heloc_settings (id, original_amount, origination_date, annual_fee_amount, annual_fee_month_day, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          SINGLETON_ID,
          input.originalAmount ?? null,
          input.originationDate ?? null,
          input.annualFeeAmount ?? null,
          input.annualFeeMonthDay ?? null,
          now,
        ]
      );
    } else {
      const updates: string[] = [];
      const params: any[] = [];

      if (input.originalAmount !== undefined) {
        updates.push('original_amount = ?');
        params.push(input.originalAmount);
      }
      if (input.originationDate !== undefined) {
        updates.push('origination_date = ?');
        params.push(input.originationDate);
      }
      if (input.annualFeeAmount !== undefined) {
        updates.push('annual_fee_amount = ?');
        params.push(input.annualFeeAmount);
      }
      if (input.annualFeeMonthDay !== undefined) {
        updates.push('annual_fee_month_day = ?');
        params.push(input.annualFeeMonthDay);
      }
      updates.push('updated_at = ?');
      params.push(now);
      params.push(SINGLETON_ID);

      this.db.run(`UPDATE heloc_settings SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    saveDatabase(this.db);
    return this.get()!;
  }

  getFeeYears(): number[] {
    const results = this.db.exec(`SELECT year FROM heloc_fee_years ORDER BY year`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => Number(row[0]));
  }

  markFeeYear(year: number): void {
    this.db.run(`INSERT OR IGNORE INTO heloc_fee_years (year, marked_at) VALUES (?, ?)`, [
      year,
      new Date().toISOString(),
    ]);
    saveDatabase(this.db);
  }

  unmarkFeeYear(year: number): void {
    this.db.run(`DELETE FROM heloc_fee_years WHERE year = ?`, [year]);
    saveDatabase(this.db);
  }
}
