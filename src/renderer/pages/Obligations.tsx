import { useEffect, useState } from 'react';
import { Obligation, ObligationLineItem } from '../../shared/types/obligation';
import { Account } from '../../shared/types/account';
import { SpendableBalance } from '../../shared/types/balanceAnchor';
import CurrencyInput from '../components/CurrencyInput';
import { formatCurrency, formatDate, todayIso } from '../utils/format';

function daysUntil(targetDate: string, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number);
  const [gy, gm, gd] = targetDate.split('-').map(Number);
  return Math.round((Date.UTC(gy, gm - 1, gd) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

function countdownText(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} past due`;
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function Countdown({ targetDate, remaining, today }: { targetDate: string | null; remaining: number; today: string }) {
  if (!targetDate || remaining <= 0) return null;
  const days = daysUntil(targetDate, today);
  return <span className={days < 0 ? 'amount-negative' : 'text-muted'}>{countdownText(days)}</span>;
}

export default function Obligations() {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [spendable, setSpendable] = useState<SpendableBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Obligation-level fields (label/note/account/auto-allocate). Amount and target date now
  // live on line items -- only the "new obligation" form collects a starter one.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState('');
  const [autoAllocate, setAutoAllocate] = useState(false);
  const [firstAmount, setFirstAmount] = useState('');
  const [firstTargetDate, setFirstTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Read-only "show me the individual amounts" toggle on the page itself -- editing only
  // happens inside the Edit Obligation modal.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Add/edit line item mini-form, shown inside the Edit Obligation modal for whichever
  // obligation is currently being edited.
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
      window.electronAPI.obligations.getAll(),
      window.electronAPI.accounts.getAll(),
      window.electronAPI.balance.getSpendable(),
    ]);
    setObligations(list);
    setAccounts(accts);
    setSpendable(balance);
    setLoading(false);
  }

  function resetForm() {
    setModalOpen(false);
    setEditingId(null);
    setLabel('');
    setNote('');
    setAccountId('');
    setAutoAllocate(false);
    setFirstAmount('');
    setFirstTargetDate('');
    setError(null);
    closeLiForm();
  }

  function startAdd() {
    setModalOpen(true);
    setEditingId(null);
    setLabel('');
    setNote('');
    setAccountId('');
    setAutoAllocate(false);
    setFirstAmount('');
    setFirstTargetDate('');
    setError(null);
  }

  function startEdit(obligation: Obligation) {
    setModalOpen(true);
    setEditingId(obligation.id);
    setLabel(obligation.label);
    setNote(obligation.note ?? '');
    setAccountId(obligation.accountId ?? '');
    setAutoAllocate(obligation.autoAllocate);
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
        await window.electronAPI.obligations.update(editingId, {
          label: label.trim(),
          note: note.trim() || null,
          accountId: accountId || null,
          autoAllocate: accountId ? autoAllocate : false,
        });
      } else {
        await window.electronAPI.obligations.create({
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
    if (!confirm('Delete this obligation and all its line items? Any transactions allocated to it are unaffected.'))
      return;
    await window.electronAPI.obligations.delete(id);
    if (editingId === id) resetForm();
    if (expandedId === id) setExpandedId(null);
    await load();
  }

  function accountName(id: string | null) {
    if (!id) return null;
    return accounts.find((a) => a.id === id)?.friendlyName ?? null;
  }

  function toggleExpand(obligationId: string) {
    setExpandedId((prev) => (prev === obligationId ? null : obligationId));
  }

  function closeLiForm() {
    setLiFormOpen(false);
    setLiEditingId(null);
    setLiLabel('');
    setLiAmount('');
    setLiTargetDate('');
    setLiError(null);
  }

  function openAddLineItem() {
    setLiFormOpen(true);
    setLiEditingId(null);
    setLiLabel('');
    setLiAmount('');
    setLiTargetDate('');
    setLiError(null);
  }

  function openEditLineItem(item: ObligationLineItem) {
    setLiFormOpen(true);
    setLiEditingId(item.id);
    setLiLabel(item.label ?? '');
    setLiAmount(String(item.amount));
    setLiTargetDate(item.targetDate ?? '');
    setLiError(null);
  }

  const parsedLiAmount = parseFloat(liAmount);
  const liAmountValid = liAmount.trim() !== '' && !isNaN(parsedLiAmount) && parsedLiAmount > 0;

  async function saveLineItem() {
    if (!liAmountValid || !editingId) return;
    setLiSaving(true);
    setLiError(null);
    try {
      const input = {
        label: liLabel.trim() || null,
        amount: parsedLiAmount,
        targetDate: liTargetDate || null,
      };
      if (liEditingId) {
        await window.electronAPI.obligationLineItems.update(liEditingId, input);
      } else {
        await window.electronAPI.obligationLineItems.create(editingId, input);
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
    await window.electronAPI.obligationLineItems.delete(id);
    if (liEditingId === id) closeLiForm();
    await load();
  }

  async function moveLineItem(id: string, direction: 'up' | 'down') {
    await window.electronAPI.obligationLineItems.move(id, direction);
    await load();
  }

  const today = todayIso();
  const totalObligated = obligations.reduce((sum, o) => sum + o.remaining, 0);
  const trulyAvailable = spendable ? spendable.balance - totalObligated : null;
  const editingObligation = editingId ? obligations.find((o) => o.id === editingId) ?? null : null;

  return (
    <div>
      <div className="page-header">
        <h1>Obligations</h1>
        <button className="btn btn-primary" onClick={startAdd}>
          + New Obligation
        </button>
      </div>

      <p className="text-muted" style={{ marginTop: -8, fontSize: 13, maxWidth: 720 }}>
        Obligations are dollars inside your HELOC spendable balance that are already spoken for — held back for
        future payments, like deferred-interest balances coming due — so they don't get swept up in everyday
        spending. An obligation can hold several target amounts (say, three same-day store-card purchases that each
        carry their own promo payoff date) — amounts due the same date are shown combined. When a payment is
        allocated to the obligation, it pays down whichever target is first in line, in the order you set in Edit.
      </p>

      <div className="stat-row" style={{ marginTop: 12, marginBottom: 20 }}>
        <div className="card">
          <div className="stat-label">HELOC Spendable Balance</div>
          <div className="stat-value">{spendable ? formatCurrency(spendable.balance) : '—'}</div>
        </div>
        <div className="card">
          <div className="stat-label">Total Obligated</div>
          <div className="stat-value">{formatCurrency(totalObligated)}</div>
        </div>
        <div className="card">
          <div className="stat-label">Truly Available</div>
          <div className={`stat-value ${trulyAvailable != null && trulyAvailable < 0 ? 'amount-negative' : ''}`}>
            {trulyAvailable != null ? formatCurrency(trulyAvailable) : '—'}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card empty-state">Loading…</div>
      ) : obligations.length === 0 ? (
        <div className="card empty-state">No obligations set up yet.</div>
      ) : (
        obligations.map((o) => {
          const overdue = o.dateGroups.some((g) => g.targetDate != null && g.targetDate < today && g.remaining > 0);
          const fulfilled = o.remaining <= 0;
          const linkedAccountName = accountName(o.accountId);
          const expanded = expandedId === o.id;
          const hasMultipleLineItems = o.lineItems.length > 1;

          const singleGroup = o.dateGroups.length === 1 ? o.dateGroups[0] : null;

          return (
            <div className="card" key={o.id} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {o.label}
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
                    {linkedAccountName && o.autoAllocate && (
                      <span className="pill pill-included" style={{ marginLeft: 6 }}>
                        Auto
                      </span>
                    )}
                    {o.note && <> · {o.note}</>}
                  </div>
                </div>
                <div className="ledger-actions">
                  <button className="btn-link" onClick={() => startEdit(o)}>
                    Edit
                  </button>
                  <button className="btn-link btn-link-danger" onClick={() => handleDelete(o.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {singleGroup ? (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <span
                    style={{ fontSize: 22, fontWeight: 700 }}
                    className={fulfilled ? 'amount-positive' : undefined}
                  >
                    {formatCurrency(singleGroup.remaining)}
                  </span>
                  {singleGroup.targetDate && (
                    <span className="text-muted">due {formatDate(singleGroup.targetDate)}</span>
                  )}
                  <Countdown targetDate={singleGroup.targetDate} remaining={singleGroup.remaining} today={today} />
                </div>
              ) : (
                <>
                  <div style={{ marginTop: 10, fontWeight: 600 }}>
                    Total: <span className={fulfilled ? 'amount-positive' : undefined}>{formatCurrency(o.remaining)}</span>
                  </div>
                  <table className="data-table" style={{ marginTop: 8 }}>
                    <thead>
                      <tr>
                        <th>Target Date</th>
                        <th style={{ textAlign: 'right' }}>Target</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.dateGroups.map((g) => {
                        const groupOverdue = g.targetDate != null && g.targetDate < today && g.remaining > 0;
                        return (
                          <tr key={g.targetDate ?? '__none__'}>
                            <td className={groupOverdue ? 'amount-negative' : undefined}>
                              {g.targetDate ? formatDate(g.targetDate) : 'No date'}
                              {groupOverdue ? ' (past due)' : ''}
                            </td>
                            <td style={{ textAlign: 'right' }} className={g.remaining <= 0 ? 'amount-positive' : undefined}>
                              {formatCurrency(g.remaining)}
                            </td>
                            <td>
                              <Countdown targetDate={g.targetDate} remaining={g.remaining} today={today} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}

              {hasMultipleLineItems && (
                <>
                  <button className="btn-link" style={{ marginTop: 8 }} onClick={() => toggleExpand(o.id)}>
                    {expanded ? 'Hide individual amounts ▲' : `Show individual amounts (${o.lineItems.length}) ▾`}
                  </button>

                  {expanded && (
                    <table className="data-table" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Label</th>
                          <th style={{ textAlign: 'right' }}>Target</th>
                          <th>Target Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.lineItems.map((item) => (
                          <tr key={item.id}>
                            <td>{item.label ?? '—'}</td>
                            <td style={{ textAlign: 'right' }} className={item.remaining <= 0 ? 'amount-positive' : undefined}>
                              {formatCurrency(item.remaining)}
                            </td>
                            <td>{item.targetDate ? formatDate(item.targetDate) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          );
        })
      )}

      {modalOpen && (
        <div className="modal-backdrop" onClick={resetForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Obligation' : 'New Obligation'}</h2>

            <div className="field">
              <label>Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Best Buy promo balances"
                autoFocus
              />
            </div>
            <div className="field">
              <label>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. store card, 0% promo" />
            </div>

            {!editingId && (
              <>
                <div className="field">
                  <label>First Target Amount</label>
                  <CurrencyInput value={firstAmount} onChange={setFirstAmount} placeholder="e.g. $1,200.00" />
                </div>
                <div className="field">
                  <label>First Target Date (optional)</label>
                  <input type="date" value={firstTargetDate} onChange={(e) => setFirstTargetDate(e.target.value)} />
                </div>
                <p className="text-muted" style={{ fontSize: 12, marginTop: -8 }}>
                  You can add more target amounts (with their own dates) after creating the obligation.
                </p>
              </>
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
                Auto-allocate future transactions on this account to this obligation
              </label>
              {!accountId && (
                <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Link an account above to enable this — new transactions on that account (manual or imported) will
                  be suggested or auto-assigned to this obligation.
                </p>
              )}
            </div>

            {editingObligation && (
              <div className="field">
                <label>Target Amounts</label>
                <p className="text-muted" style={{ fontSize: 12, marginTop: -4 }}>
                  Order here is the payoff order — an allocated payment fully satisfies the first amount before
                  spilling into the next.
                </p>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Label</th>
                      <th style={{ textAlign: 'right' }}>Target</th>
                      <th>Target Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {editingObligation.lineItems.map((item, idx) => (
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
                            disabled={idx === editingObligation.lineItems.length - 1}
                            onClick={() => moveLineItem(item.id, 'down')}
                            title="Move down (pay off later)"
                          >
                            ↓
                          </button>
                        </td>
                        <td>{item.label ?? '—'}</td>
                        <td style={{ textAlign: 'right' }} className={item.remaining <= 0 ? 'amount-positive' : undefined}>
                          {formatCurrency(item.remaining)}
                        </td>
                        <td>{item.targetDate ? formatDate(item.targetDate) : '—'}</td>
                        <td className="ledger-actions">
                          <button className="btn-link" onClick={() => openEditLineItem(item)}>
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
                  <div style={{ marginTop: 8 }}>
                    <div className="grid-2">
                      <div className="field">
                        <label>Label (optional)</label>
                        <input value={liLabel} onChange={(e) => setLiLabel(e.target.value)} placeholder="e.g. TV" />
                      </div>
                      <div className="field">
                        <label>Target Amount</label>
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
                        onClick={saveLineItem}
                      >
                        {liSaving ? 'Saving…' : liEditingId ? 'Save Target Amount' : 'Add Target Amount'}
                      </button>
                      <button className="btn" onClick={closeLiForm}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn" style={{ marginTop: 8 }} onClick={openAddLineItem}>
                    + Add Target Amount
                  </button>
                )}
              </div>
            )}

            {error && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>}

            <div className="modal-actions">
              <button className="btn" onClick={resetForm}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!canSave} onClick={handleSave}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Obligation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
