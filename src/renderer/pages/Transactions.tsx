import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Transaction, CreateTransactionInput } from '../../shared/types/transaction';
import { Account } from '../../shared/types/account';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import { Reconciliation } from '../../shared/types/reconciliation';
import { HelocSettings } from '../../shared/types/helocSettings';
import { Obligation } from '../../shared/types/obligation';
import { RecurringBill, RecurringBillOccurrence } from '../../shared/types/recurringBill';
import { IncomeProjection, IncomeProjectionOccurrence } from '../../shared/types/projection';
import { syncAutoDetectedBills } from '../utils/autoDetectBills';
import TransactionForm from '../components/TransactionForm';
import MonthNavSidebar from '../components/MonthNavSidebar';
import { useSetRightSidebar } from '../context/RightSidebarContext';
import { reconciledThrough } from '../utils/reconciliation';
import {
  formatCurrency,
  formatDate,
  monthKey,
  monthLabel,
  todayIso,
  shiftMonthKey,
  firstDayOfMonth,
  lastDayOfMonth,
  addDaysIso,
  daysBetween,
} from '../utils/format';

// How far past today's start of the rolling window (for the top "due soon / past due" banner
// and for the ledger row urgency labels) reaches back for overdue items and forward for
// upcoming ones. Independent of whichever month the ledger happens to be showing.
const OVERDUE_LOOKBACK_DAYS = 14;
const UPCOMING_LOOKAHEAD_DAYS = 7;
// A bill due within this many days (but not today/tomorrow, which get their own wording) reads
// as "due soon" instead of the generic "expected".
const DUE_SOON_DAYS = 5;

function dueStatusText(expectedDate: string, overdue: boolean): string {
  if (overdue) return `past due — expected ${formatDate(expectedDate)}`;
  const days = daysBetween(todayIso(), expectedDate);
  if (days <= 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days <= DUE_SOON_DAYS) return 'due soon';
  return 'expected';
}

type ViewMode = 'month' | 'all';
type SortKey = 'date' | 'description' | 'account' | 'amount';
type SortDir = 'asc' | 'desc';

type LedgerRow =
  | { kind: 'real'; tx: Transaction }
  | { kind: 'virtualBill'; occurrence: RecurringBillOccurrence }
  | { kind: 'virtualIncome'; occurrence: IncomeProjectionOccurrence };

interface PendingPrefill {
  date: string;
  description: string;
  accountId: string | null;
  amount: number;
  recurringBillId?: string | null;
}

interface Filters {
  description: string;
  accountId: string;
  memo: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
}

const EMPTY_FILTERS: Filters = {
  description: '',
  accountId: '',
  memo: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250];

