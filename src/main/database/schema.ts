import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getEffectiveDbPath } from '../dbLocation';

let dbInstance: Database | null = null;
let currentDbPath: string | null = null;

export async function initDatabase(dbPath?: string): Promise<Database> {
  const SQL = await initSqlJs();
  dbPath = dbPath ?? getEffectiveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  let db: Database;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  dbInstance = db;
  currentDbPath = dbPath;

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      raw_name TEXT NOT NULL UNIQUE,
      friendly_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS import_rules (
      id TEXT PRIMARY KEY,
      field TEXT NOT NULL,
      match_type TEXT NOT NULL,
      pattern TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      included_count INTEGER NOT NULL DEFAULT 0,
      excluded_count INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS heloc_reserves (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      note TEXT,
      account_id TEXT,
      auto_allocate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
  `);

  // Migration: account-linked auto-allocation was added after heloc_reserves already
  // shipped -- add the columns to databases created before this change.
  try {
    db.run(`ALTER TABLE heloc_reserves ADD COLUMN account_id TEXT`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_reserves ADD COLUMN auto_allocate INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    // already exists
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS reserve_line_items (
      id TEXT PRIMARY KEY,
      reserve_id TEXT NOT NULL,
      label TEXT,
      amount REAL NOT NULL,
      target_date TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (reserve_id) REFERENCES heloc_reserves(id) ON DELETE CASCADE
    )
  `);

  // Migration: a reserve's single amount/target_date became one-or-more line items (so a
  // reserve can hold several distinct promo balances, e.g. same-day purchases on a store
  // card that each carry their own payoff date). Backfill one line item per pre-existing
  // reserve from its old columns, then drop those now-unused columns.
  try {
    const legacy = db.exec(`SELECT id, amount, target_date, created_at, updated_at FROM heloc_reserves`);
    if (legacy.length > 0) {
      const existing = db.exec(`SELECT DISTINCT reserve_id FROM reserve_line_items`);
      const alreadyMigrated = new Set(existing.length > 0 ? existing[0].values.map((row) => row[0]) : []);
      for (const [id, amount, targetDate, createdAt, updatedAt] of legacy[0].values) {
        if (alreadyMigrated.has(id)) continue;
        db.run(
          `INSERT INTO reserve_line_items (id, reserve_id, amount, target_date, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
          [uuidv4(), id, amount, targetDate, createdAt, updatedAt]
        );
      }
    }
  } catch (e) {
    // heloc_reserves has no amount/target_date columns -- already migrated or a fresh database
  }
  try {
    db.run(`ALTER TABLE heloc_reserves DROP COLUMN amount`);
  } catch (e) {
    // already dropped or never existed
  }
  try {
    db.run(`ALTER TABLE heloc_reserves DROP COLUMN target_date`);
  } catch (e) {
    // already dropped or never existed
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      ref_check TEXT,
      amount REAL NOT NULL,
      memo TEXT,
      category TEXT,
      import_batch_id TEXT,
      reserve_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,
      FOREIGN KEY (reserve_id) REFERENCES heloc_reserves(id) ON DELETE SET NULL
    )
  `);

  // Migration: reserve allocation was added after transactions already shipped -- add the
  // column to databases created before this change.
  try {
    db.run(`ALTER TABLE transactions ADD COLUMN reserve_id TEXT`);
  } catch (e) {
    // already exists
  }

  // Migration: the "hidden/excluded transaction" concept was removed -- rule-matched
  // and skipped rows are no longer stored at all, just left out at import time.
  // Clean up any rows an older version of the app had already stored as excluded,
  // then drop the now-unused columns from databases created before this change.
  try {
    db.run(`DELETE FROM transactions WHERE is_excluded = 1`);
  } catch (e) {
    // column doesn't exist on a fresh database -- nothing to clean up
  }
  try {
    db.run(`ALTER TABLE transactions DROP COLUMN is_excluded`);
  } catch (e) {
    // already dropped or never existed
  }
  try {
    db.run(`ALTER TABLE transactions DROP COLUMN exclusion_reason`);
  } catch (e) {
    // already dropped or never existed
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS balance_anchors (
      id TEXT PRIMARY KEY,
      balance REAL NOT NULL,
      as_of_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS heloc_settings (
      id TEXT PRIMARY KEY,
      original_amount REAL,
      origination_date TEXT,
      annual_fee_amount REAL,
      annual_fee_month_day TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  // Migration: add annual-fee tracking fields to databases created before this change.
  try {
    db.run(`ALTER TABLE heloc_settings ADD COLUMN annual_fee_amount REAL`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_settings ADD COLUMN annual_fee_month_day TEXT`);
  } catch (e) {
    // already exists
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS heloc_fee_years (
      year INTEGER PRIMARY KEY,
      marked_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reconciliations (
      id TEXT PRIMARY KEY,
      as_of_date TEXT NOT NULL,
      bank_balance REAL NOT NULL,
      computed_balance REAL NOT NULL,
      difference REAL NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_reserve ON transactions(reserve_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_balance_anchors_date ON balance_anchors(as_of_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reconciliations_date ON reconciliations(as_of_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reserve_line_items_reserve ON reserve_line_items(reserve_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reserve_line_items_target_date ON reserve_line_items(target_date)`);

  saveDatabase(db, dbPath);

  console.log('Database initialized at:', dbPath);

  return db;
}

export function saveDatabase(db: Database, dbPath?: string): void {
  if (!dbPath) {
    dbPath = currentDbPath ?? getEffectiveDbPath();
  }
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export function getDatabase(): Database | null {
  return dbInstance;
}
