import { useEffect, useState } from 'react';
import { IncomeProjection, ProjectionFrequency, ProjectionSeriesPoint } from '../../shared/types/projection';
import { Account } from '../../shared/types/account';
import CurrencyInput from '../components/CurrencyInput';
import { formatCurrency, formatDate, todayIso } from '../utils/format';

const FREQUENCY_LABELS: Record<ProjectionFrequency, string> = {
  once: 'One-time',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

const HORIZON_OPTIONS = [3, 6, 12];

export default function Projections() {
  const [projections, setProjections] = useState<IncomeProjection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [series, setSeries] = useState<ProjectionSeriesPoint[]>([]);
  const [todaySpendable, setTodaySpendable] = useState<number | null>(null);
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<ProjectionFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadSeries(horizonMonths);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonMonths, projections]);

  async function load() {
    setLoading(true);
    const [list, accts, spendable] = await Promise.all([
      window.electronAPI.projections.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.balance.getSpendable(),
    ]);
    setProjections(list);
    setAccounts(accts);
    setTodaySpendable(spendable.balance);
    setLoading(false);
  }

  async function loadSeries(months: number) {
    const result = await window.electronAPI.projections.getSeries(months);
    setSeries(result);
  }

  function accountName(id: string | null) {
    if (!id) return null;
    return accounts.find((a) => a.id === id)?.friendlyName ?? null;
  }

  function resetForm() {
    setModalOpen(false);
    setEditingId(null);
    setLabel('');
    setAmount('');
    setFrequency('monthly');
    setStartDate(todayIso());
    setEndDate('');
    setAccountId('');
    setNote('');
    setError(null);
  }

  function startAdd() {
    resetForm();
    setModalOpen(true);
  }

  function startEdit(projection: IncomeProjection) {
    setModalOpen(true);
    setEditingId(projection.id);
    setLabel(projection.label);
    setAmount(String(projection.amount));
    setFrequency(projection.frequency);
    setStartDate(projection.startDate);
    setEndDate(projection.endDate ?? '');
    setAccountId(projection.accountId ?? '');
    setNote(projection.note ?? '');
    setError(null);
  }

  const parsedAmount = parseFloat(amount);
  const canSave = label.trim() !== '' && amount.trim() !== '' && !isNaN(parsedAmount) && parsedAmount > 0 && startDate.trim() !== '' && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        label: label.trim(),
        amount: parsedAmount,
        frequency,
        startDate,
        endDate: endDate || null,
        accountId: accountId || null,
        note: note.trim() || null,
      };
      if (editingId) {
        await window.electronAPI.projections.update(editingId, input);
      } else {
        await window.electronAPI.projections.create(input);
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
    if (!confirm('Delete this income projection?')) return;
    await window.electronAPI.projections.delete(id);
    await load();
  }

  const lastPoint = series.length > 0 ? series[series.length - 1] : null;

  return (
    <div>
      <div className="page-header">
        <h1>Projections</h1>
        <button className="btn btn-primary" onClick={startAdd}>
          + New Income Projection
        </button>
      </div>

      <p className="text-muted" style={{ marginTop: -8, fontSize: 13, maxWidth: 720 }}>
        Pencil in income you expect but haven't received yet — a paycheck, a bonus, anything recurring — to see a
        rough projected balance at a future date. Everything below is an estimate based on what you enter, not a
        guarantee, and it never affects your real transactions or today's actual balances.
      </p>

      <div className="stat-row" style={{ marginTop: 12, marginBottom: 20 }}>
        <div className="card">
          <div className="stat-label">Today's Spendable Balance</div>
          <div className="stat-value">{todaySpendable != null ? formatCurrency(todaySpendable) : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">Projected Spendable ({horizonMonths}mo)</div>
          <div className="stat-value">{lastPoint ? formatCurrency(lastPoint.projectedSpendableBalance) : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">Projected Truly Available ({horizonMonths}mo)</div>
          <div
            className={`stat-value ${lastPoint && lastPoint.projectedTrulyAvailable < 0 ? 'amount-negative' : ''}`}
          >
            {lastPoint ? formatCurrency(lastPoint.projectedTrulyAvailable) : '—'}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 20 }}>
        <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Month by Month</h2>
          <div className="tab-bar" style={{ margin: 0, border: 'none' }}>
            {HORIZON_OPTIONS.map((m) => (
              <button
                key={m}
                className={`tab-button${horizonMonths === m ? ' active' : ''}`}
                onClick={() => setHorizonMonths(m)}
              >
                {m} mo
              </button>
            ))}
          </div>
        </div>
        {series.length === 0 ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <table className="data-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Projected Spendable</th>
                <th style={{ textAlign: 'right' }}>Obligated by then</th>
                <th style={{ textAlign: 'right' }}>Projected Truly Available</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.asOf}>
                  <td>{point.monthLabel}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(point.projectedSpendableBalance)}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(point.obligationsDueByDate)}</td>
                  <td
                    style={{ textAlign: 'right' }}
                    className={point.projectedTrulyAvailable < 0 ? 'amount-negative' : undefined}
                  >
                    {formatCurrency(point.projectedTrulyAvailable)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '16px 16px 0' }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>Income Projections</h2>
        </div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : projections.length === 0 ? (
          <div className="empty-state">No income projections yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Frequency</th>
                <th>Start</th>
                <th>End</th>
                <th>Linked Account</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p) => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(p.amount)}</td>
                  <td>{FREQUENCY_LABELS[p.frequency]}</td>
                  <td>{formatDate(p.startDate)}</td>
                  <td>{p.endDate ? formatDate(p.endDate) : '—'}</td>
                  <td>{accountName(p.accountId) ?? '—'}</td>
                  <td className="ledger-actions">
                    <button className="btn-link" onClick={() => startEdit(p)}>
                      Edit
                    </button>
                    <button className="btn-link btn-link-danger" onClick={() => handleDelete(p.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={resetForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Income Projection' : 'New Income Projection'}</h2>

            <div className="field">
              <label>Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Paycheck"
                autoFocus
              />
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Amount (per occurrence)</label>
                <CurrencyInput value={amount} onChange={setAmount} placeholder="e.g. $2,000.00" />
              </div>
              <div className="field">
                <label>Frequency</label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as ProjectionFrequency)}>
                  {Object.entries(FREQUENCY_LABELS).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="field">
                <label>End Date (optional)</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="field">
              <label>Linked Account (optional)</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">(none)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.friendlyName}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. base pay, before tax" />
            </div>

            {frequency === 'monthly' && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: -8 }}>
                For a twice-monthly paycheck (e.g. 1st and 15th), add two separate monthly projections with
                different start dates.
              </p>
            )}

            {error && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>}

            <div className="modal-actions">
              <button className="btn" onClick={resetForm}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Projection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
