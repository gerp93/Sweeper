import { useState } from 'react';
import { Account } from '../../shared/types/account';
import { CreateTransactionInput, Transaction } from '../../shared/types/transaction';
import { Obligation } from '../../shared/types/obligation';
import { RecurringBill } from '../../shared/types/recurringBill';
import { todayIso, formatCurrency } from '../utils/format';

interface Props {
  transaction?: Transaction;
  accounts: Account[];
  obligations: Obligation[];
  recurringBills: RecurringBill[];
  defaultDate?: string;
  // Prefill for a brand-new transaction (e.g. confirming a Recurring Bill's expected
  // occurrence). Ignored when `transaction` is set (editing an existing real transaction).
  defaultValues?: {
    description?: string;
    accountId?: string | null;
    amount?: number;
    recurringBillId?: string | null;
  };
  onSave: (input: CreateTransactionInput) => void;
  onCancel: () => void;
}

export default function TransactionForm({
  transaction,
  accounts,
  obligations,
  recurringBills,
  defaultDate,
  defaultValues,
  onSave,
  onCancel,
}: Props) {
  const [date, setDate] = useState(transaction?.date ?? defaultDate ?? todayIso());
  const [description, setDescription] = useState(transaction?.description ?? defaultValues?.description ?? '');
  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaultValues?.accountId ?? '');
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : defaultValues?.amount != null ? String(defaultValues.amount) : ''
  );
  const [memo, setMemo] = useState(transaction?.memo ?? '');
  const [obligationId, setObligationId] = useState(transaction?.obligationId ?? '');
  const [recurringBillId, setRecurringBillId] = useState(
    transaction?.recurringBillId ?? defaultValues?.recurringBillId ?? ''
  );

  const parsedAmount = parseFloat(amount);
  const isValid = date.trim() !== '' && description.trim() !== '' && amount.trim() !== '' && !isNaN(parsedAmount);

  function handleAccountChange(newAccountId: string) {
    setAccountId(newAccountId);
    // Adding a new transaction (not editing one) on an account that has an auto-allocate
    // obligation linked to it -- suggest that obligation, but leave it fully overridable below.
    if (!transaction && !obligationId) {
      const match = obligations.find((o) => o.accountId === newAccountId && o.autoAllocate);
      if (match) setObligationId(match.id);
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
          <label>Allocate to Obligation (optional)</label>
          <select value={obligationId ?? ''} onChange={(e) => setObligationId(e.target.value)}>
            <option value="">(none)</option>
            {obligations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} — {formatCurrency(o.remaining)} remaining
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Memo (optional)</label>
          <input value={memo ?? ''} onChange={(e) => setMemo(e.target.value)} />
        </div>
        <div className="field">
          <label>Recurring Bill (optional)</label>
          <select value={recurringBillId ?? ''} onChange={(e) => setRecurringBillId(e.target.value)}>
            <option value="">(none)</option>
            {recurringBills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          {transaction?.recurringBillId && (
            <p className="text-muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              Set to "(none)" to unlink this transaction from the Recurring Bill it's currently confirmed against.
            </p>
          )}
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
                obligationId: obligationId || null,
                recurringBillId: recurringBillId || null,
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
