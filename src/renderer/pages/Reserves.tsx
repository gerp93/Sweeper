import { useEffect, useState } from 'react';
import { Reserve } from '../../shared/types/reserve';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import CurrencyInput from '../components/CurrencyInput';
import { formatCurrency, formatDate, todayIso } from '../utils/format';

export default function Reserves() {
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [spendable, setSpendable] = useState<SpendableBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [list, balance] = await Promise.all([
      window.electronAPI.reserves.getAll(),
      window.electronAPI.balance.getSpendable(),
    ]);
    setReserves(list);
    setSpendable(balance);
    setLoading(false);
  }

  function resetForm() {
    setEditingId(null);
    setLabel('');
    setAmount('');
    setTargetDate('');
    setNote('');
    setError(null);
  }

  function startEdit(reserve: Reserve) {
    setEditingId(reserve.id);
    setLabel(reserve.label);
    setAmount(String(reserve.amount));
    setTargetDate(reserve.targetDate ?? '');
    setNote(reserve.note ?? '');
    setError(null);
  }

  const parsedAmount = parseFloat(amount);
  const amountValid = amount.trim() !== '' && !isNaN(parsedAmount) && parsedAmount > 0;
  const canSave = label.trim() !== '' && amountValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        label: label.trim(),
        amount: parsedAmount,
        targetDate: targetDate || null,
        note: note.trim() || null,
      };
      if (editingId) {
        await window.electronAPI.reserves.update(editingId, input);
      } else {
        await window.electronAPI.reserves.create(input);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this reserve? The funds it set aside become spendable again.')) return;
    await window.electronAPI.reserves.delete(id);
    if (editingId === id) resetForm();
    await load();
  }

  const today = todayIso();
  const totalReserved = reserves.reduce((sum, r) => sum + r.amount, 0);
  const trulyAvailable = spendable ? spendable.balance - totalReserved : null;

  return (
    <div>
      <div className="page-header">
        <h1>Reserves</h1>
      </div>

      <p className="text-muted" style={{ marginTop: -8, fontSize: 13, maxWidth: 720 }}>
        Reserves are dollars inside your HELOC spendable balance that are already spoken for — set aside on paper
        for a specific future payment, like a deferred-interest balance coming due — so they don't get swept up in
        everyday spending.
      </p>

      <div className="stat-row" style={{ marginTop: 12, marginBottom: 20 }}>
        <div className="card">
          <div className="stat-label">HELOC Spendable Balance</div>
          <div className="stat-value">{spendable ? formatCurrency(spendable.balance) : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">Total Reserved</div>
          <div className="stat-value">{formatCurrency(totalReserved)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Truly Available</div>
          <div className={`stat-value ${trulyAvailable != null && trulyAvailable < 0 ? 'amount-negative' : ''}`}>
            {trulyAvailable != null ? formatCurrency(trulyAvailable) : '—'}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>{editingId ? 'Edit Reserve' : 'New Reserve'}</h2>

        <div className="grid-2">
          <div className="field">
            <label>Label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Deferred interest payoff"
            />
          </div>
          <div className="field">
            <label>Amount</label>
            <CurrencyInput value={amount} onChange={setAmount} placeholder="e.g. $3,500.00" />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Target Date (optional)</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. promo ends, pay in full" />
          </div>
        </div>

        {error && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Reserve'}
          </button>
          {editingId && (
            <button className="btn" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Active Reserves</h2>
        </div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : reserves.length === 0 ? (
          <div className="empty-state">No reserves set aside yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Target Date</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reserves.map((r) => {
                const overdue = r.targetDate != null && r.targetDate < today;
                return (
                  <tr key={r.id}>
                    <td>{r.label}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(r.amount)}</td>
                    <td className={overdue ? 'amount-negative' : undefined}>
                      {r.targetDate ? formatDate(r.targetDate) : '—'}
                      {overdue ? ' (past due)' : ''}
                    </td>
                    <td>{r.note ?? '—'}</td>
                    <td className="ledger-actions">
                      <button className="btn-link" onClick={() => startEdit(r)}>
                        Edit
                      </button>
                      <button className="btn-link btn-link-danger" onClick={() => handleDelete(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
