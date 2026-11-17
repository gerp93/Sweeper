// Tests for the SimpleFIN mapping and dedupe. Every token, URL and transaction here is made up;
// nothing in this file reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REQUESTS_PER_SYNC,
  MAX_WINDOW_DAYS,
  PlanContext,
  computeSyncStart,
  computeSyncWindows,
  SCHEDULED_SYNC_INTERVAL_MS,
  MIN_SYNC_GAP_MS,
  decodeSetupToken,
  epochToIsoDate,
  isScheduledSyncDue,
  nextScheduledSyncMs,
  reconcileBalanceOf,
  isoDateToEpoch,
  parseAccountSet,
  planSimplefinImport,
  sanitizeRemoteText,
  splitAccessUrl,
  transactionKey,
} from '../src/shared/simplefin';
import { ImportRule } from '../src/shared/types/importRule';

const FAKE_CLAIM_URL = 'https://bridge.example.test/simplefin/claim/FAKE-DEMO-TOKEN';
const FAKE_ACCESS_URL = 'https://demo-user:demo-pass@bridge.example.test/simplefin';

const noon = (iso: string) => isoDateToEpoch(iso) + 12 * 3600;

function fakeBody() {
  return {
    errlist: [{ code: 'con.auth', msg: 'Bank login needs attention', conn_id: 'CON-1' }],
    errors: ['Bank login needs attention', 'Older style message'],
    connections: [{ conn_id: 'CON-1', name: 'Demo Bank' }],
    accounts: [
      {
        id: 'ACT-1',
        name: 'Demo Checking',
        conn_id: 'CON-1',
        currency: 'USD',
        balance: '1234.56',
        'balance-date': noon('2026-11-10'),
        transactions: [
          { id: 'T1', posted: noon('2026-11-01'), amount: '-42.10', description: 'GROCERY STORE' },
          { id: 'T2', posted: noon('2026-11-02'), amount: '2500.00', description: 'PAYROLL', memo: 'Direct dep' },
          { id: 'T3', posted: 0, amount: '-5.00', description: 'COFFEE', pending: true },
          { id: 'T4', posted: noon('2026-11-03'), amount: 'not a number', description: 'BROKEN' },
        ],
      },
      { id: 'ACT-2', name: 'Demo Savings', conn_id: 'CON-1', currency: 'USD', balance: '10.00', transactions: [] },
    ],
  };
}

