import { Transaction } from '../../shared/types/transaction';
import { RecurringBill } from '../../shared/types/recurringBill';
import { Account } from '../../shared/types/account';
import { findRecurringBillCandidates, RecurringBillCandidate } from './recurrenceSimilarity';

const HANDLED_STORAGE_KEY = 'sweeper.autoHandledRecurringBillCandidates';

function candidateKey(c: RecurringBillCandidate): string {
  const earliest = c.transactions[c.transactions.length - 1];
  return `${c.accountId}|${c.amountMode}|${c.suggestedFrequency}|${earliest.date}`;
}

function loadHandled(): Set<string> {
  try {
    const raw = localStorage.getItem(HANDLED_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveHandled(handled: Set<string>) {
  localStorage.setItem(HANDLED_STORAGE_KEY, JSON.stringify(Array.from(handled)));
}

// Forgets every pattern this browser has already auto-created or would otherwise skip, so the
// next sync reconsiders everything in history from scratch. Deleting a wrongly-created bill does
// NOT need this -- that pattern's key was already recorded as "handled" the moment it was
// created, so it stays skipped on its own even after the bill itself is gone.
export function resetAutoDetection() {
  saveHandled(new Set());
}

// Silently creates a real RecurringBill for every confident, still-active (see
// RECENCY_WINDOW_DAYS in recurrenceSimilarity.ts) pattern in history that hasn't already been
// auto-created or explicitly rejected (by deleting it) before. No review step -- if one's wrong,
// delete it from the Recurring Bills list; it won't come back on its own. Returns whatever got
// created this call, purely so the caller can show a brief notice.
export async function syncAutoDetectedBills(
  transactions: Transaction[],
  existingBills: RecurringBill[],
  accounts: Account[]
): Promise<RecurringBill[]> {
  const handled = loadHandled();
  const candidates = findRecurringBillCandidates(transactions, existingBills);
  const created: RecurringBill[] = [];

  for (const c of candidates) {
    const key = candidateKey(c);
    if (handled.has(key)) continue;

    try {
      const bill = await window.electronAPI.recurringBills.create({
        // The linked account already identifies this bill everywhere it's shown -- use its
        // name rather than a raw bank statement description as the label.
        label: accounts.find((a) => a.id === c.accountId)?.friendlyName ?? 'Recurring bill',
        amountMode: c.amountMode,
        fixedAmount: c.amountMode === 'fixed' ? c.medianAmount : null,
        frequency: c.suggestedFrequency,
        startDate: c.suggestedStartDate,
        endDate: null,
        accountId: c.accountId,
      });

      // An 'auto-average' bill resolves its amount from its own linked history -- link the
      // very transactions that established the pattern so the average has real data
      // immediately, instead of showing "no confirmed history yet" for a bill whose history
      // we just finished reading.
      if (c.amountMode === 'auto-average') {
        for (const tx of c.transactions) {
          await window.electronAPI.transactions.update(tx.id, { recurringBillId: bill.id });
        }
      }

      created.push(bill);
      handled.add(key);
    } catch (e) {
      console.error('Failed to auto-create recurring bill', e);
    }
  }

  if (created.length > 0) saveHandled(handled);
  return created;
}
