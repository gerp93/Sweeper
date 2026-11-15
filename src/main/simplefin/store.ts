import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { SimplefinAccountInfo, SimplefinSyncResult } from '../../shared/types/simplefinStatus';

// The SimpleFIN connection lives in userData/simplefin.json, not in the database: the database
// may sit in a synced or shared folder, and the access URL is a credential. The access URL is
// encrypted with the OS secret store (DPAPI on Windows, Keychain on macOS, the keyring on
// Linux) and is only ever decrypted in memory, right before a request.

interface StoredConnection {
  version: 1;
  encryptedAccessUrl: string; // base64 of safeStorage.encryptString(accessUrl)
  connectedAt: string;
  accounts: SimplefinAccountInfo[];
  selectedAccountIds: string[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastResult: SimplefinSyncResult | null;
}

function storePath(): string {
  return path.join(app.getPath('userData'), 'simplefin.json');
}

export function isSecureStorageAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // On Linux without a keyring Electron falls back to a fixed key, which is not real protection.
  if (process.platform === 'linux') {
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
    if (backend === 'basic_text' || backend === 'unknown') return false;
  }
  return true;
}

function read(): StoredConnection | null {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as StoredConnection;
    if (parsed?.version !== 1 || typeof parsed.encryptedAccessUrl !== 'string') return null;
    return {
      ...parsed,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      selectedAccountIds: Array.isArray(parsed.selectedAccountIds) ? parsed.selectedAccountIds : [],
    };
  } catch {
    return null;
  }
}

function write(conn: StoredConnection): void {
  const file = storePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(conn, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function getConnection(): Omit<StoredConnection, 'encryptedAccessUrl'> | null {
  const conn = read();
  if (!conn) return null;
  const { encryptedAccessUrl: _omit, ...rest } = conn;
  return rest;
}

export function saveNewConnection(accessUrl: string, accounts: SimplefinAccountInfo[]): void {
  if (!isSecureStorageAvailable()) {
    throw new Error("This computer has no secure place to keep the connection, so it wasn't saved.");
  }
  const encrypted = safeStorage.encryptString(accessUrl).toString('base64');
  write({
    version: 1,
    encryptedAccessUrl: encrypted,
    connectedAt: new Date().toISOString(),
    accounts,
    // One account (the usual case) is imported without asking; several wait for a choice.
    selectedAccountIds: accounts.length === 1 ? [accounts[0].id] : [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastResult: null,
  });
}

export function getAccessUrl(): string | null {
  const conn = read();
  if (!conn) return null;
  try {
    return safeStorage.decryptString(Buffer.from(conn.encryptedAccessUrl, 'base64'));
  } catch {
    return null;
  }
}

export function updateConnection(
  patch: Partial<Pick<StoredConnection, 'accounts' | 'selectedAccountIds' | 'lastAttemptAt' | 'lastSuccessAt' | 'lastResult'>>
): void {
  const conn = read();
  if (!conn) return;
  write({ ...conn, ...patch });
}

export function deleteConnection(): void {
  try {
    fs.rmSync(storePath(), { force: true });
  } catch {
    // Nothing saved.
  }
}
