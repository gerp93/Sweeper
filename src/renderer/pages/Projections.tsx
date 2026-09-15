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
// Must match BURN_LOOKBACK_MONTHS in projectionService.ts -- display-only, doesn't drive the calc.
const BURN_LOOKBACK_MONTHS = 3;

// A small dependency-free bar chart: one bar per month's projected truly-available balance,
// diverging around a zero baseline. Bars below zero (a projected shortfall) use the same red
// token as amount-negative everywhere else in the app; the first shortfall gets a marker.
function ShortfallChart({ series }: { series: ProjectionSeriesPoint[] }) {
  const height = 140;
  const paddingTop = 20;
  const paddingBottom = 36; // extra room so a negative-value label never collides with the month label below it
  const plotHeight = height - paddingTop - paddingBottom;
  const barGap = 12;
  const width = Math.max(320, series.length * 70);
  const barWidth = (width - barGap * (series.length + 1)) / series.length;

  const values = series.map((p) => p.projectedTrulyAvailable);
  const maxVal = Math.max(...values, 0);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;
  const yFor = (v: number) => paddingTop + plotHeight - ((v - minVal) / range) * plotHeight;
  const yZero = yFor(0);

  const shortfallIndex = series.findIndex((p) => p.projectedTrulyAvailable < 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      <line x1={0} y1={yZero} x2={width} y2={yZero} stroke="var(--color-border)" strokeWidth={1} />
      {series.map((p, i) => {
        const x = barGap + i * (barWidth + barGap);
        const yTop = Math.min(yFor(p.projectedTrulyAvailable), yZero);
        const barHeight = Math.max(2, Math.abs(yFor(p.projectedTrulyAvailable) - yZero));
        const negative = p.projectedTrulyAvailable < 0;
        const isCallout = i === shortfallIndex || i === series.length - 1;
        return (
          <g key={p.asOf}>
            <rect
              x={x}
              y={yTop}
              width={barWidth}
              height={barHeight}
              rx={4}
              fill={negative ? 'var(--color-accent-red)' : 'var(--color-accent-green)'}
            />
            {isCallout && (
              <text
                x={x + barWidth / 2}
                y={negative ? yTop + barHeight + 12 : yTop - 6}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill={negative ? 'var(--color-accent-red)' : 'var(--color-text)'}
              >
                {formatCurrency(p.projectedTrulyAvailable)}
              </text>
            )}
            <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--color-accent-blue)">
              {p.monthLabel.split(' ')[0].slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Projections() {
  const [projections, setProjections] = useState<IncomeProjection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [series, setSeries] = useState<ProjectionSeriesPoint[]>([]);
  const [todaySpendable, setTodaySpendable] = useState<number | null>(null);
  const [horizonMonths, setHorizonMonths] = useState(6);
  const [loading, setLoading] = useState(true);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<ProjectionFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [lastDayOfMonth, setLastDayOfMonth] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadSeries(horizonMonths, excludedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonMonths, projections, excludedIds]);

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
    setExcludedIds((prev) => {
      const validIds = new Set(list.map((p) => p.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }

  async function loadSeries(months: number, excluded: Set<string>) {
    const result = await window.electronAPI.projections.getSeries(months, [...excluded]);
    setSeries(result);
  }

  function toggleIncluded(id: string, included: boolean) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (included) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
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
    setLastDayOfMonth(false);
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
    setLastDayOfMonth(projection.lastDayOfMonth);
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
        lastDayOfMonth: frequency === 'monthly' && lastDayOfMonth,
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
  const shortfallPoint = series.find((p) => p.projectedTrulyAvailable < 0) ?? null;

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
          <>
            <div style={{ padding: '4px 16px 0' }}>
              <ShortfallChart series={series} />
              {shortfallPoint ? (
                <p className="amount-negative" style={{ fontSize: 13, fontWeight: 600, margin: '4px 0 0' }}>
                  ⚠ Projected to run short around {shortfallPoint.monthLabel} ({formatCurrency(shortfallPoint.projectedTrulyAvailable)})
                </p>
              ) : (
                <p className="amount-positive" style={{ fontSize: 13, fontWeight: 600, margin: '4px 0 0' }}>
                  ✓ No shortfall projected in the next {horizonMonths} months
                </p>
              )}
              <p className="text-muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                Assumes {formatCurrency(Math.abs(series[0]?.monthlyBurnRate ?? 0))}/mo ordinary spending (trailing{' '}
                {BURN_LOOKBACK_MONTHS}-month average, excluding accounts held back for an active Obligation) and
                Obligations paid in full on their due date.
              </p>
            </div>
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Projected Spendable</th>
                  <th style={{ textAlign: 'right' }}>Still Obligated</th>
                  <th style={{ textAlign: 'right' }}>Projected Truly Available</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.asOf}>
                    <td>{point.monthLabel}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(point.projectedSpendableBalance)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(point.obligationsStillOutstanding)}</td>
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
          </>
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
                <th>Include</th>
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
                  <td>
                    <input
                      type="checkbox"
                      checked={!excludedIds.has(p.id)}
                      onChange={(e) => toggleIncluded(p.id, e.target.checked)}
                      title="Include in projections"
                    />
                  </td>
                  <td>{p.label}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(p.amount)}</td>
                  <td>
                    {FREQUENCY_LABELS[p.frequency]}
                    {p.frequency === 'monthly' && p.lastDayOfMonth ? ' (last day)' : ''}
                  </td>
                  <td>{formatDate(p.startDate)}</td>
                  <td>{p.endDate ? formatDate(p.endDate) : '—'}</td>
                  <td>{accountName(p.accountId) ?? '—'}</td>
                  <td>
                    <div className="ledger-actions">
                      <button className="btn-link" onClick={() => startEdit(p)}>
                        Edit
                      </button>
                      <button className="btn-link btn-link-danger" onClick={() => handleDelete(p.id)}>
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
                {frequency === 'monthly' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={lastDayOfMonth}
                      onChange={(e) => setLastDayOfMonth(e.target.checked)}
                    />
                    Always land on the last day of the month
                  </label>
                )}
                {frequency === 'monthly' && lastDayOfMonth && (
                  <p className="text-muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
                    The day above only picks the starting month -- each occurrence lands on that
                    month's actual last day (28-31).
                  </p>
                )}
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
