import { Transaction } from '../../shared/types/transaction';
import { RecurringBill, RecurringBillAmountMode } from '../../shared/types/recurringBill';
import { ProjectionFrequency } from '../../shared/types/projection';

export interface RecurringBillCandidate {
  accountId: string;
  transactions: Transaction[]; // most recent first
  amountMode: RecurringBillAmountMode;
  // The candidate's own historical median -- always populated, even for 'auto-average'
  // candidates (informational there; the created bill's real resolved amount instead comes
  // from averaging its linked history once created).
  medianAmount: number;
  medianIntervalDays: number;
  suggestedFrequency: ProjectionFrequency;
  // Next plausible occurrence date, derived from the most recent member + the median gap --
  // used to seed a promoted RecurringBill's startDate.
  suggestedStartDate: string;
}

const MIN_OCCURRENCES = 3;
// How far an individual occurrence's amount may sit from the cluster median (as a fraction of
// the median) for the whole cluster to still count as 'fixed' rather than 'auto-average'.
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

// Groups each account's expense history into candidate recurring bills. Clustering itself is
// driven by TIMING alone (a run of at least MIN_OCCURRENCES transactions whose gaps land
// consistently on a weekly/biweekly/monthly cadence, most recent within RECENCY_WINDOW_DAYS) --
// amount is deliberately NOT part of what makes something "recurring": a credit card payment
// (e.g. Apple Card) recurs every month on schedule with a totally different amount each time,
// since it's whatever got charged that cycle, and it's just as real a recurring bill as a fixed
// $70 cable bill. Amount consistency only decides HOW the bill is tracked afterward: a cluster
// whose amounts stay within AMOUNT_TOLERANCE_PCT of each other becomes a 'fixed' bill (the
// median amount); anything more variable becomes 'auto-average' instead of a misleading guess.
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

      const gapMean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      const gapStddev = Math.sqrt(gaps.reduce((s, g) => s + (g - gapMean) ** 2, 0) / gaps.length);
      if (gapStddev > INTERVAL_TOLERANCE_DAYS) continue;

      const mostRecentMember = cluster[cluster.length - 1];
      if (daysBetween(mostRecentMember.date, today) > RECENCY_WINDOW_DAYS) continue;

      const medianAmount = median(cluster.map((t) => t.amount));
      const maxAmountDeviation = Math.max(
        ...cluster.map((t) => Math.abs(t.amount - medianAmount) / Math.abs(medianAmount))
      );
      const amountMode: RecurringBillAmountMode = maxAmountDeviation <= AMOUNT_TOLERANCE_PCT ? 'fixed' : 'auto-average';

      // Don't re-suggest something a bill already covers -- ANY existing bill on the same
      // account at the same frequency counts, active or paused. Pausing is a deliberate user
      // decision ("I know about this one, stop counting it"), not the same as never having
      // detected it -- if this only checked `active`, pausing a bill would make detection treat
      // the pattern as still-missing and recreate it as a brand new active duplicate on the very
      // next sync. In this app's one-account-per-payee model, an account only ever represents
      // one real recurring relationship, so there should never be two bills (of any amountMode
      // or active state) covering the same account+frequency. Only an actual DELETE should ever
      // let a pattern be reconsidered, and that's handled separately -- its key was already
      // recorded as "handled" the moment it was first created, so it stays skipped even after
      // the bill itself is gone.
      const alreadyCovered = existingBills.some(
        (b) => b.accountId === accountId && b.frequency === suggestedFrequency
      );
      if (alreadyCovered) continue;

      cluster.forEach((t) => consumed.add(t.id));
      candidates.push({
        accountId,
        transactions: [...cluster].reverse(),
        amountMode,
        medianAmount,
        medianIntervalDays: medianGap,
        suggestedFrequency,
        suggestedStartDate: addDaysIso(mostRecentMember.date, Math.round(medianGap)),
      });
    }
  }

  return candidates;
}
