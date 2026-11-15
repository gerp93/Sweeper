export interface SimplefinAccountInfo {
  id: string;
  name: string;
  orgName: string | null;
}

export interface SimplefinReconcileOutcome {
  // recorded: matched and saved as a reconciliation. unchanged: already recorded.
  // mismatch: the bank figure differs from Sweeper's, so nothing was recorded.
  // unavailable: SimpleFIN gave no figure for the chosen account.
  status: 'recorded' | 'unchanged' | 'mismatch' | 'unavailable';
  asOfDate: string | null;
  bankBalance: number | null;
  computedBalance: number | null;
  difference: number | null;
  message: string;
}

export interface SimplefinSyncResult {
  ok: boolean;
  finishedAt: string;
  imported: number;
  excludedByRule: number;
  alreadyImported: number;
  newAccounts: number;
  // Problems SimpleFIN reported for a bank connection, or why the sync failed.
  messages: string[];
  // Absent on results saved before automatic reconciliation existed, and when it is switched off.
  reconcile?: SimplefinReconcileOutcome | null;
}

export interface SimplefinStatus {
  connected: boolean;
  // False when this computer can't encrypt the saved access (connecting is then refused).
  secureStorageAvailable: boolean;
  accounts: SimplefinAccountInfo[];
  selectedAccountIds: string[];
  // The account whose available balance is reconciled against after each import (not imported).
  reconcileAccountId: string | null;
  // When the in-app schedule will next sync (ISO), or null when one is due right away.
  nextSyncAt: string | null;
  connectedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastResult: SimplefinSyncResult | null;
  syncing: boolean;
}
