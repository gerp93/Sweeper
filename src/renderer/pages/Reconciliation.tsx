import { useEffect, useState } from 'react';
import { Reconciliation } from '../../shared/types/reconciliation';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import CurrencyInput from '../components/CurrencyInput';
import { formatCurrency, formatDate, todayIso } from '../utils/format';

export default function ReconciliationPage() {
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [bankBalance, setBankBalance] = useState('');
  const [note, setNote] = useState('');
  const [computed, setComputed] = useState<SpendableBalance | null>(null);
  const [computedLoading, setComputedLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadComputed(asOfDate);
  }, [asOfDate]);

  async function load() {
    setLoading(true);
    setError(null);
    const list = await window.electronAPI.reconciliations.getAll();
    setReconciliations(list);
    setLoading(false);
  }

  async function loadComputed(date: string) {
    setComputedLoading(true);
    const balance = await window.electronAPI.balance.getSpendable(date);
    setComputed(balance);
    setComputedLoading(false);
  }

  const today = todayIso();
  const isFutureDate = asOfDate > today;
  const parsedBankBalance = parseFloat(bankBalance);
  const bankBalanceValid = bankBalance.trim() !== '' && !isNaN(parsedBankBalance);
  const canSave = bankBalanceValid && !isFutureDate && !saving;
  const liveDifference =
    computed && bankBalanceValid ? Math.round((parsedBankBalance - computed.balance) * 100) / 100 : null;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.reconciliations.create({
        asOfDate,
        bankBalance: parsedBankBalance,
        note: note.trim() || null,
      });
      setBankBalance('');
      setNote('');
      await load();
      await loadComputed(asOfDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this reconciliation?')) return;
    await window.electronAPI.reconciliations.delete(id);
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Reconcile</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Confirm Balance</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Compare Sweeper's computed spendable balance as of a date against what your bank actually shows for the
          HELOC, and record that you checked. Every transaction dated on or before this date will then show as
          reconciled through it.
        </p>

        <div className="grid-2">
          <div className="field">
            <label>As Of Date</label>
            <input
              type="date"
              value={asOfDate}
              max={today}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Actual HELOC Balance (from your bank)</label>
            <CurrencyInput value={bankBalance} onChange={setBankBalance} placeholder="e.g. $28,398.23" />
          </div>
        </div>

        {isFutureDate && (
          <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>
            You can't reconcile a date in the future yet — come back once it's arrived.
          </p>
        )}

        <div className="stat-row" style={{ marginTop: 4, marginBottom: 12 }}>
          <div className="card">
            <div className="stat-label">Sweeper's Computed Balance</div>
            <div className="stat-value">
              {computedLoading ? '…' : computed ? formatCurrency(computed.balance) : '—'}
            </div>
          </div>
          <div className="card">
            <div className="stat-label">Difference</div>
            <div className={`stat-value ${liveDifference != null && liveDifference !== 0 ? 'amount-negative' : ''}`}>
              {liveDifference != null ? formatCurrency(liveDifference) : '—'}
            </div>
          </div>
        </div>

        <div className="field">
          <label>Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. checked against online statement" />
        </div>

        {error && (
          <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>
        )}

        <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
          {saving ? 'Saving…' : 'Confirm Reconciliation'}
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>History</h2>
        </div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : reconciliations.length === 0 ? (
          <div className="empty-state">No reconciliations recorded yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>As Of</th>
                <th style={{ textAlign: 'right' }}>Bank Balance</th>
                <th style={{ textAlign: 'right' }}>Computed Balance</th>
                <th style={{ textAlign: 'right' }}>Difference</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.asOfDate)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.bankBalance)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.computedBalance)}</td>
                  <td style={{ textAlign: 'right' }} className={r.difference !== 0 ? 'amount-negative' : undefined}>
                    {formatCurrency(r.difference)}
                  </td>
                  <td>{r.note ?? '—'}</td>
                  <td className="ledger-actions">
                    <button className="btn-link btn-link-danger" onClick={() => handleDelete(r.id)}>
                      Delete
                    </button>
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
