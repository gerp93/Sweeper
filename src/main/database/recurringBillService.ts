import { Database } from 'sql.js';
import {
  RecurringBill,
  CreateRecurringBillInput,
  UpdateRecurringBillInput,
  RecurringBillOccurrence,
  BillOccurrenceStatus,
  RecurringBillMatchCandidate,
  RecurringBillAmountInfo,
} from '../../shared/types/recurringBill';
import { v4 as uuidv4 } from 'uuid';
import { saveDatabase } from './schema';
import { expandOccurrences, addDays } from './projectionService';
import { TransactionService } from './transactionService';
import { Transaction } from '../../shared/types/transaction';

function rowToBill(columns: string[], row: any[]): RecurringBill {
  const obj: any = {};
  columns.forEach((col, idx) => {
    obj[col] = row[idx];
  });
  return {
    id: obj.id,
    label: obj.label,
    amountMode: obj.amountMode,
    fixedAmount: obj.fixedAmount,
    frequency: obj.frequency,
    startDate: obj.startDate,
    endDate: obj.endDate,
    accountId: obj.accountId,
    note: obj.note,
    lastDayOfMonth: !!obj.lastDayOfMonth,
    active: !!obj.active,
    amountToleranceType: obj.amountToleranceType,
    amountTolerance: obj.amountTolerance,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

const SELECT_COLUMNS = `
  id,
  label,
  amount_mode as amountMode,
  fixed_amount as fixedAmount,
  frequency,
  start_date as startDate,
  end_date as endDate,
  account_id as accountId,
  note,
  last_day_of_month as lastDayOfMonth,
  active,
  amount_tolerance_type as amountToleranceType,
  amount_tolerance as amountTolerance,
  created_at as createdAt,
  updated_at as updatedAt
`;

// How many of a bill's own most-recently-linked transactions to average for 'auto-average'.
const AUTO_AVERAGE_LOOKBACK = 6;
// Reconciliation window: a real transaction dated within this many days of an occurrence's
// expected date counts as satisfying it (banks post a few days early/late).
const RECONCILE_WINDOW_DAYS = 10;
// How far before an occurrence's expected date an early payment can land and still cover it
// (see findCoveringPayment) -- roughly a card's statement-to-due-date gap.
const EARLY_PAYMENT_WINDOW_DAYS = 14;
const daysBetweenIso = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
// Import-matching window: wider than the reconciliation window since we're searching from the
// transaction's date outward for a plausible nearby occurrence, not the other way around.
const MATCH_WINDOW_DAYS = 15;

export class RecurringBillService {
  constructor(
    private db: Database,
    private transactionService: TransactionService
  ) {}

  getAllBills(): RecurringBill[] {
    const results = this.db.exec(`SELECT ${SELECT_COLUMNS} FROM recurring_bills ORDER BY start_date ASC`);
    if (results.length === 0) return [];
    return results[0].values.map((row) => rowToBill(results[0].columns, row));
  }

  getBillById(id: string): RecurringBill | null {
    return this.getAllBills().find((b) => b.id === id) ?? null;
  }

  createBill(input: CreateRecurringBillInput): RecurringBill {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO recurring_bills (
        id, label, amount_mode, fixed_amount, frequency, start_date, end_date, account_id, note,
        last_day_of_month, active, amount_tolerance_type, amount_tolerance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.label,
        input.amountMode,
        input.fixedAmount ?? null,
        input.frequency,
        input.startDate,
        input.endDate ?? null,
        input.accountId ?? null,
        input.note ?? null,
        input.lastDayOfMonth ? 1 : 0,
        input.active === undefined ? 1 : input.active ? 1 : 0,
        input.amountToleranceType ?? 'percent',
        input.amountTolerance ?? 0.15,
        now,
        now,
      ]
    );

    saveDatabase(this.db);

    return this.getBillById(id)!;
  }

  updateBill(id: string, input: UpdateRecurringBillInput): RecurringBill {
    const updates: string[] = [];
    const params: any[] = [];

    if (input.label !== undefined) {
      updates.push('label = ?');
      params.push(input.label);
    }
    if (input.amountMode !== undefined) {
      updates.push('amount_mode = ?');
      params.push(input.amountMode);
    }
    if (input.fixedAmount !== undefined) {
      updates.push('fixed_amount = ?');
      params.push(input.fixedAmount);
    }
    if (input.frequency !== undefined) {
      updates.push('frequency = ?');
      params.push(input.frequency);
    }
    if (input.startDate !== undefined) {
      updates.push('start_date = ?');
      params.push(input.startDate);
    }
    if (input.endDate !== undefined) {
      updates.push('end_date = ?');
      params.push(input.endDate);
    }
    if (input.accountId !== undefined) {
      updates.push('account_id = ?');
      params.push(input.accountId);
    }
    if (input.note !== undefined) {
      updates.push('note = ?');
      params.push(input.note);
    }
    if (input.lastDayOfMonth !== undefined) {
      updates.push('last_day_of_month = ?');
      params.push(input.lastDayOfMonth ? 1 : 0);
    }
    if (input.active !== undefined) {
      updates.push('active = ?');
      params.push(input.active ? 1 : 0);
    }
    if (input.amountToleranceType !== undefined) {
      updates.push('amount_tolerance_type = ?');
      params.push(input.amountToleranceType);
    }
    if (input.amountTolerance !== undefined) {
      updates.push('amount_tolerance = ?');
      params.push(input.amountTolerance);
    }

    updates.push('updated_at = ?');
    params.push(new Date().toISOString());
    params.push(id);

    this.db.run(`UPDATE recurring_bills SET ${updates.join(', ')} WHERE id = ?`, params);
    saveDatabase(this.db);

    return this.getBillById(id)!;
  }

  deleteBill(id: string): void {
    // The recurring_bill_id column was added via ALTER TABLE, so SQLite has no real FK
    // constraint enforcing ON DELETE SET NULL here (unlike a column declared in the original
    // CREATE TABLE) -- null it out explicitly first so linked transactions don't end up
    // pointing at a deleted bill.
    this.db.run(`UPDATE transactions SET recurring_bill_id = NULL WHERE recurring_bill_id = ?`, [id]);
    this.db.run(`DELETE FROM recurring_bills WHERE id = ?`, [id]);
    saveDatabase(this.db);
  }

  // Fixed bills just report their set amount. Auto-average bills average the linked account's
  // own most recent real expense transactions -- a live read, not something that requires a
  // separate manual confirm/link step first. This app's data model is one account per recurring
  // payee, so the account itself is already the reliable signal (the same narrowing
  // findCandidateMatches uses) -- there's no need to additionally gate the average on each
  // transaction having been explicitly linked via recurring_bill_id first. Returns 0 with no
  // linked account or no expense history on it yet.
  private resolvedAmount(bill: RecurringBill): number {
    if (bill.amountMode === 'fixed') return bill.fixedAmount ?? 0;
    if (!bill.accountId) return 0;

    const stmt = this.db.prepare(
      `SELECT amount FROM transactions WHERE account_id = ? AND amount < 0 ORDER BY date DESC LIMIT ?`
    );
    stmt.bind([bill.accountId, AUTO_AVERAGE_LOOKBACK]);
    const amounts: number[] = [];
    while (stmt.step()) amounts.push(Number(stmt.get()[0]));
    stmt.free();

    if (amounts.length === 0) return 0;
    return amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
  }

  // Whether an auto-average bill's linked account has any real expense history yet -- lets the
  // UI show "no history yet" instead of a misleading $0.00.
  hasConfirmedHistory(billId: string): boolean {
    const bill = this.getBillById(billId);
    if (!bill?.accountId) return false;
    const stmt = this.db.prepare(`SELECT 1 FROM transactions WHERE account_id = ? AND amount < 0 LIMIT 1`);
    stmt.bind([bill.accountId]);
    const has = stmt.step();
    stmt.free();
    return has;
  }

  // Current resolved amount for every bill, independent of any specific month -- fixes a
  // display bug where a bill whose next occurrence falls in a future month (so it has no
  // occurrence in "this month"'s list) incorrectly showed as having no history, even with real
  // linked transactions.
  getAmountInfo(): Record<string, RecurringBillAmountInfo> {
    const out: Record<string, RecurringBillAmountInfo> = {};
    for (const bill of this.getAllBills()) {
      out[bill.id] = {
        resolvedAmount: this.resolvedAmount(bill),
        hasConfirmedHistory: bill.amountMode === 'fixed' ? true : this.hasConfirmedHistory(bill.id),
      };
    }
    return out;
  }

  // The next occurrence date on or after today for every bill, regardless of active state --
  // a bill's stored startDate is a fixed anchor set once at creation and drifts stale (e.g. a
  // monthly bill created months ago still shows that original date), so the table needs this
  // live-computed value instead to show something meaningful as "due". null if the bill's
  // schedule has already fully lapsed (a one-time bill in the past, or endDate has passed).
  getNextDueDates(): Record<string, string | null> {
    const today = new Date().toISOString().slice(0, 10);
    const farFuture = addDays(today, 400);
    const out: Record<string, string | null> = {};
    for (const bill of this.getAllBills()) {
      const dates = expandOccurrences(bill, today, farFuture);
      out[bill.id] = dates[0] ?? null;
    }
    return out;
  }

  // Every occurrence of one bill in [windowStart, windowEnd], each carrying its resolved
  // amount at call time -- never persisted, computed fresh on every call.
  getOccurrencesInWindow(bill: RecurringBill, windowStart: string, windowEnd: string): { date: string; amount: number }[] {
    if (!bill.active) return [];
    const dates = expandOccurrences(bill, windowStart, windowEnd);
    const amount = this.resolvedAmount(bill);
    return dates.map((date) => ({ date, amount }));
  }

  // Bills should always be identified by their linked account, never their own stored `label`
  // -- that field is a one-time snapshot taken at creation (or, for older bills, a raw bank
  // statement description) that doesn't track an account rename and isn't guaranteed to match
  // the account at all. Falls back to the label only when there's no linked account.
  private displayName(bill: RecurringBill): string {
    if (!bill.accountId) return bill.label;
    const stmt = this.db.prepare(`SELECT friendly_name FROM accounts WHERE id = ?`);
    stmt.bind([bill.accountId]);
    const name = stmt.step() ? String(stmt.get()[0]) : null;
    stmt.free();
    return name ?? bill.label;
  }

  // A confirmed real transaction linked to this bill whose date falls within
  // RECONCILE_WINDOW_DAYS of expectedDate, closest date first.
  private findConfirmedMatch(billId: string, expectedDate: string): { id: string } | null {
    const stmt = this.db.prepare(
      `SELECT id FROM transactions WHERE recurring_bill_id = ?
       AND date BETWEEN date(?, '-${RECONCILE_WINDOW_DAYS} days') AND date(?, '+${RECONCILE_WINDOW_DAYS} days')
       ORDER BY ABS(julianday(date) - julianday(?)) ASC LIMIT 1`
    );
    stmt.bind([billId, expectedDate, expectedDate, expectedDate]);
    const row = stmt.step() ? { id: String(stmt.get()[0]) } : null;
    stmt.free();
    return row;
  }

  // A payment that was made early and covers the occurrence outright -- e.g. a credit card
  // paid off on the 9th for a bill expected on the 20th, in an amount the projection's
  // estimate never anticipated. It never got linked to the bill (an amount that far past the
  // estimate isn't offered as an import candidate) and sits outside RECONCILE_WINDOW_DAYS, so
  // findConfirmedMatch can't see it. Any unlinked (or same-bill) expense on the bill's account
  // that is at least the expected amount counts, provided this occurrence is the bill's nearest
  // one to the payment -- so one payment can't quietly satisfy two occurrences. Only meaningful
  // for expense bills; an expected amount of 0 (no history yet) never matches.
  private findCoveringPayment(bill: RecurringBill, expectedDate: string, expectedAmount: number): { id: string } | null {
    if (!bill.accountId || expectedAmount >= 0) return null;

    const stmt = this.db.prepare(
      `SELECT id, date FROM transactions
       WHERE account_id = ? AND amount <= ? AND (recurring_bill_id IS NULL OR recurring_bill_id = ?)
       AND date BETWEEN date(?, '-${EARLY_PAYMENT_WINDOW_DAYS} days') AND date(?, '+${RECONCILE_WINDOW_DAYS} days')
       ORDER BY ABS(julianday(date) - julianday(?)) ASC`
    );
    stmt.bind([bill.accountId, expectedAmount, bill.id, expectedDate, expectedDate, expectedDate]);
    const candidates: { id: string; date: string }[] = [];
    while (stmt.step()) {
      const [id, date] = stmt.get();
      candidates.push({ id: String(id), date: String(date) });
    }
    stmt.free();

    for (const c of candidates) {
      const distance = (d: string) => Math.abs(daysBetweenIso(c.date, d));
      const nearest = expandOccurrences(bill, addDays(c.date, -45), addDays(c.date, 45)).reduce(
        (best, d) => (distance(d) < distance(best) ? d : best),
        expectedDate
      );
      if (nearest === expectedDate) return { id: c.id };
    }
    return null;
  }

  // Live reconciliation state for the ledger: every active bill's occurrences in the given
  // month, each tagged upcoming / reconciled / overdue. Consumed by the Transactions ledger
  // merge (only upcoming/overdue become virtual rows -- reconciled ones already show as their
  // real transaction) and by the overdue-flag coloring.
  getMonthlyBillOccurrences(monthStart: string, monthEnd: string): RecurringBillOccurrence[] {
    const today = new Date().toISOString().slice(0, 10);
    const bills = this.getAllBills().filter((b) => b.active);
    const out: RecurringBillOccurrence[] = [];

    for (const bill of bills) {
      const occurrences = this.getOccurrencesInWindow(bill, monthStart, monthEnd);
      for (const occ of occurrences) {
        const matched =
          this.findConfirmedMatch(bill.id, occ.date) ?? this.findCoveringPayment(bill, occ.date, occ.amount);
        let status: BillOccurrenceStatus;
        if (matched) status = 'reconciled';
        else status = occ.date < today ? 'overdue' : 'upcoming';

        out.push({
          billId: bill.id,
          billLabel: this.displayName(bill),
          expectedDate: occ.date,
          expectedAmount: occ.amount,
          status,
          matchedTransactionId: matched?.id ?? null,
        });
      }
    }
    return out;
  }

  // Sum of every active bill's expected occurrence amounts in the window -- feeds Projections'
  // third burn-rate mode. Negative, already correctly summed over the real window (no scaling
  // needed, unlike the flat monthly-average modes).
  getExpectedBillTotal(windowStart: string, windowEnd: string): number {
    return this.getAllBills()
      .filter((b) => b.active)
      .flatMap((b) => this.getOccurrencesInWindow(b, windowStart, windowEnd))
      .reduce((sum, o) => sum + o.amount, 0);
  }

  // Import-time candidate matching. No fuzzy description matching at all -- the account link
  // narrows candidates to ~1 in the common case, per the reasoning that most bills post once a
  // month. Returns one entry per transaction that has at least one plausible candidate;
  // transactions with zero candidates are omitted entirely (nothing to confirm).
  findCandidateMatches(transactionIds: string[]): RecurringBillMatchCandidate[] {
    const transactions = transactionIds
      .map((id) => this.transactionService.getTransactionById(id))
      .filter((tx): tx is Transaction => tx != null);

    const bills = this.getAllBills().filter((b) => b.active && b.accountId != null);
    const out: RecurringBillMatchCandidate[] = [];

    for (const tx of transactions) {
      if (!tx.accountId) continue;
      const candidateBillIds: string[] = [];

      for (const bill of bills.filter((b) => b.accountId === tx.accountId)) {
        const windowStart = addDays(tx.date, -MATCH_WINDOW_DAYS);
        const windowEnd = addDays(tx.date, MATCH_WINDOW_DAYS);
        const occurrences = expandOccurrences(bill, windowStart, windowEnd);
        if (occurrences.length === 0) continue;

        const hasHistory = this.hasConfirmedHistory(bill.id);
        if (bill.amountMode === 'auto-average' && !hasHistory) {
          // Nothing to compare against yet -- let the first confirmation establish the
          // pattern instead of refusing to match for lack of a baseline.
          candidateBillIds.push(bill.id);
          continue;
        }

        const expected = this.resolvedAmount(bill);
        const diff = Math.abs(tx.amount - expected);
        const withinTolerance =
          bill.amountToleranceType === 'percent'
            ? diff <= Math.abs(expected) * bill.amountTolerance
            : diff <= bill.amountTolerance;
        if (withinTolerance) candidateBillIds.push(bill.id);
      }

      if (candidateBillIds.length > 0) {
        out.push({
          transactionId: tx.id,
          transactionDate: tx.date,
          transactionDescription: tx.description,
          transactionAmount: tx.amount,
          candidateBillIds,
        });
      }
    }

    return out;
  }
}
