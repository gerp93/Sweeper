import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Transaction, CreateTransactionInput } from '../../shared/types/transaction';
import { Account } from '../../shared/types/account';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import TransactionForm from '../components/TransactionForm';
import MonthNavSidebar from '../components/MonthNavSidebar';
import { useSetRightSidebar } from '../context/RightSidebarContext';
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

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [bom, setBom] = useState<SpendableBalance | null>(null);
  const [eom, setEom] = useState<SpendableBalance | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (currentMonth) loadBalances(currentMonth);
  }, [currentMonth]);

  useSetRightSidebar(
    <MonthNavSidebar
      transactions={transactions}
      currentMonth={currentMonth}
      onSelectMonth={setCurrentMonth}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
    />,
    sidebarCollapsed
  );

  async function load() {
    setLoading(true);
    const [txs, accts] = await Promise.all([
      window.electronAPI.transactions.getAll(),
      window.electronAPI.accounts.getAll(),
    ]);
    setTransactions(txs);
    setAccounts(accts);
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

  const newTransactionDate =
    currentMonth && currentMonth !== monthKey(todayIso()) ? firstDayOfMonth(currentMonth) : todayIso();

  const hasAnchor = Boolean(bom?.anchor);

  return (
    <div>
      <div className="page-header">
        <h1>Transactions</h1>
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

      {loading || !currentMonth ? (
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
                — this ledger just needs a starting balance to compute beginning/ending balances and running totals
                from.
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr className="ledger-marker">
                  <td colSpan={5}>Beginning of month</td>
                  <td style={{ textAlign: 'right' }}>{bom && formatCurrency(bom.balance)}</td>
                  <td></td>
                </tr>

                {ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      No transactions this month.
                    </td>
                  </tr>
                ) : (
                  ledgerRows.map(({ tx, balance }) => (
                    <tr key={tx.id}>
                      <td>{formatDate(tx.date)}</td>
                      <td>{tx.description}</td>
                      <td>{accountName(tx.accountId)}</td>
                      <td>
                        <input
                          defaultValue={tx.memo ?? ''}
                          onBlur={(e) => handleMemoBlur(tx, e.target.value)}
                          placeholder="Add a note…"
                          style={{
                            width: '100%',
                            padding: '4px 6px',
                            border: '1px solid transparent',
                            borderRadius: 6,
                            background: 'transparent',
                            fontSize: 13,
                          }}
                          onFocus={(e) => (e.target.style.border = '1px solid var(--color-primary-action-hover)')}
                        />
                      </td>
                      <td
                        style={{ textAlign: 'right' }}
                        className={tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}
                      >
                        {formatCurrency(tx.amount)}
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(balance)}</td>
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
      )}

      {showForm && (
        <TransactionForm
          transaction={editing ?? undefined}
          accounts={accounts}
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
