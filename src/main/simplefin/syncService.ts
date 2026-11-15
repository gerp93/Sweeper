import { Database } from 'sql.js';
import { saveDatabase } from '../database/schema';
import { AccountService } from '../database/accountService';
import { AccountAliasService } from '../database/accountAliasService';
import { TransactionService } from '../database/transactionService';
import { ImportRuleService } from '../database/importRuleService';
import { ImportBatchService } from '../database/importBatchService';
import { ObligationService } from '../database/obligationService';
import { CreateTransactionInput } from '../../shared/types/transaction';
import { SimplefinAccountInfo, SimplefinStatus, SimplefinSyncResult } from '../../shared/types/simplefinStatus';
import {
  SimplefinAccountSet,
  computeSyncStart,
  computeSyncWindows,
  epochToIsoDate,
  planSimplefinImport,
  sanitizeRemoteText,
} from '../../shared/simplefin';
import { claimSetupToken, fetchTransactions, listAccounts } from './client';
import {
  deleteConnection,
  getAccessUrl,
  getConnection,
  isSecureStorageAvailable,
  saveNewConnection,
  updateConnection,
} from './store';

// A launch sync is skipped if one ran this recently: SimpleFIN allows about 24 requests a day,
// and reopening the app several times an hour must not use them up. "Sync now" always runs.
const AUTO_SYNC_MIN_GAP_MS = 60 * 60 * 1000;

export const BATCH_NAME = 'SimpleFIN automatic import';

export interface SyncServices {
  db: Database;
  accounts: AccountService;
  aliases: AccountAliasService;
  transactions: TransactionService;
  rules: ImportRuleService;
  batches: ImportBatchService;
  obligations: ObligationService;
}

function accountInfos(sets: SimplefinAccountSet[]): SimplefinAccountInfo[] {
  const out = new Map<string, SimplefinAccountInfo>();
  for (const set of sets) {
    for (const a of set.accounts) out.set(a.id, { id: a.id, name: a.name, orgName: a.orgName });
  }
  return [...out.values()];
}

function failure(messages: string[]): SimplefinSyncResult {
  return {
    ok: false,
    finishedAt: new Date().toISOString(),
    imported: 0,
    excludedByRule: 0,
    alreadyImported: 0,
    newAccounts: 0,
    messages,
  };
}

function safeMessage(err: unknown): string {
  // Errors from client.ts and store.ts are written to be shown; anything else is cut down so a
  // stray URL or stack never reaches the screen.
  const text = err instanceof Error ? err.message : String(err);
  return sanitizeRemoteText(text) || 'The sync failed.';
}

export class SimplefinSyncService {
  private running: Promise<SimplefinSyncResult> | null = null;

  constructor(private s: SyncServices, private onFinished: (result: SimplefinSyncResult) => void) {}

  getStatus(): SimplefinStatus {
    const conn = getConnection();
    return {
      connected: !!conn,
      secureStorageAvailable: isSecureStorageAvailable(),
      accounts: conn?.accounts ?? [],
      selectedAccountIds: conn?.selectedAccountIds ?? [],
      connectedAt: conn?.connectedAt ?? null,
      lastAttemptAt: conn?.lastAttemptAt ?? null,
      lastSuccessAt: conn?.lastSuccessAt ?? null,
      lastResult: conn?.lastResult ?? null,
      syncing: this.running !== null,
    };
  }

  async connect(setupToken: string): Promise<SimplefinStatus> {
    if (!isSecureStorageAvailable()) {
      throw new Error(
        "This computer has no secure place to keep the SimpleFIN connection, so Sweeper won't save it. The setup token was not used."
      );
    }
    // Claiming spends the token, so nothing that can fail for a local reason happens after it
    // without the access being saved first.
    const accessUrl = await claimSetupToken(setupToken);
    saveNewConnection(accessUrl, []);
    try {
      const set = await listAccounts(accessUrl);
      const accounts = accountInfos([set]);
      updateConnection({
        accounts,
        selectedAccountIds: accounts.length === 1 ? [accounts[0].id] : [],
      });
    } catch {
      // Connected anyway; the account list fills in on the first sync.
    }
    return this.getStatus();
  }

  setSelectedAccounts(ids: string[]): SimplefinStatus {
    const conn = getConnection();
    if (conn) {
      const known = new Set(conn.accounts.map((a) => a.id));
      updateConnection({ selectedAccountIds: ids.filter((id) => known.has(id)) });
    }
    return this.getStatus();
  }

  disconnect(): SimplefinStatus {
    deleteConnection();
    return this.getStatus();
  }

  // Called once the window has loaded. Never throws: a failed sync is a notice, not a crash.
  async syncOnLaunch(): Promise<void> {
    const conn = getConnection();
    if (!conn) return;
    if (conn.lastAttemptAt && Date.now() - Date.parse(conn.lastAttemptAt) < AUTO_SYNC_MIN_GAP_MS) return;
    await this.sync();
  }

  sync(): Promise<SimplefinSyncResult> {
    if (this.running) return this.running;
    this.running = this.runSync()
      .catch((err) => failure([safeMessage(err)]))
      .then((result) => {
        if (getConnection()) {
          updateConnection({
            lastResult: result,
            ...(result.ok ? { lastSuccessAt: result.finishedAt } : {}),
          });
        }
        this.running = null;
        this.onFinished(result);
        return result;
      });
    return this.running;
  }

  private scalar(sql: string): string | null {
    const res = this.s.db.exec(sql);
    const value = res[0]?.values[0]?.[0];
    return typeof value === 'string' ? value : null;
  }

