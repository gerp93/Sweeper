export interface SimplefinAccountInfo {
  id: string;
  name: string;
  orgName: string | null;
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
}

export interface SimplefinStatus {
  connected: boolean;
  // False when this computer can't encrypt the saved access (connecting is then refused).
  secureStorageAvailable: boolean;
  accounts: SimplefinAccountInfo[];
  selectedAccountIds: string[];
  connectedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastResult: SimplefinSyncResult | null;
  syncing: boolean;
}
