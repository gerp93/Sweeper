import { Database } from 'sql.js';
import { ImportRule, CreateImportRuleInput, UpdateImportRuleInput } from '../../shared/types/importRule';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';

function rowToRule(columns: string[], row: any[]): ImportRule {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    field: obj.field,
    matchType: obj.matchType,
    pattern: obj.pattern,
    isActive: Boolean(obj.isActive),
    createdAt: obj.createdAt,
  };
}

const SELECT_COLUMNS = `
  id,
  field,
  match_type as matchType,
  pattern,
  is_active as isActive,
  created_at as createdAt
`;

export class ImportRuleService {
  constructor(private db: Database) {}

  getAllRules(): ImportRule[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM import_rules ORDER BY created_at ASC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToRule(results[0].columns, row));
  }

  getActiveRules(): ImportRule[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM import_rules WHERE is_active = 1 ORDER BY created_at ASC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToRule(results[0].columns, row));
  }

  getRuleById(id: string): ImportRule | null {
    const stmt = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM import_rules WHERE id = ?`);
    stmt.bind([id]);
    const rule = stmt.step() ? rowToRule(stmt.getColumnNames(), stmt.get()) : null;
    stmt.free();
    return rule;
  }

  createRule(input: CreateImportRuleInput): ImportRule {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO import_rules (id, field, match_type, pattern, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.field, input.matchType, input.pattern, input.isActive === false ? 0 : 1, now]
    );

    saveDatabase(this.db);

    return this.getRuleById(id)!;
  }

  updateRule(id: string, input: UpdateImportRuleInput): ImportRule {
    const existing = this.getRuleById(id);
    if (!existing) {
      throw new Error(`Import rule with id ${id} not found`);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (input.field !== undefined) {
      updates.push('field = ?');
      params.push(input.field);
    }
    if (input.matchType !== undefined) {
      updates.push('match_type = ?');
      params.push(input.matchType);
    }
    if (input.pattern !== undefined) {
      updates.push('pattern = ?');
      params.push(input.pattern);
    }
    if (input.isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(input.isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(id);
      this.db.run(`UPDATE import_rules SET ${updates.join(', ')} WHERE id = ?`, params);
      saveDatabase(this.db);
    }

    return this.getRuleById(id)!;
  }

  deleteRule(id: string): void {
    this.db.run(`DELETE FROM import_rules WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }

  seedDefaultRules(): void {
    const existing = this.getAllRules();
    if (existing.length > 0) return;

    this.createRule({ field: 'description', matchType: 'contains', pattern: 'LNS PAY TO' });
    this.createRule({ field: 'description', matchType: 'contains', pattern: 'LNS ADV FRM' });
  }
}
