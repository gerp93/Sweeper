import { Account } from './types/account';
import { AccountAlias } from './types/accountAlias';
import { ImportRule } from './types/importRule';
import { findAccountMatch, findMatchingRule } from './importMatching';

// Pure SimpleFIN Bridge helpers (https://www.simplefin.org/protocol.html), shared by the
// main-process sync and the tests. Nothing in here touches the network, the disk or a
// real credential.

export interface SimplefinError {
  code: string | null;
  message: string;
  accountId: string | null;
}

export interface SimplefinTransaction {
  id: string;
  posted: number; // epoch seconds, 0 while pending
  amount: number;
  description: string;
  payee: string | null;
  memo: string | null;
  pending: boolean;
}

export interface SimplefinAccount {
  id: string;
  name: string;
  orgName: string | null;
  currency: string;
  balance: number | null;
  // Optional in the protocol: SimpleFIN leaves it out when it equals `balance`.
  availableBalance: number | null;
  balanceDate: number | null;
  transactions: SimplefinTransaction[];
}

export interface SimplefinAccountSet {
  errors: SimplefinError[];
  accounts: SimplefinAccount[];
}

// The longest stretch one /accounts request may cover. SimpleFIN's limit is 90 days.
export const MAX_WINDOW_DAYS = 89;
// The app re-reads this many days before the last transaction it saw, because banks post late.
export const OVERLAP_DAYS = 7;
// SimpleFIN allows about 24 requests a day per token; a single sync never makes more than this.
export const MAX_REQUESTS_PER_SYNC = 4;

// SimpleFIN documents "daily updates" but no time of day, so the schedule is simply 24 hours
// after the last successful import. One scheduled sync a day is far under the ~24 request quota.
export const SCHEDULED_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Never start two syncs closer together than this (a failed one retries after it, not at once).
export const MIN_SYNC_GAP_MS = 60 * 60 * 1000;

const DAY_SECONDS = 24 * 60 * 60;

export interface SyncScheduleInput {
  nowMs: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
}

// Whether the in-app schedule should start a sync now.
export function isScheduledSyncDue(input: SyncScheduleInput): boolean {
  const attempt = input.lastAttemptAt ? Date.parse(input.lastAttemptAt) : NaN;
  if (Number.isFinite(attempt) && input.nowMs - attempt < MIN_SYNC_GAP_MS) return false;
  const success = input.lastSuccessAt ? Date.parse(input.lastSuccessAt) : NaN;
  if (!Number.isFinite(success)) return true;
  return input.nowMs - success >= SCHEDULED_SYNC_INTERVAL_MS;
}

// When the schedule will next sync (epoch ms), or null when one is due right away.
export function nextScheduledSyncMs(input: SyncScheduleInput): number | null {
  const success = input.lastSuccessAt ? Date.parse(input.lastSuccessAt) : NaN;
  if (!Number.isFinite(success)) return null;
  let next = success + SCHEDULED_SYNC_INTERVAL_MS;
  const attempt = input.lastAttemptAt ? Date.parse(input.lastAttemptAt) : NaN;
  if (Number.isFinite(attempt)) next = Math.max(next, attempt + MIN_SYNC_GAP_MS);
  return next <= input.nowMs ? null : next;
}

