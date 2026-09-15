import { useEffect, useMemo, useState } from 'react';
import { Account } from '../../shared/types/account';
import { Transaction } from '../../shared/types/transaction';
import { RecurringBill } from '../../shared/types/recurringBill';
import { findRecurringBillCandidates, RecurringBillCandidate } from '../utils/recurrenceSimilarity';
import { formatCurrency, formatDate } from '../utils/format';

interface Props {
  accounts: Account[];
  transactions: Transaction[];
  recurringBills: RecurringBill[];
  onPromoted: () => void;
}

const DISMISSED_STORAGE_KEY = 'sweeper.dismissedRecurringBillCandidates';

function candidateKey(c: RecurringBillCandidate): string {
  const earliest = c.transactions[c.transactions.length - 1];
  return `${c.accountId}|${c.medianAmount.toFixed(2)}|${c.suggestedFrequency}|${earliest.date}`;
}

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(dismissed: Set<string>) {
  localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(Array.from(dismissed)));
}

export default function SuggestedRecurringBills({ accounts, transactions, recurringBills, onPromoted }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [promoting, setPromoting] = useState<string | null>(null);
  const [labelByCandidate, setLabelByCandidate] = useState<Record<string, string>>({});

  useEffect(() => {
    saveDismissed(dismissed);
  }, [dismissed]);

  function accountName(id: string) {
    return accounts.find((a) => a.id === id)?.friendlyName ?? '(unknown account)';
  }

  const candidates = useMemo(
    () => findRecurringBillCandidates(transactions, recurringBills),
    [transactions, recurringBills]
  );
  const visibleCandidates = candidates.filter((c) => !dismissed.has(candidateKey(c)));

  function labelFor(c: RecurringBillCandidate): string {
    return labelByCandidate[candidateKey(c)] ?? accountName(c.accountId);
  }

  function setLabel(c: RecurringBillCandidate, label: string) {
    setLabelByCandidate((prev) => ({ ...prev, [candidateKey(c)]: label }));
  }

  function dismiss(c: RecurringBillCandidate) {
    setDismissed((prev) => new Set(prev).add(candidateKey(c)));
  }

  function rerun() {
    setDismissed(new Set());
  }

  async function promote(c: RecurringBillCandidate) {
    const key = candidateKey(c);
    setPromoting(key);
    try {
      await window.electronAPI.recurringBills.create({
        label: labelFor(c).trim() || accountName(c.accountId),
        amountMode: 'fixed',
        fixedAmount: c.medianAmount,
        frequency: c.suggestedFrequency,
        startDate: c.suggestedStartDate,
        accountId: c.accountId,
      });
      setDismissed((prev) => new Set(prev).add(key));
      onPromoted();
    } finally {
      setPromoting(null);
    }
  }

  if (candidates.length === 0) return null;

  if (visibleCandidates.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="text-muted" style={{ fontSize: 13 }}>
            All {candidates.length} suggested recurring bill{candidates.length === 1 ? '' : 's'} reviewed.
          </span>
          <button className="btn" onClick={rerun}>
            Rerun Suggestions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Suggested Recurring Bills ({visibleCandidates.length})</h2>
        <button className="btn" onClick={rerun}>
          Rerun Suggestions
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: -4, fontSize: 13 }}>
        These accounts show a consistent pattern of similar-amount charges landing on a regular cadence — they look
        like recurring bills you haven't pencilled in yet. Review each one, adjust the label if you want, then add
        it as a Recurring Bill so it shows up as a reminder in your ledger.
      </p>

      {visibleCandidates.map((c) => {
        const key = candidateKey(c);
        return (
          <div
            key={key}
            style={{ border: '1px solid var(--color-primary-action-hover)', borderRadius: 8, padding: 12, marginBottom: 10 }}
          >
            <div style={{ fontSize: 12, color: 'var(--color-accent-blue)', marginBottom: 8 }}>
              {accountName(c.accountId)} · {c.transactions.length} occurrences · ~{formatCurrency(c.medianAmount)} every ~
              {Math.round(c.medianIntervalDays)} days ({c.suggestedFrequency})
            </div>
            <input
              value={labelFor(c)}
              onChange={(e) => setLabel(c, e.target.value)}
              style={{ marginBottom: 8, width: '100%' }}
              placeholder="Label for this bill"
            />
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Recent: {c.transactions.slice(0, 3).map((t) => `${formatDate(t.date)} (${formatCurrency(t.amount)})`).join(', ')}
            </div>
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => dismiss(c)} disabled={promoting === key}>
                Not recurring
              </button>
              <button className="btn btn-primary" onClick={() => promote(c)} disabled={promoting === key}>
                {promoting === key ? 'Adding…' : 'Add as Recurring Bill'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
