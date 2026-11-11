import { useEffect, useState } from 'react';
import { CashEntry } from '../../shared/types/cashEntry';
import CurrencyInput from '../components/CurrencyInput';
import { formatCurrency, formatDate, todayIso } from '../utils/format';

// A standalone log of physical cash on hand. Each entry is "I had $X in cash on this date";
// the most recent one is treated as the current amount. Nothing here feeds into balances,
// projections, or any other part of the app.
export default function CashTracker() {
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const list = await window.electronAPI.cashEntries.getAll();
    setEntries(list);
    setLoading(false);
  }

  const parsedAmount = parseFloat(amount);
  const amountValid = amount.trim() !== '' && !isNaN(parsedAmount);
  const canSave = amountValid && date !== '' && !saving;
  const latest = entries[0] ?? null;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await window.electronAPI.cashEntries.create({
        amount: parsedAmount,
        date,
        note: note.trim() || null,
      });
      setAmount('');
      setNote('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this entry?')) return;
    await window.electronAPI.cashEntries.delete(id);
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Cash Tracker</h1>
      </div>

      <div className="stat-row" style={{ marginBottom: 20 }}>
        <div className="card">
          <div className="stat-label">Cash On Hand{latest ? ` (as of ${formatDate(latest.date)})` : ''}</div>
          <div className={`stat-value ${latest && latest.amount < 0 ? 'amount-negative' : ''}`}>
            {latest ? formatCurrency(latest.amount) : '—'}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Record Cash</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          A simple log of the physical cash you have on hand. This is separate from the rest of Sweeper and
          doesn't affect any balances or projections.
        </p>

        <div className="grid-2">
          <div className="field">
            <label>Amount</label>
            <CurrencyInput value={amount} onChange={setAmount} placeholder="e.g. $500.00" />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Notes (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. in the safe" />
        </div>

        {error && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>}

        <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
          {saving ? 'Saving…' : 'Add Entry'}
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>History</h2>
        </div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">No cash entries recorded yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.date)}</td>
                  <td style={{ textAlign: 'right' }} className={e.amount < 0 ? 'amount-negative' : undefined}>
                    {formatCurrency(e.amount)}
                  </td>
                  <td>{e.note ?? '—'}</td>
                  <td>
                    <div className="ledger-actions">
                      <button className="btn-link btn-link-danger" onClick={() => handleDelete(e.id)}>
                        Delete
                      </button>
                    </div>
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
