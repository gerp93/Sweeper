import { Database } from 'sql.js';
import { ImportBatch, CreateImportBatchInput } from '../../shared/types/importBatch';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToBatch(columns: string[], row: any[]): ImportBatch {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    fileName: obj.fileName,
    importedAt: obj.importedAt,
    rowCount: obj.rowCount,
    includedCount: obj.includedCount,
    excludedCount: obj.excludedCount,
  };
}

const SELECT_COLUMNS = `
  id,
  file_name as fileName,
  imported_at as importedAt,
  row_count as rowCount,
  included_count as includedCount,
  excluded_count as excludedCount
`;

export class ImportBatchService {
  constructor(private db: Database) {}

  getAllBatches(): ImportBatch[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM import_batches ORDER BY imported_at DESC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToBatch(results[0].columns, row));
  }

  getBatchById(id: string): ImportBatch | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM import_batches WHERE id = ?`);
    stmt.bind([id]);
    const batch = stmt.step() ? rowToBatch(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return batch;
  }

  createBatch(input: CreateImportBatchInput): ImportBatch {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO import_batches (id, file_name, imported_at, row_count, included_count, excluded_count) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.fileName, now, input.rowCount, input.includedCount, input.excludedCount]
    );

    saveDatabase(this.db);

    return this.getBatchById(id)!;
  }
}
