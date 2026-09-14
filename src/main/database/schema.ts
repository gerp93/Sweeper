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

  // Migration: "Reserves" was renamed to "Obligations" -- the old term read as money being
  // saved up, when it's actually the opposite (money already owed, held back from the
  // spendable balance). Rename the tables/columns in place; no data is touched. Guarded
  // because a fresh database, or one that's already been renamed, won't have the old names.
  try {
    db.run(`ALTER TABLE heloc_reserves RENAME TO heloc_obligations`);
  } catch (e) {
    // already renamed, or never existed
  }
  try {
    db.run(`ALTER TABLE reserve_line_items RENAME TO obligation_line_items`);
  } catch (e) {
    // already renamed, or never existed
  }
  try {
    db.run(`ALTER TABLE obligation_line_items RENAME COLUMN reserve_id TO obligation_id`);
  } catch (e) {
    // already renamed, or never existed
  }
  try {
    db.run(`ALTER TABLE transactions RENAME COLUMN reserve_id TO obligation_id`);
  } catch (e) {
    // already renamed, or table doesn't exist yet on a fresh database
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS heloc_obligations (
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

  // Migration: account-linked auto-allocation was added after heloc_obligations already
  // shipped -- add the columns to databases created before this change.
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN account_id TEXT`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN auto_allocate INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    // already exists
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS obligation_line_items (
      id TEXT PRIMARY KEY,
      obligation_id TEXT NOT NULL,
      label TEXT,
      amount REAL NOT NULL,
      target_date TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (obligation_id) REFERENCES heloc_obligations(id) ON DELETE CASCADE
    )
  `);

  // Migration: an obligation's single amount/target_date became one-or-more line items (so
  // it can hold several distinct promo balances, e.g. same-day purchases on a store card
  // that each carry their own payoff date). Backfill one line item per pre-existing
  // obligation from its old columns, then drop those now-unused columns.
  try {
    const legacy = db.exec(`SELECT id, amount, target_date, created_at, updated_at FROM heloc_obligations`);
    if (legacy.length > 0) {
      const existing = db.exec(`SELECT DISTINCT obligation_id FROM obligation_line_items`);
      const alreadyMigrated = new Set(existing.length > 0 ? existing[0].values.map((row) => row[0]) : []);
      for (const [id, amount, targetDate, createdAt, updatedAt] of legacy[0].values) {
        if (alreadyMigrated.has(id)) continue;
        db.run(
          `INSERT INTO obligation_line_items (id, obligation_id, amount, target_date, priority, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
          [uuidv4(), id, amount, targetDate, createdAt, updatedAt]
        );
      }
    }
  } catch (e) {
    // heloc_obligations has no amount/target_date columns -- already migrated or a fresh database
  }
  try {
    db.run(`ALTER TABLE heloc_obligations DROP COLUMN amount`);
  } catch (e) {
    // already dropped or never existed
  }
  try {
    db.run(`ALTER TABLE heloc_obligations DROP COLUMN target_date`);
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
      obligation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL,
      FOREIGN KEY (obligation_id) REFERENCES heloc_obligations(id) ON DELETE SET NULL
    )
  `);

  // Migration: obligation allocation was added after transactions already shipped -- add the
  // column to databases created before this change.
  try {
    db.run(`ALTER TABLE transactions ADD COLUMN obligation_id TEXT`);
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

  db.run(`
    CREATE TABLE IF NOT EXISTS income_projections (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      amount REAL NOT NULL,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      account_id TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
  `);

  // Drop indexes that still carry the pre-rename names -- RENAME COLUMN/TABLE keeps them
  // functional under their old names, so leaving them in place would just leave a stale-named
  // duplicate sitting alongside the newly (re)created one below.
  db.run(`DROP INDEX IF EXISTS idx_transactions_reserve`);
  db.run(`DROP INDEX IF EXISTS idx_reserve_line_items_reserve`);
  db.run(`DROP INDEX IF EXISTS idx_reserve_line_items_target_date`);
  // Leftover from the reserve -> line-items migration: this index was never dropped when
  // target_date moved off the parent table, so it's been dangling on a column that no
  // longer exists.
  db.run(`DROP INDEX IF EXISTS idx_heloc_reserves_target_date`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_obligation ON transactions(obligation_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_balance_anchors_date ON balance_anchors(as_of_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reconciliations_date ON reconciliations(as_of_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_obligation_line_items_obligation ON obligation_line_items(obligation_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_obligation_line_items_target_date ON obligation_line_items(target_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_income_projections_start_date ON income_projections(start_date)`);

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
