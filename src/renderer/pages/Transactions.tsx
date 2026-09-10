import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Transaction, CreateTransactionInput } from '../../shared/types/transaction';
import { Account } from '../../shared/types/account';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import { Reconciliation } from '../../shared/types/reconciliation';
import { HelocSettings } from '../../shared/types/helocSettings';
import { Reserve } from '../../shared/types/reserve';
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
} from '../utils/format';

type ViewMode = 'month' | 'all';
type SortKey = 'date' | 'description' | 'account' | 'amount';
type SortDir = 'asc' | 'desc';

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
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
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
    const [txs, accts, recons, heloc, spendable, reserveList] = await Promise.all([
      window.electronAPI.transactions.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.reconciliations.getAll(),
      window.electronAPI.helocSettings.get(),
      window.electronAPI.balance.getSpendable(),
      window.electronAPI.reserves.getAll(),
    ]);
    setTransactions(txs);
    setAccounts(accts);
    setReconciliations(recons);
    setHelocSettings(heloc);
    setOverallSpendable(spendable);
    setReserves(reserveList);
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

  async function handleSave(input: CreateTransactionInput) {
    if (editing) {
      await window.electronAPI.transactions.update(editing.id, input);
    } else {
      await window.electronAPI.transactions.create(input);
    }
    setShowForm(false);
    setEditing(null);
    await load();
    if (currentMonth) await loadBalances(currentMonth);
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

  const ledgerRows = useMemo(() => {
    let running = bom?.balance ?? 0;
    return monthTransactions.map((tx) => {
      running += tx.amount;
      return { tx, balance: running };
    });
  }, [monthTransactions, bom]);

  const netCashFlow = bom && eom ? eom.balance - bom.balance : monthTransactions.reduce((s, t) => s + t.amount, 0);

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
  const totalReserved = reserves.reduce((sum, r) => sum + r.remaining, 0);
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
            <div className="value">{overallSpendable ? formatCurrency(overallSpendable.balance) : '—'}</div>
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
            {totalReserved > 0 && overallSpendable && (
              <div className="marquee-secondary">
                <div className="label">Truly Available</div>
                <div className="secondary-value">
                  {formatCurrency(overallSpendable.balance - totalReserved)}
                </div>
                <div className="sub">
                  {formatCurrency(totalReserved)} reserved · <Link to="/reserves">View reserves</Link>
                </div>
              </div>
            )}
          </div>

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
                <div className="stat-value">{formatCurrency(currentBalanceOwed)}</div>
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
                    <th>Description</th>
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
                    <td colSpan={5}>Beginning of month</td>
                    <td style={{ textAlign: 'right' }}>{bom && formatCurrency(bom.balance)}</td>
                    <td></td>
                    <td></td>
                  </tr>

                  {ledgerRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty-state">
                        No transactions this month.
                      </td>
                    </tr>
                  ) : (
                    ledgerRows.map(({ tx, balance }) => (
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
                        <td style={{ textAlign: 'right' }}>{formatCurrency(balance)}</td>
                        <td>{renderReconciledCell(tx)}</td>
                        <td className="ledger-actions">
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
                        </td>
                      </tr>
                    ))
                  )}

                  <tr className="ledger-marker">
                    <td colSpan={5}>End of month</td>
                    <td style={{ textAlign: 'right' }}>{eom && formatCurrency(eom.balance)}</td>
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
                    <td className="ledger-actions">
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
          reserves={reserves}
          defaultDate={editing ? undefined : newTransactionDate}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
