import { useState } from 'react';
import { Account } from '../../shared/types/account';
import { CreateTransactionInput, Transaction } from '../../shared/types/transaction';
import { Reserve } from '../../shared/types/reserve';
import { todayIso, formatCurrency } from '../utils/format';

interface Props {
  transaction?: Transaction;
  accounts: Account[];
  reserves: Reserve[];
  defaultDate?: string;
  onSave: (input: CreateTransactionInput) => void;
  onCancel: () => void;
}

export default function TransactionForm({ transaction, accounts, reserves, defaultDate, onSave, onCancel }: Props) {
  const [date, setDate] = useState(transaction?.date ?? defaultDate ?? todayIso());
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [accountId, setAccountId] = useState(transaction?.accountId ?? '');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [memo, setMemo] = useState(transaction?.memo ?? '');
  const [reserveId, setReserveId] = useState(transaction?.reserveId ?? '');

  const parsedAmount = parseFloat(amount);
  const isValid = date.trim() !== '' && description.trim() !== '' && amount.trim() !== '' && !isNaN(parsedAmount);

  function handleAccountChange(newAccountId: string) {
    setAccountId(newAccountId);
    // Adding a new transaction (not editing one) on an account that has an auto-allocate
    // reserve linked to it -- suggest that reserve, but leave it fully overridable below.
    if (!transaction && !reserveId) {
      const match = reserves.find((r) => r.accountId === newAccountId && r.autoAllocate);
      if (match) setReserveId(match.id);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{transaction ? 'Edit Transaction' : 'Add Transaction'}</h2>
        <div className="grid-2">
          <div className="field">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Amount</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="-44.16"
            />
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Account</label>
          <select value={accountId ?? ''} onChange={(e) => handleAccountChange(e.target.value)}>
            <option value="">(none)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.friendlyName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Allocate to Reserve (optional)</label>
          <select value={reserveId ?? ''} onChange={(e) => setReserveId(e.target.value)}>
            <option value="">(none)</option>
            {reserves.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {formatCurrency(r.remaining)} remaining
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Memo (optional)</label>
          <input value={memo ?? ''} onChange={(e) => setMemo(e.target.value)} />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!isValid}
            onClick={() =>
              onSave({
                date,
                description: description.trim(),
                accountId: accountId || null,
                amount: parsedAmount,
                memo: memo.trim() || null,
                reserveId: reserveId || null,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