  private async runSync(): Promise<SimplefinSyncResult> {
    const conn = getConnection();
    if (!conn) return failure(['Automated import is not connected.']);
    updateConnection({ lastAttemptAt: new Date().toISOString() });

    const accessUrl = getAccessUrl();
    if (!accessUrl) {
      return failure(["The saved SimpleFIN connection can't be read on this computer. Disconnect and connect again."]);
    }

    let selected = conn.selectedAccountIds;
    let accounts = conn.accounts;
    if (accounts.length === 0) {
      // Connect could not list accounts; try again now.
      accounts = accountInfos([await listAccounts(accessUrl)]);
      if (accounts.length === 1) selected = [accounts[0].id];
      updateConnection({ accounts, selectedAccountIds: selected });
    }
    if (selected.length === 0) {
      return failure(['Choose which account to import in Settings, Automated Import.']);
    }

    const today = new Date().toISOString().slice(0, 10);
    const start = computeSyncStart({
      latestSeenPostedDate: this.scalar(`SELECT MAX(posted_date) FROM simplefin_seen`),
      latestExistingDate: this.scalar(`SELECT MAX(date) FROM transactions`),
      today,
    });

    const sets: SimplefinAccountSet[] = [];
    for (const window of computeSyncWindows(start, Math.floor(Date.now() / 1000))) {
      sets.push(await fetchTransactions(accessUrl, window, selected));
    }

    const messages: string[] = [];
    for (const set of sets) {
      for (const e of set.errors) if (!messages.includes(e.message)) messages.push(e.message);
    }

    // Keep account names current (a bank can rename one), and add any new ones for the user to tick.
    const fresh = accountInfos(sets);
    if (fresh.length > 0) {
      const merged = new Map(accounts.map((a) => [a.id, a]));
      for (const a of fresh) merged.set(a.id, a);
      updateConnection({ accounts: [...merged.values()] });
    }

    const seenRes = this.s.db.exec(`SELECT key, transaction_id FROM simplefin_seen`);
    const seenKeys = new Set<string>();
    const simplefinTxIds = new Set<string>();
    for (const [key, txId] of seenRes[0]?.values ?? []) {
      seenKeys.add(String(key));
      if (typeof txId === 'string') simplefinTxIds.add(txId);
    }

    const otherTransactions = this.s.transactions
      .getTransactionsAfterDate(epochToIsoDate(Date.parse(`${start}T00:00:00Z`) / 1000 - 3 * 86400))
      .filter((tx) => !simplefinTxIds.has(tx.id))
      .map((tx) => ({ id: tx.id, date: tx.date, amount: tx.amount }));

    const allAccounts = this.s.accounts.getAllAccounts();
    const plan = planSimplefinImport(sets, {
      selectedAccountIds: selected,
      seenKeys,
      otherTransactions,
      rules: this.s.rules.getActiveRules(),
      accounts: allAccounts,
      aliases: this.s.aliases.getAllAliases(),
    });

    // Same defaults as the manual import: a new description gets an account named after it
    // (rename or merge it later), and an account's auto-allocate obligation is applied.
    const obligations = this.s.obligations.getAllObligations();
    const resolved = new Map<string, string>();
    let newAccounts = 0;
    const inputs: CreateTransactionInput[] = [];
    for (const row of plan.toImport) {
      let accountId = row.matchedAccountId;
      if (!accountId) {
        const cached = resolved.get(row.description);
        if (cached) {
          accountId = cached;
        } else {
          const account = this.s.accounts.createAccount({ friendlyName: row.description || 'Unnamed' });
          if (row.description) this.s.aliases.createAlias(account.id, row.description);
          accountId = account.id;
          resolved.set(row.description, accountId);
          newAccounts++;
        }
      }
      const obligationId = obligations.find((o) => o.accountId === accountId && o.autoAllocate)?.id ?? null;
      inputs.push({
        accountId,
        date: row.date,
        description: row.description,
        amount: row.amount,
        memo: row.memo,
        obligationId,
      });
    }

    let createdIds: string[] = [];
    if (inputs.length > 0) {
      const batch = this.s.batches.createBatch({
        fileName: BATCH_NAME,
        rowCount: inputs.length + plan.counts.excludedByRule + plan.counts.alreadyImported,
        includedCount: inputs.length,
        excludedCount: plan.counts.excludedByRule + plan.counts.alreadyImported,
      });
      createdIds = this.s.transactions
        .createTransactionsBulk(inputs.map((i) => ({ ...i, importBatchId: batch.id })))
        .map((tx) => tx.id);
    }

    const now = new Date().toISOString();
    const seenRows = [
      ...plan.toImport.map((row, i) => ({ key: row.key, date: row.date, transactionId: createdIds[i] ?? null })),
      ...plan.markSeen,
    ];
    if (seenRows.length > 0) {
      const stmt = this.s.db.prepare(
        `INSERT OR IGNORE INTO simplefin_seen (key, posted_date, transaction_id, first_seen_at) VALUES (?, ?, ?, ?)`
      );
      for (const row of seenRows) stmt.run([row.key, row.date, row.transactionId, now]);
      stmt.free();
      saveDatabase(this.s.db);
    }

    return {
      ok: true,
      finishedAt: new Date().toISOString(),
      imported: inputs.length,
      excludedByRule: plan.counts.excludedByRule,
      alreadyImported: plan.counts.alreadyImported,
      newAccounts,
      messages,
    };
  }
}