function rule(partial: Partial<ImportRule>): ImportRule {
  return {
    id: 'R1',
    field: 'description',
    matchType: 'contains',
    pattern: 'transfer',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function ctx(partial: Partial<PlanContext> = {}): PlanContext {
  return {
    selectedAccountIds: ['ACT-1'],
    seenKeys: new Set(),
    otherTransactions: [],
    rules: [],
    accounts: [],
    aliases: [],
    ...partial,
  };
}

test('decodeSetupToken returns the claim URL', () => {
  const token = Buffer.from(FAKE_CLAIM_URL).toString('base64');
  assert.equal(decodeSetupToken(`  ${token}\n`), FAKE_CLAIM_URL);
});

test('decodeSetupToken refuses junk and non-https without echoing the input', () => {
  assert.throws(() => decodeSetupToken(''), /Paste the setup token/);
  assert.throws(() => decodeSetupToken('not a token!'), /doesn't look like/);
  const http = Buffer.from('http://bridge.example.test/claim/x').toString('base64');
  assert.throws(() => decodeSetupToken(http), (err: Error) => !err.message.includes('example.test'));
});

test('splitAccessUrl moves the credentials into a Basic auth header', () => {
  const { baseUrl, authHeader } = splitAccessUrl(FAKE_ACCESS_URL);
  assert.equal(baseUrl, 'https://bridge.example.test/simplefin');
  assert.equal(authHeader, 'Basic ' + Buffer.from('demo-user:demo-pass').toString('base64'));
  assert.ok(!baseUrl.includes('demo-pass'));
});

test('splitAccessUrl refuses an access URL without https or credentials', () => {
  assert.throws(() => splitAccessUrl('http://u:p@bridge.example.test/simplefin'));
  assert.throws(() => splitAccessUrl('https://bridge.example.test/simplefin'));
  assert.throws(() => splitAccessUrl('garbage'), (err: Error) => !err.message.includes('garbage'));
});

test('parseAccountSet maps accounts, amounts, pending and both error lists', () => {
  const set = parseAccountSet(fakeBody());
  assert.deepEqual(
    set.errors.map((e) => e.message),
    ['Bank login needs attention', 'Older style message']
  );
  assert.equal(set.accounts.length, 2);
  const checking = set.accounts[0];
  assert.equal(checking.orgName, 'Demo Bank');
  assert.equal(checking.balance, 1234.56);
  assert.deepEqual(
    checking.transactions.map((t) => [t.id, t.amount, t.pending]),
    [
      ['T1', -42.1, false],
      ['T2', 2500, false],
      ['T3', -5, true],
    ]
  );
  assert.equal(checking.transactions[1].memo, 'Direct dep');
});

test('parseAccountSet rejects a body that is not an object', () => {
  assert.throws(() => parseAccountSet(null));
  assert.deepEqual(parseAccountSet({}).accounts, []);
});

test('epochToIsoDate uses the UTC calendar date', () => {
  assert.equal(epochToIsoDate(isoDateToEpoch('2026-11-01')), '2026-11-01');
  assert.equal(epochToIsoDate(isoDateToEpoch('2026-11-01') + 86399), '2026-11-01');
});

test('planSimplefinImport imports new posted rows and skips pending ones', () => {
  const plan = planSimplefinImport([parseAccountSet(fakeBody())], ctx());
  assert.deepEqual(
    plan.toImport.map((r) => [r.key, r.date, r.description, r.amount]),
    [
      [transactionKey('ACT-1', 'T1'), '2026-11-01', 'GROCERY STORE', -42.1],
      [transactionKey('ACT-1', 'T2'), '2026-11-02', 'PAYROLL', 2500],
    ]
  );
  assert.equal(plan.counts.pending, 1);
});

test('planSimplefinImport never imports a transaction id twice', () => {
  const set = parseAccountSet(fakeBody());
  const seen = new Set([transactionKey('ACT-1', 'T1')]);
  // The same account set twice, as overlapping windows would return it.
  const plan = planSimplefinImport([set, set], ctx({ seenKeys: seen }));
  assert.deepEqual(
    plan.toImport.map((r) => r.key),
    [transactionKey('ACT-1', 'T2')]
  );
  // T1 twice (already seen) and T2 once (the repeat in the second set).
  assert.equal(plan.counts.alreadySeen, 3);
});

test('planSimplefinImport keys by account, so the same id in two accounts is two rows', () => {
  const body = fakeBody();
  body.accounts[1].transactions = [
    { id: 'T1', posted: noon('2026-11-05'), amount: '-1.00', description: 'FEE' },
  ] as never;
  const plan = planSimplefinImport([parseAccountSet(body)], ctx({ selectedAccountIds: ['ACT-1', 'ACT-2'] }));
  assert.equal(plan.toImport.length, 3);
});

test('planSimplefinImport leaves out accounts that are not ticked', () => {
  const plan = planSimplefinImport([parseAccountSet(fakeBody())], ctx({ selectedAccountIds: ['ACT-2'] }));
  assert.equal(plan.toImport.length, 0);
  assert.equal(plan.counts.notSelected, 3);
});

test('planSimplefinImport applies import rules and remembers the skipped rows', () => {
  const plan = planSimplefinImport(
    [parseAccountSet(fakeBody())],
    ctx({ rules: [rule({ pattern: 'grocery' }), rule({ id: 'R2', pattern: 'payroll', isActive: false })] })
  );
  assert.deepEqual(
    plan.toImport.map((r) => r.description),
    ['PAYROLL']
  );
  assert.deepEqual(plan.markSeen, [{ key: transactionKey('ACT-1', 'T1'), date: '2026-11-01', transactionId: null }]);
});

test('planSimplefinImport recognises rows already imported by hand, once each', () => {
  const body = fakeBody();
  body.accounts[0].transactions.push({
    id: 'T5',
    posted: noon('2026-11-01'),
    amount: '-42.10',
    description: 'GROCERY STORE',
  } as never);
  const plan = planSimplefinImport(
    [parseAccountSet(body)],
    ctx({
      // One matching manual row (a day off, as a CSV export can be) for two SimpleFIN rows.
      otherTransactions: [{ id: 'MANUAL-1', date: '2026-10-31', amount: -42.1 }],
    })
  );
  assert.equal(plan.counts.alreadyImported, 1);
  assert.deepEqual(plan.markSeen, [{ key: transactionKey('ACT-1', 'T1'), date: '2026-11-01', transactionId: 'MANUAL-1' }]);
  assert.deepEqual(
    plan.toImport.map((r) => r.key),
    [transactionKey('ACT-1', 'T5'), transactionKey('ACT-1', 'T2')]
  );
});

test('planSimplefinImport does not treat a different amount as already imported', () => {
  const plan = planSimplefinImport(
    [parseAccountSet(fakeBody())],
    ctx({ otherTransactions: [{ id: 'MANUAL-1', date: '2026-11-01', amount: -42.11 }] })
  );
  assert.equal(plan.counts.alreadyImported, 0);
  assert.equal(plan.toImport.length, 2);
});

test('planSimplefinImport matches accounts through aliases', () => {
  const plan = planSimplefinImport(
    [parseAccountSet(fakeBody())],
    ctx({
      accounts: [{ id: 'A-groceries', friendlyName: 'Groceries', createdAt: '', updatedAt: '' }],
      aliases: [{ id: 'AL1', accountId: 'A-groceries', rawName: ' grocery store ', createdAt: '' }],
    })
  );
  assert.equal(plan.toImport[0].matchedAccountId, 'A-groceries');
  assert.equal(plan.toImport[1].matchedAccountId, null);
});

test('computeSyncStart overlaps the last seen date and starts after manual imports', () => {
  const today = '2026-11-15';
  assert.equal(computeSyncStart({ latestSeenPostedDate: '2026-11-10', latestExistingDate: '2026-11-12', today }), '2026-11-03');
  assert.equal(computeSyncStart({ latestSeenPostedDate: null, latestExistingDate: '2026-11-12', today }), '2026-11-11');
  assert.equal(computeSyncStart({ latestSeenPostedDate: null, latestExistingDate: null, today }), '2026-08-19');
  // A very old last import is capped so one sync never needs more than the request limit.
  const capped = computeSyncStart({ latestSeenPostedDate: '2020-01-01', latestExistingDate: null, today });
  assert.equal(computeSyncWindows(capped, isoDateToEpoch(today) + 3600).length, MAX_REQUESTS_PER_SYNC);
});

test('computeSyncWindows splits long gaps into windows SimpleFIN accepts', () => {
  const now = isoDateToEpoch('2026-11-15') + 3600;
  assert.deepEqual(computeSyncWindows('2026-11-08', now), [{ startEpoch: isoDateToEpoch('2026-11-08'), endEpoch: null }]);
  const windows = computeSyncWindows('2026-06-01', now);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].endEpoch! - windows[0].startEpoch, MAX_WINDOW_DAYS * 86400);
  assert.equal(windows[1].startEpoch, windows[0].endEpoch);
  assert.equal(windows[1].endEpoch, null);
});

test('sanitizeRemoteText strips URLs, control characters and long text', () => {
  assert.equal(sanitizeRemoteText(`Bad ${FAKE_ACCESS_URL}/accounts\u0007 here`), 'Bad [link] here');
  assert.equal(sanitizeRemoteText('x'.repeat(300)).length, 200);
});

test('parseAccountSet reads the available balance, which may be omitted', () => {
  const set = parseAccountSet({
    accounts: [
      { id: 'LOC', name: 'Demo HELOC', balance: '-71601.77', 'available-balance': '28398.23', 'balance-date': noon('2026-11-14') },
      { id: 'CHK', name: 'Demo Checking', balance: '50.00' },
    ],
  });
  assert.equal(set.accounts[0].availableBalance, 28398.23);
  assert.equal(reconcileBalanceOf(set.accounts[0]), 28398.23);
  assert.equal(set.accounts[1].availableBalance, null);
  assert.equal(reconcileBalanceOf(set.accounts[1]), 50);
});

test('isScheduledSyncDue waits a day after the last success and spaces out retries', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const H = 60 * 60 * 1000;
  // Never synced: due.
  assert.equal(isScheduledSyncDue({ nowMs: now, lastAttemptAt: null, lastSuccessAt: null }), true);
  // Succeeded 23h ago: not yet. 24h ago: due.
  assert.equal(isScheduledSyncDue({ nowMs: now, lastAttemptAt: ago(23 * H), lastSuccessAt: ago(23 * H) }), false);
  assert.equal(
    isScheduledSyncDue({ nowMs: now, lastAttemptAt: ago(SCHEDULED_SYNC_INTERVAL_MS), lastSuccessAt: ago(SCHEDULED_SYNC_INTERVAL_MS) }),
    true
  );
  // A failed attempt 10 minutes ago (last success 2 days ago) waits for the gap, then retries.
  assert.equal(isScheduledSyncDue({ nowMs: now, lastAttemptAt: ago(10 * 60 * 1000), lastSuccessAt: ago(48 * H) }), false);
  assert.equal(isScheduledSyncDue({ nowMs: now, lastAttemptAt: ago(MIN_SYNC_GAP_MS), lastSuccessAt: ago(48 * H) }), true);
});

test('nextScheduledSyncMs is a day after the last success, or null when due now', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const success = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(
    nextScheduledSyncMs({ nowMs: now, lastAttemptAt: success, lastSuccessAt: success }),
    Date.parse(success) + SCHEDULED_SYNC_INTERVAL_MS
  );
  assert.equal(nextScheduledSyncMs({ nowMs: now, lastAttemptAt: null, lastSuccessAt: null }), null);
  const old = new Date(now - 30 * 60 * 60 * 1000).toISOString();
  assert.equal(nextScheduledSyncMs({ nowMs: now, lastAttemptAt: old, lastSuccessAt: old }), null);
});

test('reconcileBalanceOf shows a liability-style negative figure as positive available credit', () => {
  const set = parseAccountSet({ accounts: [{ id: 'LOC', name: 'Demo HELOC', balance: '-7447.87' }] });
  assert.equal(reconcileBalanceOf(set.accounts[0]), 7447.87);
  const noBalance = parseAccountSet({ accounts: [{ id: 'X', name: 'No balance' }] });
  assert.equal(reconcileBalanceOf(noBalance.accounts[0]), null);
});
