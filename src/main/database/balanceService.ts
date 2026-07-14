import { BalanceAnchorService } from './balanceAnchorService';
import { TransactionService } from './transactionService';
import { SpendableBalance } from '../../shared/types/balanceAnchor';

export class BalanceService {
  constructor(
    private balanceAnchorService: BalanceAnchorService,
    private transactionService: TransactionService
  ) {}

  getSpendableBalance(asOf?: string): SpendableBalance {
    const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);

    const priorAnchor = this.balanceAnchorService.getLatestAnchorAsOf(asOfDate);
    if (priorAnchor) {
      const transactions = this.transactionService
        .getTransactionsAfterDate(priorAnchor.asOfDate)
        .filter((tx) => tx.date <= asOfDate);
      const netSinceAnchor = transactions.reduce((sum, tx) => sum + tx.amount, 0);

      return {
        balance: priorAnchor.balance + netSinceAnchor,
        anchor: priorAnchor,
        netSinceAnchor,
        asOf: asOfDate,
      };
    }

    // No anchor at or before this date -- if a later anchor exists, walk
    // backward from it instead of giving up. This matters whenever the
    // earliest anchor lands mid-month (or mid-history): the months/dates
    // before it still have a well-defined balance, derivable by subtracting
    // the transactions between this date and that later anchor.
    const nextAnchor = this.balanceAnchorService.getEarliestAnchorAfter(asOfDate);
    if (nextAnchor) {
      const transactions = this.transactionService
        .getTransactionsAfterDate(asOfDate)
        .filter((tx) => tx.date <= nextAnchor.asOfDate);
      const netBeforeAnchor = transactions.reduce((sum, tx) => sum + tx.amount, 0);

      return {
        balance: nextAnchor.balance - netBeforeAnchor,
        anchor: nextAnchor,
        netSinceAnchor: -netBeforeAnchor,
        asOf: asOfDate,
      };
    }

    return { balance: 0, anchor: null, netSinceAnchor: 0, asOf: asOfDate };
  }
}
