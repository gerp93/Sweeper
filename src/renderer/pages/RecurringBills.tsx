import { useEffect, useState } from 'react';
import { RecurringBill, RecurringBillAmountMode, RecurringBillOccurrence } from '../../shared/types/recurringBill';
import { ProjectionFrequency } from '../../shared/types/projection';
import { Account } from '../../shared/types/account';
import { Transaction } from '../../shared/types/transaction';
import CurrencyInput from '../components/CurrencyInput';
import SuggestedRecurringBills from '../components/SuggestedRecurringBills';
import { formatCurrency, formatDate, todayIso, monthKey, firstDayOfMonth, lastDayOfMonth } from '../utils/format';

const FREQUENCY_LABELS: Record<ProjectionFrequency, string> = {
  once: 'One-time',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

export default function RecurringBills() {
  const [bills, setBills] = useState<RecurringBill[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [thisMonthOccurrences, setThisMonthOccurrences] = useState<RecurringBillOccurrence[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amountMode, setAmountMode] = useState<RecurringBillAmountMode>('fixed');
  const [fixedAmount, setFixedAmount] = useState('');
  const [frequency, setFrequency] = useState<ProjectionFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayIso());
  const [lastDayOfMonthFlag, setLastDayOfMonthFlag] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const thisMonth = monthKey(todayIso());
    const [billList, accts, txs, occurrences] = await Promise.all([
      window.electronAPI.recurringBills.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.transactions.getAll(),
      window.electronAPI.recurringBills.getMonthlyOccurrences(firstDayOfMonth(thisMonth), lastDayOfMonth(thisMonth)),
    ]);
    setBills(billList);
    setAccounts(accts);
    setTransactions(txs);
    setThisMonthOccurrences(occurrences);
    setLoading(false);
  }

  function accountName(id: string | null) {
    if (!id) return null;
    return accounts.find((a) => a.id === id)?.friendlyName ?? null;
  }

  // Best-effort resolved amount for display: the current month's expected occurrence for this
  // bill, if there is one. An auto-average bill with no occurrence this month (or no confirmed
  // history yet) shows a muted placeholder instead of a misleading $0.00.
  function resolvedAmountDisplay(bill: RecurringBill): string {
    if (bill.amountMode === 'fixed') return formatCurrency(bill.fixedAmount ?? 0);
    const occ = thisMonthOccurrences.find((o) => o.billId === bill.id);
    if (!occ || occ.expectedAmount === 0) return 'no confirmed history yet';
    return `~${formatCurrency(occ.expectedAmount)} (avg)`;
  }

  function resetForm() {
    setModalOpen(false);
    setEditingId(null);
    setLabel('');
    setAmountMode('fixed');
    setFixedAmount('');
    setFrequency('monthly');
    setStartDate(todayIso());
    setLastDayOfMonthFlag(false);
    setEndDate('');
    setAccountId('');
    setNote('');
    setActive(true);
    setError(null);
  }

  function startAdd() {
    resetForm();
    setModalOpen(true);
  }

  function startEdit(bill: RecurringBill) {
    setModalOpen(true);
    setEditingId(bill.id);
    setLabel(bill.label);
    setAmountMode(bill.amountMode);
    setFixedAmount(bill.fixedAmount != null ? String(Math.abs(bill.fixedAmount)) : '');
    setFrequency(bill.frequency);
    setStartDate(bill.startDate);
    setLastDayOfMonthFlag(bill.lastDayOfMonth);
    setEndDate(bill.endDate ?? '');
    setAccountId(bill.accountId ?? '');
    setNote(bill.note ?? '');
    setActive(bill.active);
    setError(null);
  }

  const parsedFixedAmount = parseFloat(fixedAmount);
  const canSave =
    label.trim() !== '' &&
    startDate.trim() !== '' &&
    !saving &&
    (amountMode === 'auto-average' || (fixedAmount.trim() !== '' && !isNaN(parsedFixedAmount) && parsedFixedAmount > 0));

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = {
        label: label.trim(),
        amountMode,
        fixedAmount: amountMode === 'fixed' ? -Math.abs(parsedFixedAmount) : null,
        frequency,
        startDate,
        lastDayOfMonth: frequency === 'monthly' && lastDayOfMonthFlag,
        endDate: frequency === 'once' ? null : endDate || null,
        accountId: accountId || null,
        note: note.trim() || null,
        active,
      };
      if (editingId) {
        await window.electronAPI.recurringBills.update(editingId, input);
      } else {
        await window.electronAPI.recurringBills.create(input);
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
    if (!confirm('Delete this Recurring Bill? Any transactions already confirmed against it stay, but lose the link.')) return;
    await window.electronAPI.recurringBills.delete(id);
    await load();
  }

  return (
    <div>
      <div className="page-header">
        <h1>Recurring Bills</h1>
        <button className="btn btn-primary" onClick={startAdd}>
          + New Recurring Bill
        </button>
      </div>

      <p className="text-muted" style={{ marginTop: -8, fontSize: 13, maxWidth: 720 }}>
        Pencil in bills you expect to pay — utilities, subscriptions, loan payments — to see a forward-looking
        reminder in your ledger and, once confirmed against a real import, an itemized alternative to the flat
        spending average in Projections. Nothing here is ever a real transaction until you confirm one against it.
      </p>

      <SuggestedRecurringBills
        accounts={accounts}
        transactions={transactions}
        recurringBills={bills}
        onPromoted={load}
      />

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : bills.length === 0 ? (
          <div className="empty-state">No Recurring Bills yet.</div>
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
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td style={{ textAlign: 'right' }} className={b.amountMode === 'auto-average' ? 'text-muted' : undefined}>
                    {resolvedAmountDisplay(b)}
                  </td>
                  <td>
                    {FREQUENCY_LABELS[b.frequency]}
                    {b.frequency === 'monthly' && b.lastDayOfMonth ? ' (last day)' : ''}
                  </td>
                  <td>{formatDate(b.startDate)}</td>
                  <td>{b.endDate ? formatDate(b.endDate) : '—'}</td>
                  <td>{accountName(b.accountId) ?? '—'}</td>
                  <td>{b.active ? 'Yes' : 'Paused'}</td>
                  <td>
                    <div className="ledger-actions">
                      <button className="btn-link" onClick={() => startEdit(b)}>
                        Edit
                      </button>
                      <button className="btn-link btn-link-danger" onClick={() => handleDelete(b.id)}>
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
            <h2>{editingId ? 'Edit Recurring Bill' : 'New Recurring Bill'}</h2>

            <div className="field">
              <label>Label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Xcel Energy" autoFocus />
            </div>

            <div className="field">
              <label>Amount</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13 }}>
                  <input
                    type="radio"
                    name="amountMode"
                    checked={amountMode === 'fixed'}
                    onChange={() => setAmountMode('fixed')}
                  />
                  Fixed amount
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, fontSize: 13 }}>
                  <input
                    type="radio"
                    name="amountMode"
                    checked={amountMode === 'auto-average'}
                    onChange={() => setAmountMode('auto-average')}
                  />
                  Auto-average my confirmed history
                </label>
              </div>
              {amountMode === 'fixed' ? (
                <CurrencyInput value={fixedAmount} onChange={setFixedAmount} placeholder="e.g. $70.00" />
              ) : (
                <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                  Averages the last few real transactions you've confirmed against this bill. Shows "no confirmed
                  history yet" until you've confirmed at least one — never a guessed number.
                </p>
              )}
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Frequency</label>
                <select
                  value={frequency}
                  onChange={(e) => {
                    const next = e.target.value as ProjectionFrequency;
                    setFrequency(next);
                    if (next === 'once') setEndDate('');
                  }}
                >
                  {Object.entries(FREQUENCY_LABELS).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Linked Account</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  <option value="">(none)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.friendlyName}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {!accountId && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: -8 }}>
                Without a linked account, this bill won't get import-time match suggestions or auto-average history.
              </p>
            )}

            <div className="grid-2">
              <div className="field">
                <label>Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                {frequency === 'monthly' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={lastDayOfMonthFlag}
                      onChange={(e) => setLastDayOfMonthFlag(e.target.checked)}
                    />
                    Always land on the last day of the month
                  </label>
                )}
              </div>
              <div className="field">
                {frequency === 'once' ? (
                  <>
                    <label>End Date</label>
                    <p className="text-muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
                      Not applicable — a one-time bill only occurs on its Start Date.
                    </p>
                  </>
                ) : (
                  <>
                    <label>End Date (optional)</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </>
                )}
              </div>
            </div>

            <div className="field">
              <label>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. account #12345" />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 12 }}>
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
              Active — paused bills stop showing reminders or counting toward Projections
            </label>

            {error && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>}

            <div className="modal-actions">
              <button className="btn" onClick={resetForm}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Recurring Bill'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
