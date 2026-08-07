import { Reconciliation } from '../../shared/types/reconciliation';

// A transaction is "reconciled through" the as-of-date of the earliest confirmed
// reconciliation dated on or after the transaction's own date -- that's the first
// point-in-time check that would have caught this transaction if it were wrong.
export function reconciledThrough(txDate: string, reconciliations: Reconciliation[]): string | null {
  const covering = reconciliations.filter((r) => r.asOfDate >= txDate);
  if (covering.length === 0) return null;
  return covering.reduce((earliest, r) => (r.asOfDate < earliest ? r.asOfDate : earliest), covering[0].asOfDate);
}