// The figure to reconcile against: the available balance, or the plain balance when SimpleFIN
// omitted the former because the two are the same.
//
// SimpleFIN reports a credit line like a HELOC the way a liability is written (negative), while
// the bank and the Reconcile page show available credit as a positive number. Available credit
// is never negative, so the sign is dropped.
export function reconcileBalanceOf(account: SimplefinAccount): number | null {
  const value = account.availableBalance ?? account.balance;
  return value === null ? null : Math.abs(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// A setup token is the claim URL in base64. Returns the claim URL, or throws a message that is
// safe to show (it never contains the token itself).
export function decodeSetupToken(token: string): string {
  const cleaned = token.replace(/\s+/g, '');
  if (!cleaned) throw new Error('Paste the setup token from SimpleFIN Bridge.');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(cleaned)) {
    throw new Error("That doesn't look like a SimpleFIN setup token.");
  }
  const decoded = Buffer.from(cleaned.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').trim();
  if (!isHttpsUrl(decoded)) throw new Error("That doesn't look like a SimpleFIN setup token.");
  return decoded;
}

// An access URL carries its credentials as user:pass@host. fetch refuses URLs with credentials
// in them, so they become a Basic auth header and the base URL loses them.
export function splitAccessUrl(accessUrl: string): { baseUrl: string; authHeader: string } {
  let url: URL;
  try {
    url = new URL(accessUrl.trim());
  } catch {
    throw new Error('The saved SimpleFIN access is not valid. Disconnect and connect again.');
  }
  if (url.protocol !== 'https:' || !url.username) {
    throw new Error('The saved SimpleFIN access is not valid. Disconnect and connect again.');
  }
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  url.username = '';
  url.password = '';
  const baseUrl = url.toString().replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return { baseUrl, authHeader };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseAccountSet(raw: unknown): SimplefinAccountSet {
  if (!raw || typeof raw !== 'object') throw new Error('SimpleFIN sent an answer the app could not read.');
  const body = raw as Record<string, unknown>;
  const errors: SimplefinError[] = [];

  if (Array.isArray(body.errlist)) {
    for (const e of body.errlist) {
      if (!e || typeof e !== 'object') continue;
      const err = e as Record<string, unknown>;
      errors.push({
        code: toText(err.code),
        message: toText(err.msg) ?? toText(err.message) ?? 'Unknown error',
        accountId: toText(err.account_id),
      });
    }
  }
  if (Array.isArray(body.errors)) {
    for (const e of body.errors) {
      const message = toText(e);
      if (message && !errors.some((x) => x.message === message)) {
        errors.push({ code: null, message, accountId: null });
      }
    }
  }

  const connections = new Map<string, string>();
  if (Array.isArray(body.connections)) {
    for (const c of body.connections) {
      if (!c || typeof c !== 'object') continue;
      const conn = c as Record<string, unknown>;
      const id = toText(conn.conn_id);
      const name = toText(conn.name) ?? toText(conn.org_name);
      if (id && name) connections.set(id, name);
    }
  }

  const accounts: SimplefinAccount[] = [];
  for (const a of Array.isArray(body.accounts) ? body.accounts : []) {
    if (!a || typeof a !== 'object') continue;
    const acct = a as Record<string, unknown>;
    const id = toText(acct.id);
    if (!id) continue;
    const org = acct.org && typeof acct.org === 'object' ? (acct.org as Record<string, unknown>) : null;
    const connId = toText(acct.conn_id);

    const transactions: SimplefinTransaction[] = [];
    for (const t of Array.isArray(acct.transactions) ? acct.transactions : []) {
      if (!t || typeof t !== 'object') continue;
      const tx = t as Record<string, unknown>;
      const txId = toText(tx.id);
      const amount = toNumber(tx.amount);
      if (!txId || amount === null) continue;
      const posted = toNumber(tx.posted) ?? 0;
      transactions.push({
        id: txId,
        posted,
        amount,
        description: toText(tx.description) ?? toText(tx.payee) ?? '',
        payee: toText(tx.payee),
        memo: toText(tx.memo),
        pending: tx.pending === true || posted <= 0,
      });
    }

    accounts.push({
      id,
      name: toText(acct.name) ?? id,
      orgName: (connId ? connections.get(connId) : undefined) ?? (org ? toText(org.name) ?? toText(org.domain) : null),
      currency: toText(acct.currency) ?? 'USD',
      balance: toNumber(acct.balance),
      availableBalance: toNumber(acct['available-balance']),
      balanceDate: toNumber(acct['balance-date']),
      transactions,
    });
  }

  return { errors, accounts };
}

export function transactionKey(accountId: string, transactionId: string): string {
  return `${accountId}:${transactionId}`;
}

// The calendar date a transaction posted. SimpleFIN gives an instant; banks stamp posting at
// noon or midnight UTC, so the UTC date is the bank's own date.
export function epochToIsoDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

export function isoDateToEpoch(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000);
}

function addDays(isoDate: string, days: number): string {
  return epochToIsoDate(isoDateToEpoch(isoDate) + days * DAY_SECONDS);
}

export interface SyncStartInput {
  latestSeenPostedDate: string | null; // newest posted date of anything SimpleFIN already gave
  latestExistingDate: string | null; // newest transaction date in Sweeper (any source)
  today: string; // ISO date
}

// Where a sync starts reading from (inclusive ISO date).
export function computeSyncStart(input: SyncStartInput): string {
  const earliest = addDays(input.today, -(MAX_WINDOW_DAYS * MAX_REQUESTS_PER_SYNC - 1));
  let start: string;
  if (input.latestSeenPostedDate) {
    start = addDays(input.latestSeenPostedDate, -OVERLAP_DAYS);
  } else if (input.latestExistingDate) {
    // First automatic sync after manual imports: read from the last imported day, and the
    // overlap check below keeps that day's rows from coming in twice.
    start = addDays(input.latestExistingDate, -1);
  } else {
    start = addDays(input.today, -(MAX_WINDOW_DAYS - 1));
  }
  if (start < earliest) start = earliest;
  if (start > input.today) start = input.today;
  return start;
}

export interface SyncWindow {
  startEpoch: number; // inclusive
  endEpoch: number | null; // exclusive, null = up to now
}

// Splits [start, now] into windows SimpleFIN accepts, oldest first.
export function computeSyncWindows(startIsoDate: string, nowEpoch: number): SyncWindow[] {
  const windows: SyncWindow[] = [];
  let cursor = isoDateToEpoch(startIsoDate);
  while (windows.length < MAX_REQUESTS_PER_SYNC) {
    const end = cursor + MAX_WINDOW_DAYS * DAY_SECONDS;
    if (end >= nowEpoch) {
      windows.push({ startEpoch: cursor, endEpoch: null });
      break;
    }
    windows.push({ startEpoch: cursor, endEpoch: end });
    cursor = end;
  }
  return windows;
}

export interface ExistingTransactionLite {
  id: string;
  date: string;
  amount: number;
}

export interface PlanContext {
  selectedAccountIds: string[];
  seenKeys: Set<string>;
  // Sweeper transactions that SimpleFIN did not bring in (manual imports and hand entries).
  otherTransactions: ExistingTransactionLite[];
  rules: ImportRule[];
  accounts: Account[];
  aliases: AccountAlias[];
}

export interface PlannedTransaction {
  key: string;
  date: string;
  description: string;
  amount: number;
  memo: string | null;
  matchedAccountId: string | null;
}

export interface ImportPlan {
  toImport: PlannedTransaction[];
  // Keys to remember without importing (excluded by a rule, or already imported by hand).
  markSeen: { key: string; date: string; transactionId: string | null }[];
  counts: {
    pending: number;
    alreadySeen: number;
    excludedByRule: number;
    alreadyImported: number;
    notSelected: number;
  };
}

function cents(amount: number): number {
  return Math.round(amount * 100);
}

export function planSimplefinImport(sets: SimplefinAccountSet[], ctx: PlanContext): ImportPlan {
  const plan: ImportPlan = {
    toImport: [],
    markSeen: [],
    counts: { pending: 0, alreadySeen: 0, excludedByRule: 0, alreadyImported: 0, notSelected: 0 },
  };
  const selected = new Set(ctx.selectedAccountIds);
  const planned = new Set<string>();
  const claimed = new Set<string>();

  // date|cents -> other transactions, so a row already imported by hand is recognised once each.
  const byAmount = new Map<number, ExistingTransactionLite[]>();
  for (const tx of ctx.otherTransactions) {
    const list = byAmount.get(cents(tx.amount)) ?? [];
    list.push(tx);
    byAmount.set(cents(tx.amount), list);
  }

  function claimManualMatch(date: string, amount: number): ExistingTransactionLite | null {
    const candidates = (byAmount.get(cents(amount)) ?? []).filter((tx) => !claimed.has(tx.id));
    // Same day first, then a day either side (the bank's export and its feed can disagree by one).
    const exact = candidates.find((tx) => tx.date === date);
    const near = exact ?? candidates.find((tx) => tx.date === addDays(date, -1) || tx.date === addDays(date, 1));
    if (near) claimed.add(near.id);
    return near ?? null;
  }

  const rows: { key: string; date: string; tx: SimplefinTransaction }[] = [];
  for (const set of sets) {
    for (const account of set.accounts) {
      if (!selected.has(account.id)) {
        plan.counts.notSelected += account.transactions.length;
        continue;
      }
      for (const tx of account.transactions) {
        if (tx.pending) {
          plan.counts.pending++;
          continue;
        }
        const key = transactionKey(account.id, tx.id);
        if (ctx.seenKeys.has(key) || planned.has(key)) {
          plan.counts.alreadySeen++;
          continue;
        }
        planned.add(key);
        rows.push({ key, date: epochToIsoDate(tx.posted), tx });
      }
    }
  }
  // Oldest first, so exact-date manual matches are claimed in order.
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const { key, date, tx } of rows) {
    const description = tx.description;
    if (findMatchingRule({ description, memo: tx.memo }, ctx.rules)) {
      plan.counts.excludedByRule++;
      plan.markSeen.push({ key, date, transactionId: null });
      continue;
    }
    const manual = claimManualMatch(date, tx.amount);
    if (manual) {
      plan.counts.alreadyImported++;
      plan.markSeen.push({ key, date, transactionId: manual.id });
      continue;
    }
    plan.toImport.push({
      key,
      date,
      description,
      amount: tx.amount,
      memo: tx.memo,
      matchedAccountId: findAccountMatch(description, ctx.accounts, ctx.aliases)?.id ?? null,
    });
  }

  return plan;
}

// Text from SimpleFIN is shown to the user. Keep it short, printable, and free of anything
// that looks like a URL (an access URL must never reach the screen or a log).
export function sanitizeRemoteText(text: string, max = 200): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
}
