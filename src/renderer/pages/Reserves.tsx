import { useEffect, useState } from 'react';
import { Reserve, ReserveLineItem } from '../../shared/types/reserve';
import { Account } from '../../shared/types/account';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import CurrencyInput from '../components/CurrencyInput';
import { formatCurrency, formatDate, todayIso } from '../utils/format';

export default function Reserves() {
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [spendable, setSpendable] = useState<SpendableBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reserve-level fields (label/note/account/auto-allocate). Amount and target date now
  // live on line items -- only the "new reserve" form collects a starter one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [autoAllocate, setAutoAllocate] = useState(false);
  const [firstAmount, setFirstAmount] = useState('');
  const [firstTargetDate, setFirstTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add/edit line item mini-form, scoped to whichever reserve is expanded.
  const [liEditingId, setLiEditingId] = useState<string | null>(null);
  const [liFormOpen, setLiFormOpen] = useState(false);
  const [liLabel, setLiLabel] = useState('');
  const [liAmount, setLiAmount] = useState('');
  const [liTargetDate, setLiTargetDate] = useState('');
  const [liSaving, setLiSaving] = useState(false);
  const [liError, setLiError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [list, accts, balance] = await Promise.all([
      window.electronAPI.reserves.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.balance.getSpendable(),
    ]);
    setReserves(list);
    setAccounts(accts);
    setSpendable(balance);
    setLoading(false);
  }

  function resetForm() {
    setEditingId(null);
    setLabel('');
    setNote('');
    setAccountId('');
    setAutoAllocate(false);
    setFirstAmount('');
    setFirstTargetDate('');
    setError(null);
  }

  function startEdit(reserve: Reserve) {
    setEditingId(reserve.id);
    setLabel(reserve.label);
    setNote(reserve.note ?? '');
    setAccountId(reserve.accountId ?? '');
    setAutoAllocate(reserve.autoAllocate);
    setError(null);
  }

  const parsedFirstAmount = parseFloat(firstAmount);
  const firstAmountValid = editingId != null || (firstAmount.trim() !== '' && !isNaN(parsedFirstAmount) && parsedFirstAmount > 0);
  const canSave = label.trim() !== '' && firstAmountValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await window.electronAPI.reserves.update(editingId, {
          label: label.trim(),
          note: note.trim() || null,
          accountId: accountId || null,
          autoAllocate: accountId ? autoAllocate : false,
        });
      } else {
        await window.electronAPI.reserves.create({
          label: label.trim(),
          note: note.trim() || null,
          accountId: accountId || null,
          autoAllocate: accountId ? autoAllocate : false,
          lineItems: [{ amount: parsedFirstAmount, targetDate: firstTargetDate || null }],
        });
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
    if (!confirm('Delete this reserve and all its line items? Any transactions allocated to it are unaffected.'))
      return;
    await window.electronAPI.reserves.delete(id);
    if (editingId === id) resetForm();
    if (expandedId === id) setExpandedId(null);
    await load();
  }

  function accountName(id: string | null) {
    if (!id) return null;
    return accounts.find((a) => a.id === id)?.friendlyName ?? null;
  }

  function toggleExpand(reserveId: string) {
    setExpandedId((prev) => (prev === reserveId ? null : reserveId));
    closeLiForm();
  }

  function closeLiForm() {
    setLiFormOpen(false);
    setLiEditingId(null);
    setLiLabel('');
    setLiAmount('');
    setLiTargetDate('');
    setLiError(null);
  }

  function openAddLineItem(reserveId: string) {
    setExpandedId(reserveId);
    setLiFormOpen(true);
    setLiEditingId(null);
    setLiLabel('');
    setLiAmount('');
    setLiTargetDate('');
    setLiError(null);
  }

  function openEditLineItem(reserveId: string, item: ReserveLineItem) {
    setExpandedId(reserveId);
    setLiFormOpen(true);
    setLiEditingId(item.id);
    setLiLabel(item.label ?? '');
    setLiAmount(String(item.amount));
    setLiTargetDate(item.targetDate ?? '');
    setLiError(null);
  }

  const parsedLiAmount = parseFloat(liAmount);
  const liAmountValid = liAmount.trim() !== '' && !isNaN(parsedLiAmount) && parsedLiAmount > 0;

  async function saveLineItem(reserveId: string) {
    if (!liAmountValid) return;
    setLiSaving(true);
    setLiError(null);
    try {
      const input = {
        label: liLabel.trim() || null,
        amount: parsedLiAmount,
        targetDate: liTargetDate || null,
      };
      if (liEditingId) {
        await window.electronAPI.reserveLineItems.update(liEditingId, input);
      } else {
        await window.electronAPI.reserveLineItems.create(reserveId, input);
      }
      closeLiForm();
      await load();
    } catch (err) {
      setLiError(err instanceof Error ? err.message : String(err));
    } finally {
      setLiSaving(false);
    }
  }

  async function deleteLineItem(id: string) {
    if (!confirm('Delete this line item?')) return;
    await window.electronAPI.reserveLineItems.delete(id);
    if (liEditingId === id) closeLiForm();
    await load();
  }

  async function moveLineItem(id: string, direction: 'up' | 'down') {
    await window.electronAPI.reserveLineItems.move(id, direction);
    await load();
  }

  const today = todayIso();
  const totalReserved = reserves.reduce((sum, r) => sum + r.remaining, 0);
  const trulyAvailable = spendable ? spendable.balance - totalReserved : null;

  return (
    <div>
      <div className="page-header">
        <h1>Reserves</h1>
      </div>

      <p className="text-muted" style={{ marginTop: -8, fontSize: 13, maxWidth: 720 }}>
        Reserves are dollars inside your HELOC spendable balance that are already spoken for — set aside on paper
        for future payments, like deferred-interest balances coming due — so they don't get swept up in everyday
        spending. A reserve can hold several target amounts (say, three same-day store-card purchases that each
        carry their own promo payoff date) — amounts due the same date are shown combined. When a payment is
        allocated to the reserve, it pays down whichever target is first in line, in the order you set below.
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
              placeholder="e.g. Best Buy promo balances"
            />
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. store card, 0% promo" />
          </div>
        </div>

        {!editingId && (
          <div className="grid-2">
            <div className="field">
              <label>First Target Amount</label>
              <CurrencyInput value={firstAmount} onChange={setFirstAmount} placeholder="e.g. $1,200.00" />
            </div>
            <div className="field">
              <label>First Target Date (optional)</label>
              <input type="date" value={firstTargetDate} onChange={(e) => setFirstTargetDate(e.target.value)} />
            </div>
          </div>
        )}
        {!editingId && (
          <p className="text-muted" style={{ fontSize: 12, marginTop: -8 }}>
            You can add more target amounts (with their own dates) after creating the reserve.
          </p>
        )}

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
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={autoAllocate}
              disabled={!accountId}
              onChange={(e) => setAutoAllocate(e.target.checked)}
            />
            Auto-allocate future transactions on this account to this reserve
          </label>
          {!accountId && (
            <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Link an account above to enable this — new transactions on that account (manual or imported) will be
              suggested or auto-assigned to this reserve.
            </p>
          )}
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

      {loading ? (
        <div className="card empty-state">Loading…</div>
      ) : reserves.length === 0 ? (
        <div className="card empty-state">No reserves set aside yet.</div>
      ) : (
        reserves.map((r) => {
          const overdue = r.dateGroups.some((g) => g.targetDate != null && g.targetDate < today && g.remaining > 0);
          const fulfilled = r.remaining <= 0;
          const linkedAccountName = accountName(r.accountId);
          const expanded = expandedId === r.id;

          return (
            <div className="card" key={r.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {r.label}
                    {fulfilled && (
                      <span className="pill pill-included" style={{ marginLeft: 8 }}>
                        Fulfilled
                      </span>
                    )}
                    {overdue && !fulfilled && (
                      <span className="pill pill-collision" style={{ marginLeft: 8 }}>
                        Past due
                      </span>
                    )}
                  </div>
                  <div className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>
                    {linkedAccountName ? `Linked to ${linkedAccountName}` : 'No linked account'}
                    {linkedAccountName && r.autoAllocate && (
                      <span className="pill pill-included" style={{ marginLeft: 6 }}>
                        Auto
                      </span>
                    )}
                    {r.note && <> · {r.note}</>}
                  </div>
                </div>
                <div className="stat-row" style={{ margin: 0 }}>
                  <div className="card" style={{ padding: '8px 16px' }}>
                    <div className="stat-label">Target</div>
                    <div className="stat-value" style={{ fontSize: 18 }}>
                      {formatCurrency(r.amount)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '8px 16px' }}>
                    <div className="stat-label">Allocated</div>
                    <div className="stat-value" style={{ fontSize: 18 }}>
                      {formatCurrency(r.allocated)}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '8px 16px' }}>
                    <div className="stat-label">Remaining</div>
                    <div className={`stat-value ${fulfilled ? 'amount-positive' : ''}`} style={{ fontSize: 18 }}>
                      {formatCurrency(r.remaining)}
                    </div>
                  </div>
                </div>
                <div className="ledger-actions">
                  <button className="btn-link" onClick={() => startEdit(r)}>
                    Edit
                  </button>
                  <button className="btn-link btn-link-danger" onClick={() => handleDelete(r.id)}>
                    Delete
                  </button>
                </div>
              </div>

              <table className="data-table" style={{ marginTop: 12 }}>
                <thead>
                  <tr>
                    <th>Target Date</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                    <th style={{ textAlign: 'right' }}>Allocated</th>
                    <th style={{ textAlign: 'right' }}>Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {r.dateGroups.map((g) => {
                    const groupOverdue = g.targetDate != null && g.targetDate < today && g.remaining > 0;
                    return (
                      <tr key={g.targetDate ?? '__none__'}>
                        <td className={groupOverdue ? 'amount-negative' : undefined}>
                          {g.targetDate ? formatDate(g.targetDate) : 'No date'}
                          {groupOverdue ? ' (past due)' : ''}
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(g.amount)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(g.allocated)}</td>
                        <td style={{ textAlign: 'right' }} className={g.remaining <= 0 ? 'amount-positive' : undefined}>
                          {formatCurrency(g.remaining)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <button className="btn-link" style={{ marginTop: 8 }} onClick={() => toggleExpand(r.id)}>
                {expanded ? 'Hide line items ▲' : `Manage line items (${r.lineItems.length}) ▾`}
              </button>

              {expanded && (
                <div style={{ marginTop: 8 }}>
                  <p className="text-muted" style={{ fontSize: 12 }}>
                    Order here is the payoff order — an allocated payment fully satisfies the first item before
                    spilling into the next. Use ↑/↓ to change precedence.
                  </p>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th></th>
                        <th>Label</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ textAlign: 'right' }}>Remaining</th>
                        <th>Target Date</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.lineItems.map((item, idx) => (
                        <tr key={item.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button
                              className="btn-link"
                              disabled={idx === 0}
                              onClick={() => moveLineItem(item.id, 'up')}
                              title="Move up (pay off sooner)"
                            >
                              ↑
                            </button>
                            <button
                              className="btn-link"
                              disabled={idx === r.lineItems.length - 1}
                              onClick={() => moveLineItem(item.id, 'down')}
                              title="Move down (pay off later)"
                            >
                              ↓
                            </button>
                          </td>
                          <td>{item.label ?? '—'}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(item.amount)}</td>
                          <td style={{ textAlign: 'right' }} className={item.remaining <= 0 ? 'amount-positive' : undefined}>
                            {formatCurrency(item.remaining)}
                          </td>
                          <td>{item.targetDate ? formatDate(item.targetDate) : '—'}</td>
                          <td className="ledger-actions">
                            <button className="btn-link" onClick={() => openEditLineItem(r.id, item)}>
                              Edit
                            </button>
                            <button className="btn-link btn-link-danger" onClick={() => deleteLineItem(item.id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {liFormOpen ? (
                    <div className="field" style={{ marginTop: 8 }}>
                      <div className="grid-2">
                        <div className="field">
                          <label>Label (optional)</label>
                          <input value={liLabel} onChange={(e) => setLiLabel(e.target.value)} placeholder="e.g. TV" />
                        </div>
                        <div className="field">
                          <label>Amount</label>
                          <CurrencyInput value={liAmount} onChange={setLiAmount} placeholder="e.g. $450.00" />
                        </div>
                      </div>
                      <div className="field">
                        <label>Target Date (optional)</label>
                        <input type="date" value={liTargetDate} onChange={(e) => setLiTargetDate(e.target.value)} />
                      </div>
                      {liError && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{liError}</p>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-primary"
                          disabled={!liAmountValid || liSaving}
                          onClick={() => saveLineItem(r.id)}
                        >
                          {liSaving ? 'Saving…' : liEditingId ? 'Save Line Item' : 'Add Line Item'}
                        </button>
                        <button className="btn" onClick={closeLiForm}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="btn" style={{ marginTop: 8 }} onClick={() => openAddLineItem(r.id)}>
                      + Add Target Amount
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
