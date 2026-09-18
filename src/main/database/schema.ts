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
      friendly_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS account_aliases (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      raw_name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    )
  `);

  // Migration: raw_name used to live directly on accounts (one raw bank description per
  // account, and merging/renaming destroyed it -- so a merge never stuck past the next
  // import of that same description). It's now a many-to-one alias, so an account can match
  // several raw descriptions and merging just reassigns them instead of losing them.
  // Backfill one alias per pre-existing account from its old column, then drop the column.
  try {
    const legacy = db.exec(`SELECT id, raw_name, created_at FROM accounts`);
    if (legacy.length > 0) {
      const existing = db.exec(`SELECT raw_name FROM account_aliases`);
      const alreadyMigrated = new Set(existing.length > 0 ? existing[0].values.map((row) => row[0]) : []);
      for (const [id, rawName, createdAt] of legacy[0].values) {
        if (rawName == null || alreadyMigrated.has(rawName)) continue;
        db.run(`INSERT INTO account_aliases (id, account_id, raw_name, created_at) VALUES (?, ?, ?, ?)`, [
          uuidv4(),
          id,
          rawName,
          createdAt,
        ]);
      }
    }
  } catch (e) {
    // accounts has no raw_name column -- already migrated or a fresh database
  }
  // raw_name carried a UNIQUE constraint, which SQLite backs with an implicit index --
  // ALTER TABLE DROP COLUMN refuses to drop an indexed column, so a plain DROP COLUMN here
  // silently fails. Rebuild the table instead (SQLite's standard way to drop a column that
  // can't use the fast path), guarded so it only runs once.
  const accountsColumns = db.exec(`PRAGMA table_info(accounts)`);
  const hasRawName = accountsColumns.length > 0 && accountsColumns[0].values.some((row) => row[1] === 'raw_name');
  if (hasRawName) {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(`
      CREATE TABLE accounts_new (
        id TEXT PRIMARY KEY,
        friendly_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.run(`INSERT INTO accounts_new (id, friendly_name, created_at, updated_at)
            SELECT id, friendly_name, created_at, updated_at FROM accounts`);
    db.run(`DROP TABLE accounts`);
    db.run(`ALTER TABLE accounts_new RENAME TO accounts`);
    db.run('PRAGMA foreign_keys = ON');
  }

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
      target_date TEXT,
      recurrence_unit TEXT,
      recurrence_interval INTEGER,
      recurrence_last_day_of_month INTEGER NOT NULL DEFAULT 0,
      series_id TEXT,
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

  // Migration: obligation-level target_date/recurrence were added after heloc_obligations
  // already shipped -- add the columns to databases created before this change. On a
  // genuinely ancient database that still has the pre-line-items target_date column (see the
  // ancient-legacy migration just below), this ADD COLUMN fails and is a no-op, which is
  // exactly what's wanted: that older column already holds the one date this migration would
  // otherwise be backfilling, so it's left in place and reused rather than dropped and redone.
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN target_date TEXT`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN recurrence_unit TEXT`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN recurrence_interval INTEGER`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN recurrence_last_day_of_month INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    // already exists
  }
  try {
    db.run(`ALTER TABLE heloc_obligations ADD COLUMN series_id TEXT`);
  } catch (e) {
    // already exists
  }
  // Migration: series_id links every occurrence a recurring obligation auto-spawns back to
  // the same chain (so the "spawn the next one" pass can find each chain's latest member). A
  // pre-existing obligation with no series_id yet is trivially its own series of one.
  db.run(`UPDATE heloc_obligations SET series_id = id WHERE series_id IS NULL`);

  db.run(`
    CREATE TABLE IF NOT EXISTS obligation_line_items (
      id TEXT PRIMARY KEY,
      obligation_id TEXT NOT NULL,
      label TEXT,
      amount REAL NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (obligation_id) REFERENCES heloc_obligations(id) ON DELETE CASCADE
    )
  `);

  // Migration: an obligation's single amount/target_date became one-or-more line items (so
  // it can hold several distinct promo balances, e.g. same-day purchases on a store card
  // that each carry their own payoff date). Backfill one line item per pre-existing
  // obligation from its old amount column, then drop it -- target_date is deliberately left
  // untouched here: it's the very same column the ADD COLUMN above tried (and, on a database
  // this old, failed) to add, so it already holds exactly the one date each obligation needs
  // going forward and doesn't need migrating at all.
  try {
    const legacy = db.exec(`SELECT id, amount, created_at, updated_at FROM heloc_obligations`);
    if (legacy.length > 0) {
      const existing = db.exec(`SELECT DISTINCT obligation_id FROM obligation_line_items`);
      const alreadyMigrated = new Set(existing.length > 0 ? existing[0].values.map((row) => row[0]) : []);
      for (const [id, amount, createdAt, updatedAt] of legacy[0].values) {
        if (alreadyMigrated.has(id)) continue;
        db.run(
          `INSERT INTO obligation_line_items (id, obligation_id, amount, priority, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?)`,
          [uuidv4(), id, amount, createdAt, updatedAt]
        );
      }
    }
  } catch (e) {
    // heloc_obligations has no amount column -- already migrated or a fresh database
  }
  try {
    db.run(`ALTER TABLE heloc_obligations DROP COLUMN amount`);
  } catch (e) {
    // already dropped or never existed
  }

  // Migration: a target date used to live on each line item (so a single obligation could
  // carry several differently-dated amounts) -- it's now one date on the obligation itself,
  // since a single obligation only ever has one due date and a different date means a
  // different obligation. Backfill each obligation's target_date from the soonest date any of
  // its line items had (matching the old soonest-due-first sort this app already used), then
  // drop the now-unused per-item column.
  try {
    const grouped = db.exec(`
      SELECT obligation_id, MIN(target_date) as soonest
      FROM obligation_line_items
      WHERE target_date IS NOT NULL
      GROUP BY obligation_id
    `);
    if (grouped.length > 0) {
      for (const [obligationId, soonest] of grouped[0].values) {
        db.run(`UPDATE heloc_obligations SET target_date = ? WHERE id = ? AND target_date IS NULL`, [
          soonest,
          obligationId,
        ]);
      }
    }
  } catch (e) {
    // obligation_line_items has no target_date column -- already migrated or a fresh database
  }
  // target_date carries an index (idx_obligation_line_items_target_date, dropped further
  // below), so a plain ALTER TABLE DROP COLUMN refuses it on this SQLite build -- same
  // situation as accounts.raw_name. Rebuild the table instead, guarded so it only runs once.
  const lineItemColumns = db.exec(`PRAGMA table_info(obligation_line_items)`);
  const lineItemsHaveTargetDate =
    lineItemColumns.length > 0 && lineItemColumns[0].values.some((row) => row[1] === 'target_date');
  if (lineItemsHaveTargetDate) {
    db.run('PRAGMA foreign_keys = OFF');
    db.run(`
      CREATE TABLE obligation_line_items_new (
        id TEXT PRIMARY KEY,
        obligation_id TEXT NOT NULL,
        label TEXT,
        amount REAL NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (obligation_id) REFERENCES heloc_obligations(id) ON DELETE CASCADE
      )
    `);
    db.run(`INSERT INTO obligation_line_items_new (id, obligation_id, label, amount, priority, created_at, updated_at)
            SELECT id, obligation_id, label, amount, priority, created_at, updated_at FROM obligation_line_items`);
    db.run(`DROP TABLE obligation_line_items`);
    db.run(`ALTER TABLE obligation_line_items_new RENAME TO obligation_line_items`);
    db.run('PRAGMA foreign_keys = ON');
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

  // Migration: "always land on the last day of the month" was added after income_projections
  // already shipped -- add the column to databases created before this change.
  try {
    db.run(`ALTER TABLE income_projections ADD COLUMN last_day_of_month INTEGER NOT NULL DEFAULT 0`);
  } catch (e) {
    // already exists
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS recurring_bills (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      amount_mode TEXT NOT NULL DEFAULT 'fixed',
      fixed_amount REAL,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      account_id TEXT,
      note TEXT,
      last_day_of_month INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      amount_tolerance_type TEXT NOT NULL DEFAULT 'percent',
      amount_tolerance REAL NOT NULL DEFAULT 0.15,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
  `);

  // Migration: recurring bill confirmation was added after transactions already shipped --
  // add the link column to databases created before this change. Same pattern as
  // obligation_id below: SQLite can't add a FK constraint retroactively via ALTER TABLE, so
  // this column has no enforced FK on pre-existing databases -- RecurringBillService.deleteBill
  // must explicitly null it out itself rather than relying on ON DELETE SET NULL.
  try {
    db.run(`ALTER TABLE transactions ADD COLUMN recurring_bill_id TEXT`);
  } catch (e) {
    // already exists
  }

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
  // Leftover from the line-item-dates -> single-obligation-date migration: target_date no
  // longer lives on obligation_line_items at all.
  db.run(`DROP INDEX IF EXISTS idx_obligation_line_items_target_date`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_obligation ON transactions(obligation_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_recurring_bill ON transactions(recurring_bill_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_description ON transactions(description)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_balance_anchors_date ON balance_anchors(as_of_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_reconciliations_date ON reconciliations(as_of_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_obligation_line_items_obligation ON obligation_line_items(obligation_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_heloc_obligations_target_date ON heloc_obligations(target_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_heloc_obligations_series ON heloc_obligations(series_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_income_projections_start_date ON income_projections(start_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recurring_bills_start_date ON recurring_bills(start_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_recurring_bills_account ON recurring_bills(account_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_account_aliases_account ON account_aliases(account_id)`);

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
