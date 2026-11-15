import {
  SimplefinAccountSet,
  SyncWindow,
  decodeSetupToken,
  parseAccountSet,
  sanitizeRemoteText,
  splitAccessUrl,
} from '../../shared/simplefin';

// The only code that talks to SimpleFIN Bridge. The access URL is a credential: it is never
// logged, never put in an error message, and only ever sent to the host it names.

const TIMEOUT_MS = 30_000;

export class SimplefinHttpError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new SimplefinHttpError(
      aborted ? 'SimpleFIN Bridge did not answer in time.' : "Couldn't reach SimpleFIN Bridge. Check the internet connection.",
      null
    );
  } finally {
    clearTimeout(timer);
  }
}

// Trades a one-time setup token for the access URL. A token works exactly once.
export async function claimSetupToken(setupToken: string): Promise<string> {
  const claimUrl = decodeSetupToken(setupToken);
  const res = await request(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (res.status === 403) {
    throw new SimplefinHttpError(
      'That setup token was already used or does not exist. Make a new one at SimpleFIN Bridge. If you did not use it yourself, someone else may have, so disable it there.',
      403
    );
  }
  if (!res.ok) {
    throw new SimplefinHttpError(`SimpleFIN Bridge refused the setup token (HTTP ${res.status}).`, res.status);
  }
  const accessUrl = (await res.text()).trim();
  // Validates it without echoing it back.
  splitAccessUrl(accessUrl);
  return accessUrl;
}

function describeStatus(status: number): string {
  if (status === 402) return 'SimpleFIN Bridge says the subscription needs payment.';
  if (status === 403) {
    return 'SimpleFIN Bridge no longer accepts this connection (it may have been revoked). Disconnect and connect again with a new setup token.';
  }
  return `SimpleFIN Bridge answered with an error (HTTP ${status}).`;
}

async function getAccounts(accessUrl: string, params: URLSearchParams): Promise<SimplefinAccountSet> {
  const { baseUrl, authHeader } = splitAccessUrl(accessUrl);
  params.set('version', '2');
  const res = await request(`${baseUrl}/accounts?${params.toString()}`, {
    method: 'GET',
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) throw new SimplefinHttpError(describeStatus(res.status), res.status);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new SimplefinHttpError('SimpleFIN Bridge sent an answer the app could not read.', res.status);
  }
  const set = parseAccountSet(body);
  set.errors = set.errors.map((e) => ({ ...e, message: sanitizeRemoteText(e.message) }));
  return set;
}

// Account names and balances only, no transactions (used right after connecting).
export function listAccounts(accessUrl: string): Promise<SimplefinAccountSet> {
  const params = new URLSearchParams();
  params.set('balances-only', '1');
  return getAccounts(accessUrl, params);
}

export function fetchTransactions(accessUrl: string, window: SyncWindow, accountIds: string[]): Promise<SimplefinAccountSet> {
  const params = new URLSearchParams();
  params.set('start-date', String(window.startEpoch));
  if (window.endEpoch !== null) params.set('end-date', String(window.endEpoch));
  // One request for everything wanted: each account= costs its own quota otherwise. The caller
  // passes the accounts to import plus the one it reconciles against, so a balance rides along.
  if (accountIds.length === 1) params.set('account', accountIds[0]);
  return getAccounts(accessUrl, params);
}
