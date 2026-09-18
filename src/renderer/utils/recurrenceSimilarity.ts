import { Transaction } from '../../shared/types/transaction';
import { RecurringBill } from '../../shared/types/recurringBill';
import { ProjectionFrequency } from '../../shared/types/projection';

export interface RecurringBillCandidate {
  accountId: string;
  transactions: Transaction[]; // most recent first
  medianAmount: number;
  medianIntervalDays: number;
  suggestedFrequency: ProjectionFrequency;
  // Next plausible occurrence date, derived from the most recent member + the median gap --
  // used to seed a promoted RecurringBill's startDate.
  suggestedStartDate: string;
}

const MIN_OCCURRENCES = 3;
const AMOUNT_TOLERANCE_PCT = 0.15;
// How consistent the gaps between occurrences must be (stddev, in days) to count as "recurring"
// rather than coincidentally similar amounts landing at random times.
const INTERVAL_TOLERANCE_DAYS = 5;
// A cluster whose most recent member is older than this doesn't count as still active -- a
// bill that stopped years ago shouldn't get auto-created (or suggested) as if it were current.
const RECENCY_WINDOW_DAYS = 60;

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000;
}

function addDaysIso(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function frequencyForInterval(days: number): ProjectionFrequency | null {
  if (days >= 6 && days <= 9) return 'weekly';
  if (days >= 12 && days <= 17) return 'biweekly';
  if (days >= 25 && days <= 35) return 'monthly';
  return null;
}

// Groups each account's expense history into candidate recurring bills: a run of at least
// MIN_OCCURRENCES transactions whose amounts stay within AMOUNT_TOLERANCE_PCT of each other,
// whose gaps land consistently on a weekly/biweekly/monthly cadence, AND whose most recent
// occurrence is within RECENCY_WINDOW_DAYS -- a pattern that stopped years ago doesn't count as
// still active. Simpler than account-name similarity clustering (accountSimilarity.ts) since
// there's no fuzzy string dimension -- amount + interval banding is enough, one pass per account.
export function findRecurringBillCandidates(
  transactions: Transaction[],
  existingBills: RecurringBill[],
  today: string = new Date().toISOString().slice(0, 10)
): RecurringBillCandidate[] {
  const candidates: RecurringBillCandidate[] = [];

  const byAccount = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.accountId) continue;
    if (tx.amount >= 0) continue; // expenses only
    if (tx.recurringBillId != null) continue; // already tracked, don't re-suggest
    const list = byAccount.get(tx.accountId) ?? [];
    list.push(tx);
    byAccount.set(tx.accountId, list);
  }

  for (const [accountId, txs] of byAccount) {
    const sorted = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1));
    const consumed = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
      if (consumed.has(sorted[i].id)) continue;
      const cluster: Transaction[] = [sorted[i]];

      for (let j = i + 1; j < sorted.length; j++) {
        if (consumed.has(sorted[j].id)) continue;
        const clusterMedian = median(cluster.map((t) => t.amount));
        const withinAmount = Math.abs(sorted[j].amount - clusterMedian) <= Math.abs(clusterMedian) * AMOUNT_TOLERANCE_PCT;
        if (!withinAmount) continue;

        const gapFromLast = daysBetween(cluster[cluster.length - 1].date, sorted[j].date);
        if (!frequencyForInterval(gapFromLast)) continue;

        cluster.push(sorted[j]);
      }

      if (cluster.length < MIN_OCCURRENCES) continue;

      const gaps: number[] = [];
      for (let k = 1; k < cluster.length; k++) gaps.push(daysBetween(cluster[k - 1].date, cluster[k].date));
      const medianGap = median(gaps);
      const suggestedFrequency = frequencyForInterval(medianGap);
      if (!suggestedFrequency) continue;

      const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const stddev = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
      if (stddev > INTERVAL_TOLERANCE_DAYS) continue;

      const mostRecentMember = cluster[cluster.length - 1];
      if (daysBetween(mostRecentMember.date, today) > RECENCY_WINDOW_DAYS) continue;

      const medianAmount = median(cluster.map((t) => t.amount));

      // Don't re-suggest something an active bill already covers.
      const alreadyCovered = existingBills.some(
        (b) =>
          b.active &&
          b.accountId === accountId &&
          b.frequency === suggestedFrequency &&
          b.amountMode === 'fixed' &&
          b.fixedAmount != null &&
          Math.abs(b.fixedAmount - medianAmount) <= Math.abs(medianAmount) * AMOUNT_TOLERANCE_PCT
      );
      if (alreadyCovered) continue;

      cluster.forEach((t) => consumed.add(t.id));
      const mostRecent = cluster[cluster.length - 1];
      candidates.push({
        accountId,
        transactions: [...cluster].reverse(),
        medianAmount,
        medianIntervalDays: medianGap,
        suggestedFrequency,
        suggestedStartDate: addDaysIso(mostRecent.date, Math.round(medianGap)),
      });
    }
  }

  return candidates;
}
