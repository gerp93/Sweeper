import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Transaction } from '../../shared/types/transaction';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import { Account } from '../../shared/types/account';
import { HelocSettings } from '../../shared/types/helocSettings';
import { formatCurrency, formatDate, monthKey, monthLabel, todayIso } from '../utils/format';

export default function Dashboard() {
  const [spendable, setSpendable] = useState<SpendableBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [helocSettings, setHelocSettings] = useState<HelocSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [bal, txs, accts, heloc] = await Promise.all([
      window.electronAPI.balance.getSpendable(),
      window.electronAPI.transactions.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.helocSettings.get(),
    ]);
    setSpendable(bal);
    setTransactions(txs);
    setAccounts(accts);
    setHelocSettings(heloc);
    setLoading(false);
  }

  const accountName = (id: string | null) => {
    if (!id) return '—';
    return accounts.find((a) => a.id === id)?.friendlyName ?? '—';
  };

  const thisMonthKey = monthKey(todayIso());
  const thisMonthTxs = transactions.filter((tx) => monthKey(tx.date) === thisMonthKey);
  const netThisMonth = thisMonthTxs.reduce((sum, tx) => sum + tx.amount, 0);
  const netAllTime = transactions.reduce((sum, tx) => sum + tx.amount, 0);

  const currentBalanceOwed =
    helocSettings?.originalAmount != null && spendable?.anchor ? helocSettings.originalAmount - spendable.balance : null;

  const recent = transactions.slice(0, 8);

  if (loading) return <div className="empty-state">Loading…</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
      </div>

      <div className="card marquee">
        <div className="label">HELOC Spendable Balance</div>
        <div className="value">{spendable ? formatCurrency(spendable.balance) : '—'}</div>
        {spendable?.anchor ? (
          <div className="sub">
            Starting from {formatCurrency(spendable.anchor.balance)} on {formatDate(spendable.anchor.asOfDate)}
            {' · '}
            {formatCurrency(spendable.netSinceAnchor)} net since
          </div>
        ) : (
          <div className="sub">
            No starting balance set yet. <Link to="/settings">Set one in Settings</Link>.
          </div>
        )}
      </div>

      <div className="stat-row" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="stat-label">Net Flow — {monthLabel(thisMonthKey)}</div>
          <div className={`stat-value ${netThisMonth >= 0 ? 'amount-positive' : 'amount-negative'}`}>
            {formatCurrency(netThisMonth)}
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

      <div className="card">
        <div className="page-header" style={{ marginBottom: 12 }}>
          <h1 style={{ fontSize: 16 }}>Recent Activity</h1>
          <Link to="/transactions" className="btn">
            View All
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="empty-state">No transactions yet. Import a statement to get started.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((tx) => (
                <tr key={tx.id}>
                  <td>{formatDate(tx.date)}</td>
                  <td>{tx.description}</td>
                  <td>{accountName(tx.accountId)}</td>
                  <td style={{ textAlign: 'right' }} className={tx.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                    {formatCurrency(tx.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