const MEMO_INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'transparent',
  fontSize: 13,
};

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [helocSettings, setHelocSettings] = useState<HelocSettings | null>(null);
  const [overallSpendable, setOverallSpendable] = useState<SpendableBalance | null>(null);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [billOccurrences, setBillOccurrences] = useState<RecurringBillOccurrence[]>([]);
  const [incomeProjections, setIncomeProjections] = useState<IncomeProjection[]>([]);
  const [incomeOccurrences, setIncomeOccurrences] = useState<IncomeProjectionOccurrence[]>([]);
  // Independent of whichever month the ledger below is showing -- always "what's due relative
  // to real today", so it stays correct even while browsing a different month.
  const [urgentBillOccurrences, setUrgentBillOccurrences] = useState<RecurringBillOccurrence[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [prefill, setPrefill] = useState<PendingPrefill | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [bom, setBom] = useState<SpendableBalance | null>(null);
  const [eom, setEom] = useState<SpendableBalance | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (currentMonth) loadBalances(currentMonth);
  }, [currentMonth]);

  useEffect(() => {
    // Only the current or a future month gets pencilled-in reminders -- a past month should
    // show only what actually happened.
    if (currentMonth && currentMonth >= monthKey(todayIso())) {
      loadBillOccurrences(currentMonth);
      loadIncomeOccurrences(currentMonth);
    } else {
      setBillOccurrences([]);
      setIncomeOccurrences([]);
    }
  }, [currentMonth, recurringBills, incomeProjections]);

  useEffect(() => {
    loadUrgentBillOccurrences();
  }, [recurringBills]);

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize, sortKey, sortDir, viewMode]);

  useSetRightSidebar(
    viewMode === 'month' ? (
      <MonthNavSidebar
        transactions={transactions}
        currentMonth={currentMonth}
        onSelectMonth={setCurrentMonth}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
      />
    ) : null,
    sidebarCollapsed
  );

  async function load() {
    setLoading(true);
    const [txs, accts, recons, heloc, spendable, obligationList, billList, projectionList] = await Promise.all([
      window.electronAPI.transactions.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.reconciliations.getAll(),
      window.electronAPI.helocSettings.get(),
      window.electronAPI.balance.getSpendable(),
      window.electronAPI.obligations.getAll(),
      window.electronAPI.recurringBills.getAll(),
      window.electronAPI.projections.getAll(),
    ]);

    // Silently create any confident, still-active recurring bill this history hasn't already
    // been checked for -- so a pattern can show up as a ledger reminder without ever needing a
    // visit to the Recurring Bills page first.
    const created = await syncAutoDetectedBills(txs, billList, accts);
    const finalBillList = created.length > 0 ? await window.electronAPI.recurringBills.getAll() : billList;

    setTransactions(txs);
    setAccounts(accts);
    setReconciliations(recons);
    setHelocSettings(heloc);
    setOverallSpendable(spendable);
    setObligations(obligationList);
    setRecurringBills(finalBillList);
    setIncomeProjections(projectionList);
    setLoading(false);

    if (currentMonth === null) {
      const mostRecent = txs.reduce<string | null>(
        (latest, tx) => (latest === null || tx.date > latest ? tx.date : latest),
        null
      );
      setCurrentMonth(mostRecent ? monthKey(mostRecent) : monthKey(todayIso()));
    }
  }

  async function loadBalances(month: string) {
    setBalancesLoading(true);
    const [bomBalance, eomBalance] = await Promise.all([
      window.electronAPI.balance.getSpendable(lastDayOfMonth(shiftMonthKey(month, -1))),
      window.electronAPI.balance.getSpendable(lastDayOfMonth(month)),
    ]);
    setBom(bomBalance);
    setEom(eomBalance);
    setBalancesLoading(false);
  }

  async function loadBillOccurrences(month: string) {
    const occurrences = await window.electronAPI.recurringBills.getMonthlyOccurrences(
      firstDayOfMonth(month),
      lastDayOfMonth(month)
    );
    setBillOccurrences(occurrences);
  }

  async function loadIncomeOccurrences(month: string) {
    const occurrences = await window.electronAPI.projections.getMonthlyIncomeOccurrences(
      firstDayOfMonth(month),
      lastDayOfMonth(month)
    );
    setIncomeOccurrences(occurrences);
  }

  // A rolling window anchored on real today, not on whichever month the ledger below happens to
  // be showing -- so "what's due soon" stays correct even while browsing a different month.
  async function loadUrgentBillOccurrences() {
    const today = todayIso();
    const windowStart = addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);
    const windowEnd = addDaysIso(today, UPCOMING_LOOKAHEAD_DAYS);
    const occurrences = await window.electronAPI.recurringBills.getMonthlyOccurrences(windowStart, windowEnd);
    setUrgentBillOccurrences(
      occurrences.filter(
        (o) => o.status !== 'reconciled' && (o.status === 'overdue' || daysBetween(today, o.expectedDate) <= 1)
      )
    );
  }

  async function handleSave(input: CreateTransactionInput) {
    if (editing) {
      await window.electronAPI.transactions.update(editing.id, input);
    } else {
      await window.electronAPI.transactions.create(input);
    }
    setShowForm(false);
    setEditing(null);
    setPrefill(null);
    await load();
    if (currentMonth) await loadBalances(currentMonth);
  }

  function addRealTransactionForBill(occurrence: RecurringBillOccurrence) {
    setEditing(null);
    setPrefill({
      date: occurrence.expectedDate,
      description: occurrence.billLabel,
      accountId: recurringBills.find((b) => b.id === occurrence.billId)?.accountId ?? null,
      amount: occurrence.expectedAmount,
      recurringBillId: occurrence.billId,
    });
    setShowForm(true);
  }

  function addRealTransactionForIncome(occurrence: IncomeProjectionOccurrence) {
    setEditing(null);
    setPrefill({
      date: occurrence.expectedDate,
      description: occurrence.label,
      accountId: incomeProjections.find((p) => p.id === occurrence.projectionId)?.accountId ?? null,
      amount: occurrence.expectedAmount,
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction?')) return;
    await window.electronAPI.transactions.delete(id);
    await load();
    if (currentMonth) await loadBalances(currentMonth);
  }

  async function handleMemoBlur(tx: Transaction, value: string) {
    const trimmed = value.trim();
    if (trimmed === (tx.memo ?? '')) return;
    await window.electronAPI.transactions.update(tx.id, { memo: trimmed || null });
    await load();
  }

  const accountName = (id: string | null) => {
    if (!id) return '—';
    return accounts.find((a) => a.id === id)?.friendlyName ?? '—';
  };

  function renderReconciledCell(tx: Transaction) {
    const through = reconciledThrough(tx.date, reconciliations);
    if (!through) {
      return <span className="pill pill-unreconciled">Not yet</span>;
    }
    return formatDate(through);
  }

  function matchesFilters(tx: Transaction): boolean {
    if (filters.description && !tx.description.toLowerCase().includes(filters.description.toLowerCase())) {
      return false;
    }
    if (filters.accountId && tx.accountId !== filters.accountId) return false;
    if (filters.memo && !(tx.memo ?? '').toLowerCase().includes(filters.memo.toLowerCase())) return false;
    if (filters.dateFrom && tx.date < filters.dateFrom) return false;
    if (filters.dateTo && tx.date > filters.dateTo) return false;
    if (filters.amountMin.trim() !== '' && !isNaN(parseFloat(filters.amountMin)) && tx.amount < parseFloat(filters.amountMin)) {
      return false;
    }
    if (filters.amountMax.trim() !== '' && !isNaN(parseFloat(filters.amountMax)) && tx.amount > parseFloat(filters.amountMax)) {
      return false;
    }
    return true;
  }

  const hasActiveFilters = Object.values(filters).some((v) => v.trim() !== '');

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  // Month view: the running balance is computed against the FULL month sequence so it stays
  // correct, then filters only narrow which of those already-correct rows are displayed.
  const monthTransactions = useMemo(() => {
    if (!currentMonth) return [];
    return transactions
      .filter((tx) => monthKey(tx.date) === currentMonth)
      .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date < b.date ? -1 : 1));
  }, [transactions, currentMonth]);

  // A "reconciled" bill occurrence already has its real transaction showing in
  // monthTransactions -- showing a virtual row for it too would duplicate the line item. Only
  // occurrences still waiting on a real transaction become virtual rows. Income occurrences have
  // no such concept (no link from a real transaction back to a specific projection), so every
  // one returned is shown.
  const virtualBillOccurrences = useMemo(
    () => billOccurrences.filter((o) => o.status !== 'reconciled'),
    [billOccurrences]
  );

  const mergedRows = useMemo(() => {
    const real: LedgerRow[] = monthTransactions.map((tx) => ({ kind: 'real', tx }));
    const virtualBills: LedgerRow[] = virtualBillOccurrences.map((occurrence) => ({ kind: 'virtualBill', occurrence }));
    const virtualIncome: LedgerRow[] = incomeOccurrences.map((occurrence) => ({ kind: 'virtualIncome', occurrence }));
    const dateOf = (row: LedgerRow) =>
      row.kind === 'real' ? row.tx.date : row.occurrence.expectedDate;
    return [...real, ...virtualBills, ...virtualIncome].sort((a, b) => {
      const dateA = dateOf(a);
      const dateB = dateOf(b);
      if (dateA !== dateB) return dateA < dateB ? -1 : 1;
      // Real rows sort ahead of a virtual row landing on the same date.
      return a.kind === 'real' ? -1 : b.kind === 'real' ? 1 : 0;
    });
  }, [monthTransactions, virtualBillOccurrences, incomeOccurrences]);

  const ledgerRows = useMemo(() => {
    // Only real transactions ever move `running` -- it's the authoritative real balance, and a
    // real row's displayed balance must never be affected by virtual rows' presence (a real row
    // always reflects `running` alone). `projectedRunning` is a second, separate accumulator:
    // it tracks what the balance would be if every occurrence shown so far actually happens, so
    // consecutive virtual rows correctly chain off each other (and off the real balance) instead
    // of each one independently showing bom.balance + just its own amount. It resets to `running`
    // on every real row, since a real transaction posting supersedes whatever was projected
    // before it.
    let running = bom?.balance ?? 0;
    let projectedRunning = running;
    return mergedRows.map((row) => {
      if (row.kind === 'real') {
        running += row.tx.amount;
        projectedRunning = running;
        return { ...row, balance: running };
      }
      projectedRunning += row.occurrence.expectedAmount;
      return { ...row, balance: projectedRunning };
    });
  }, [mergedRows, bom]);

  const netCashFlow = bom && eom ? eom.balance - bom.balance : monthTransactions.reduce((s, t) => s + t.amount, 0);

  // For the current month or any future month, blend the real net cash flow above with what's
  // still only pencilled in (unreconciled bill occurrences + income projections) so the user can
  // see where the month is headed, not just what's posted so far. null for past months, where
  // there's nothing left to project -- netCashFlow alone is already the complete picture.
  const isCurrentOrFutureMonth = currentMonth !== null && currentMonth >= monthKey(todayIso());
  const projectedNetCashFlow = isCurrentOrFutureMonth
    ? netCashFlow +
      virtualBillOccurrences.reduce((s, o) => s + o.expectedAmount, 0) +
      incomeOccurrences.reduce((s, o) => s + o.expectedAmount, 0)
    : null;

  // The real "End of month" balance never moves for a future month with no real transactions
  // yet -- that's correct (it's real, not projected), but shown alone it looks like the ledger
  // isn't tracking the bills/income listed above it. This is the same end point the last row's
  // own Balance column already lands on (ledgerRows chains virtual rows together via
  // projectedRunning), surfaced next to "End of month" too so the two don't visually disagree.
  const projectedEomBalance = ledgerRows.length > 0 ? ledgerRows[ledgerRows.length - 1].balance : null;

  function goToMonth(delta: number) {
    if (!currentMonth) return;
    setCurrentMonth(shiftMonthKey(currentMonth, delta));
  }

  // All-transactions view: flat, filtered, sorted, and paginated across every transaction.
  const allFiltered = useMemo(
    () => transactions.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, filters]
  );

  const allSorted = useMemo(() => {
    const rows = allFiltered.map((tx) => ({ tx, accountLabel: accountName(tx.accountId) }));
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') cmp = a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : 0;
      else if (sortKey === 'description') cmp = a.tx.description.localeCompare(b.tx.description);
      else if (sortKey === 'account') cmp = a.accountLabel.localeCompare(b.accountLabel);
      else if (sortKey === 'amount') cmp = a.tx.amount - b.tx.amount;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows.map((r) => r.tx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFiltered, sortKey, sortDir, accounts]);

  const totalPages = Math.max(1, Math.ceil(allSorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedTransactions = useMemo(
    () => allSorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [allSorted, currentPage, pageSize]
  );

  const newTransactionDate =
    currentMonth && currentMonth !== monthKey(todayIso()) ? firstDayOfMonth(currentMonth) : todayIso();

  const hasAnchor = Boolean(bom?.anchor);

  const thisCalendarMonthKey = monthKey(todayIso());
  const netThisCalendarMonth = transactions
    .filter((tx) => monthKey(tx.date) === thisCalendarMonthKey)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const netAllTime = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const totalObligated = obligations.reduce((sum, o) => sum + o.remaining, 0);
  const currentBalanceOwed =
    helocSettings?.originalAmount != null && overallSpendable?.anchor
      ? helocSettings.originalAmount - overallSpendable.balance
      : null;

  function renderMemoInput(tx: Transaction) {
    return (
      <input
        defaultValue={tx.memo ?? ''}
        onBlur={(e) => handleMemoBlur(tx, e.target.value)}
        placeholder="Add a note…"
        style={MEMO_INPUT_STYLE}
        onFocus={(e) => (e.target.style.border = '1px solid var(--color-primary-action-hover)')}
      />
    );
  }

  return (
    <div>
      {!loading && (
        <>
          <div className="card marquee">
            <div className="label">HELOC Spendable Balance</div>
            <div className={overallSpendable && overallSpendable.balance < 0 ? 'value amount-negative' : 'value'}>
              {overallSpendable ? formatCurrency(overallSpendable.balance) : '—'}
            </div>
            {overallSpendable?.anchor ? (
              <div className="sub">
                Starting from {formatCurrency(overallSpendable.anchor.balance)} on{' '}
                {formatDate(overallSpendable.anchor.asOfDate)} · {formatCurrency(overallSpendable.netSinceAnchor)} net
                since
              </div>
            ) : (
              <div className="sub">
                No starting balance set yet. <Link to="/settings">Set one in Settings</Link>.
              </div>
            )}
            {totalObligated > 0 && overallSpendable && (
              <div className="marquee-secondary">
                <div className="label">Truly Available</div>
                <div
                  className={
                    overallSpendable.balance - totalObligated < 0 ? 'secondary-value amount-negative' : 'secondary-value'
                  }
                >
                  {formatCurrency(overallSpendable.balance - totalObligated)}
                </div>
                <div className="sub">
                  {formatCurrency(totalObligated)} obligated · <Link to="/obligations">View obligations</Link>
                </div>
              </div>
            )}
          </div>

          {urgentBillOccurrences.length > 0 && (
            <div
              className="card"
              style={{
                marginTop: 20,
                borderColor: 'var(--color-accent-red)',
                borderWidth: 2,
                background: 'rgba(220, 38, 38, 0.12)',
              }}
            >
              <h2 style={{ fontSize: 15, marginTop: 0, color: 'var(--color-accent-red)' }}>
                ⚠ Action Needed
              </h2>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {urgentBillOccurrences
                  .slice()
                  .sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1))
                  .map((o) => (
                    <li key={`${o.billId}-${o.expectedDate}`} style={{ marginBottom: 4 }}>
                      <strong>{o.billLabel}</strong> — {formatCurrency(o.expectedAmount)} (
                      <strong style={{ textTransform: 'uppercase' }}>
                        {dueStatusText(o.expectedDate, o.status === 'overdue')}
                      </strong>
                      ) —{' '}
                      <button className="btn-link" onClick={() => addRealTransactionForBill(o)}>
                        + Add real transaction
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="stat-row" style={{ marginTop: 20, marginBottom: 20 }}>
            <div className="card">
              <div className="stat-label">Net Flow — {monthLabel(thisCalendarMonthKey)}</div>
              <div className={`stat-value ${netThisCalendarMonth >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                {formatCurrency(netThisCalendarMonth)}
              </div>
            </div>
            <div className="card">
              <div className="stat-label">Tracked Transactions</div>
              <div className="stat-value">{transactions.length}</div>
            </div>
            <div className="card">
              <div className="stat-label">Accounts</div>
              <div className="stat-value">{accounts.length}</div>
            </div>
            <div className="card">
              <div className="stat-label">All-Time Net Cash Flow</div>
              <div className={`stat-value ${netAllTime >= 0 ? 'amount-positive' : 'amount-negative'}`}>
                {formatCurrency(netAllTime)}
              </div>
            </div>
            {currentBalanceOwed != null && (
              <div className="card">
                <div className="stat-label">Current Balance Owed</div>
                <div className={`stat-value ${currentBalanceOwed < 0 ? 'amount-negative' : ''}`}>
                  {formatCurrency(currentBalanceOwed)}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="page-header">
        <div />
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setPrefill(null);
            setShowForm(true);
          }}
        >
          + Add Transaction
        </button>
      </div>

      <div className="tab-bar">
        <button
          className={`tab-button${viewMode === 'month' ? ' active' : ''}`}
          onClick={() => setViewMode('month')}
        >
          Month View
        </button>
        <button className={`tab-button${viewMode === 'all' ? ' active' : ''}`} onClick={() => setViewMode('all')}>
          All Transactions
        </button>
      </div>

      {viewMode === 'all' && (
        <div className="filter-bar">
          <div className="filter-field">
            <label>Description</label>
            <input
              value={filters.description}
              onChange={(e) => updateFilter('description', e.target.value)}
              placeholder="Search description…"
            />
          </div>
          <div className="filter-field">
            <label>Account</label>
            <select value={filters.accountId} onChange={(e) => updateFilter('accountId', e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.friendlyName}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label>Memo</label>
            <input
              value={filters.memo}
              onChange={(e) => updateFilter('memo', e.target.value)}
              placeholder="Search memo…"
            />
          </div>
          <div className="filter-field">
            <label>Date Range</label>
            <div className="filter-range">
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => updateFilter('dateFrom', e.target.value)}
              />
              <span>–</span>
              <input type="date" value={filters.dateTo} onChange={(e) => updateFilter('dateTo', e.target.value)} />
            </div>
          </div>
          <div className="filter-field">
            <label>Amount Range</label>
            <div className="filter-range">
              <input
                type="number"
                step="0.01"
                placeholder="Min"
                value={filters.amountMin}
                onChange={(e) => updateFilter('amountMin', e.target.value)}
              />
              <span>–</span>
              <input
                type="number"
                step="0.01"
                placeholder="Max"
                value={filters.amountMax}
                onChange={(e) => updateFilter('amountMax', e.target.value)}
              />
            </div>
          </div>
          {hasActiveFilters && (
            <button className="btn-link" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : viewMode === 'month' ? (
        !currentMonth ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div className="ledger-nav">
              <button className="btn" onClick={() => goToMonth(-1)}>
                ‹ Prev
              </button>
              <div className="ledger-nav-title">
                <div style={{ fontWeight: 600, fontSize: 16 }}>{monthLabel(currentMonth)}</div>
                {!balancesLoading && (
                  <div className={netCashFlow >= 0 ? 'amount-positive' : 'amount-negative'} style={{ fontSize: 13 }}>
                    Net cash flow: {formatCurrency(netCashFlow)}
                  </div>
                )}
                {!balancesLoading && projectedNetCashFlow !== null && (
                  <div
                    className={projectedNetCashFlow >= 0 ? 'amount-positive' : 'amount-negative'}
                    style={{ fontSize: 12, opacity: 0.8 }}
                  >
                    Projected: {formatCurrency(projectedNetCashFlow)}
                  </div>
                )}
              </div>
              <button className="btn" onClick={() => goToMonth(1)}>
                Next ›
              </button>
            </div>

            {!hasAnchor ? (
              <div className="anchor-required">
                <div className="anchor-required-title">No starting balance set</div>
                <p>
                  Your {transactions.length} transaction{transactions.length === 1 ? '' : 's'} are safe and untouched
                  — this ledger just needs a starting balance to compute beginning/ending balances and running
                  totals from.
                </p>
                <Link to="/settings" className="btn btn-primary">
                  Set starting balance in Settings
                </Link>
              </div>
            ) : (
              <table className="data-table ledger">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Memo</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Balance</th>
                    <th>Reconciled</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="ledger-marker">
                    <td colSpan={4}>Beginning of month</td>
                    <td style={{ textAlign: 'right' }} className={bom && bom.balance < 0 ? 'amount-negative' : undefined}>
                      {bom && formatCurrency(bom.balance)}
                    </td>
                    <td></td>
                    <td></td>
                  </tr>

                  {ledgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-state">
                        No transactions this month.
                      </td>
                    </tr>
                  ) : (
                    ledgerRows.map((row) => {
                      if (row.kind === 'virtualBill') {
                        const { occurrence, balance } = row;
                        const overdue = occurrence.status === 'overdue';
                        return (
                          <tr
                            key={`virtual-bill-${occurrence.billId}-${occurrence.expectedDate}`}
                            className="ledger-row-projected-expense"
                          >
                            <td>{formatDate(occurrence.expectedDate)}</td>
                            <td>
                              {accountName(recurringBills.find((b) => b.id === occurrence.billId)?.accountId ?? null)}
                            </td>
                            <td>
                              {occurrence.billLabel} ({dueStatusText(occurrence.expectedDate, overdue)})
                            </td>
                            <td style={{ textAlign: 'right' }} className="amount-negative">
                              {formatCurrency(occurrence.expectedAmount)}
                            </td>
                            <td style={{ textAlign: 'right' }} className={balance < 0 ? 'amount-negative' : undefined}>
                              {formatCurrency(balance)}
                            </td>
                            <td>—</td>
                            <td>
                              <div className="ledger-actions">
                                <button className="btn-link" onClick={() => addRealTransactionForBill(occurrence)}>
                                  + Add real transaction
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      if (row.kind === 'virtualIncome') {
                        const { occurrence, balance } = row;
                        return (
                          <tr
                            key={`virtual-income-${occurrence.projectionId}-${occurrence.expectedDate}`}
                            className="ledger-row-projected-income"
                          >
                            <td>{formatDate(occurrence.expectedDate)}</td>
                            <td>
                              {accountName(
                                incomeProjections.find((p) => p.id === occurrence.projectionId)?.accountId ?? null
                              )}
                            </td>
                            <td>
                              {occurrence.label} ({dueStatusText(occurrence.expectedDate, false)})
                            </td>
                            <td style={{ textAlign: 'right' }} className="amount-positive-bright">
                              {formatCurrency(occurrence.expectedAmount)}
                            </td>
                            <td style={{ textAlign: 'right' }} className={balance < 0 ? 'amount-negative' : 'amount-positive-bright'}>
                              {formatCurrency(balance)}
                            </td>
                            <td>—</td>
                            <td>
                              <div className="ledger-actions">
                                <button className="btn-link" onClick={() => addRealTransactionForIncome(occurrence)}>
                                  + Add real transaction
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      const { tx, balance } = row;
                      return (
                        <tr key={tx.id}>
                          <td>{formatDate(tx.date)}</td>
                          <td>{accountName(tx.accountId)}</td>
                          <td>{renderMemoInput(tx)}</td>
                          <td
                            style={{ textAlign: 'right' }}
                            className={tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}
                          >
                            {formatCurrency(tx.amount)}
                          </td>
                          <td style={{ textAlign: 'right' }} className={balance < 0 ? 'amount-negative' : undefined}>
                            {formatCurrency(balance)}
                          </td>
                          <td>{renderReconciledCell(tx)}</td>
                          <td>
                            <div className="ledger-actions">
                              <button
                                className="btn-link"
                                onClick={() => {
                                  setEditing(tx);
                                  setPrefill(null);
                                  setShowForm(true);
                                }}
                              >
                                Edit
                              </button>
                              <button className="btn-link btn-link-danger" onClick={() => handleDelete(tx.id)}>
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}

                  <tr className="ledger-marker">
                    <td colSpan={4}>End of month</td>
                    <td style={{ textAlign: 'right' }} className={eom && eom.balance < 0 ? 'amount-negative' : undefined}>
                      {eom && formatCurrency(eom.balance)}
                      {projectedEomBalance !== null &&
                        eom &&
                        Math.round(projectedEomBalance * 100) !== Math.round(eom.balance * 100) && (
                          <div
                            className={projectedEomBalance >= 0 ? 'amount-positive' : 'amount-negative'}
                            style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}
                          >
                            Projected: {formatCurrency(projectedEomBalance)}
                          </div>
                        )}
                    </td>
                    <td></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            )}

            <div className="ledger-nav ledger-nav-bottom">
              {!balancesLoading && (
                <div className={netCashFlow >= 0 ? 'amount-positive' : 'amount-negative'}>
                  Net cash flow: {formatCurrency(netCashFlow)}
                </div>
              )}
              {!balancesLoading && projectedNetCashFlow !== null && (
                <div
                  className={projectedNetCashFlow >= 0 ? 'amount-positive' : 'amount-negative'}
                  style={{ fontSize: 13, opacity: 0.8 }}
                >
                  Projected (incl. upcoming bills/income): {formatCurrency(projectedNetCashFlow)}
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="sortable-th" onClick={() => toggleSort('date')}>
                  Date{sortIndicator('date')}
                </th>
                <th className="sortable-th" onClick={() => toggleSort('description')}>
                  Description{sortIndicator('description')}
                </th>
                <th className="sortable-th" onClick={() => toggleSort('account')}>
                  Account{sortIndicator('account')}
                </th>
                <th>Memo</th>
                <th className="sortable-th" style={{ textAlign: 'right' }} onClick={() => toggleSort('amount')}>
                  Amount{sortIndicator('amount')}
                </th>
                <th>Reconciled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pagedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    {transactions.length === 0 ? 'No transactions yet.' : 'No transactions match the current filters.'}
                  </td>
                </tr>
              ) : (
                pagedTransactions.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.date)}</td>
                    <td>{tx.description}</td>
                    <td>{accountName(tx.accountId)}</td>
                    <td>{renderMemoInput(tx)}</td>
                    <td
                      style={{ textAlign: 'right' }}
                      className={tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}
                    >
                      {formatCurrency(tx.amount)}
                    </td>
                    <td>{renderReconciledCell(tx)}</td>
                    <td>
                      <div className="ledger-actions">
                        <button
                          className="btn-link"
                          onClick={() => {
                            setEditing(tx);
                            setShowForm(true);
                          }}
                        >
                          Edit
                        </button>
                        <button className="btn-link btn-link-danger" onClick={() => handleDelete(tx.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="pagination-bar">
            <div>
              {allSorted.length} transaction{allSorted.length === 1 ? '' : 's'}
            </div>
            <div className="pagination-controls">
              <label style={{ fontSize: 12, color: 'var(--color-accent-blue)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Show
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                per page
              </label>
              <button className="btn" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ‹ Prev
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next ›
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <TransactionForm
          transaction={editing ?? undefined}
          accounts={accounts}
          obligations={obligations}
          recurringBills={recurringBills}
          defaultDate={editing ? undefined : prefill?.date ?? newTransactionDate}
          defaultValues={
            prefill
              ? {
                  description: prefill.description,
                  accountId: prefill.accountId,
                  amount: prefill.amount,
                  recurringBillId: prefill.recurringBillId,
                }
              : undefined
          }
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
            setPrefill(null);
          }}
        />
      )}
    </div>
  );
}
