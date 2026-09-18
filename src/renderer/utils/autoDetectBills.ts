import { Transaction } from '../../shared/types/transaction';
import { RecurringBill } from '../../shared/types/recurringBill';
import { findRecurringBillCandidates, RecurringBillCandidate } from './recurrenceSimilarity';

const HANDLED_STORAGE_KEY = 'sweeper.autoHandledRecurringBillCandidates';

function candidateKey(c: RecurringBillCandidate): string {
  const earliest = c.transactions[c.transactions.length - 1];
  return `${c.accountId}|${c.medianAmount.toFixed(2)}|${c.suggestedFrequency}|${earliest.date}`;
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

function mostCommonDescription(c: RecurringBillCandidate): string {
  const counts = new Map<string, number>();
  for (const t of c.transactions) counts.set(t.description, (counts.get(t.description) ?? 0) + 1);
  let best = c.transactions[0]?.description ?? 'Recurring bill';
  let bestCount = 0;
  for (const [desc, count] of counts) {
    if (count > bestCount) {
      best = desc;
      bestCount = count;
    }
  }
  return best;
}

// Silently creates a real RecurringBill for every confident, still-active (see
// RECENCY_WINDOW_DAYS in recurrenceSimilarity.ts) pattern in history that hasn't already been
// auto-created or explicitly rejected (by deleting it) before. No review step -- if one's wrong,
// delete it from the Recurring Bills list; it won't come back on its own. Returns whatever got
// created this call, purely so the caller can show a brief notice.
export async function syncAutoDetectedBills(
  transactions: Transaction[],
  existingBills: RecurringBill[]
): Promise<RecurringBill[]> {
  const handled = loadHandled();
  const candidates = findRecurringBillCandidates(transactions, existingBills);
  const created: RecurringBill[] = [];

  for (const c of candidates) {
    const key = candidateKey(c);
    if (handled.has(key)) continue;

    try {
      const bill = await window.electronAPI.recurringBills.create({
        label: mostCommonDescription(c),
        amountMode: 'fixed',
        fixedAmount: c.medianAmount,
        frequency: c.suggestedFrequency,
        startDate: c.suggestedStartDate,
        endDate: null,
        accountId: c.accountId,
      });
      created.push(bill);
      handled.add(key);
    } catch (e) {
      console.error('Failed to auto-create recurring bill', e);
    }
  }

  if (created.length > 0) saveHandled(handled);
  return created;
}
