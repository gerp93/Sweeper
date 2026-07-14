import { useState } from 'react';
import { Account } from '../../shared/types/account';
import { CreateTransactionInput, Transaction } from '../../shared/types/transaction';
import { todayIso } from '../utils/format';

interface Props {
  transaction?: Transaction;
  accounts: Account[];
  defaultDate?: string;
  onSave: (input: CreateTransactionInput) => void;
  onCancel: () => void;
}

export default function TransactionForm({ transaction, accounts, defaultDate, onSave, onCancel }: Props) {
  const [date, setDate] = useState(transaction?.date ?? defaultDate ?? todayIso());
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [accountId, setAccountId] = useState(transaction?.accountId ?? '');
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [memo, setMemo] = useState(transaction?.memo ?? '');

  const parsedAmount = parseFloat(amount);
  const isValid = date.trim() !== '' && description.trim() !== '' && amount.trim() !== '' && !isNaN(parsedAmount);

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
          <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">(none)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.friendlyName}
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
