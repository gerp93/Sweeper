import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

let dbInstance: Database | null = null;

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'sweeper.db');

  let db: Database;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  dbInstance = db;

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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL
    )
  `);

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

  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_balance_anchors_date ON balance_anchors(as_of_date)`);

  saveDatabase(db, dbPath);

  console.log('Database initialized at:', dbPath);

  return db;
}

export function saveDatabase(db: Database, dbPath?: string): void {
  if (!dbPath) {
    const userDataPath = app.getPath('userData');
    dbPath = path.join(userDataPath, 'sweeper.db');
  }
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

export function getDatabase(): Database | null {
  return dbInstance;
}
