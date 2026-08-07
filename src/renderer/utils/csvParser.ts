import { Account } from '../../shared/types/account';
import { ImportRule } from '../../shared/types/importRule';
import { Transaction } from '../../shared/types/transaction';

export interface ParsedImportRow {
  date: string; // ISO yyyy-mm-dd
  refCheck: string | null;
  description: string;
  amount: number;
  statementBalance: number | null;
  memo: string | null;
  category: string | null;
  matchedRule: ImportRule | null;
  matchedAccount: Account | null;
  suggestedFriendlyName: string;
  isDuplicate: boolean;
  include: boolean; // editable by the user before commit
}

const REQUIRED_COLUMNS = ['Date', 'Ref/Check', 'Description', 'Amount', 'Balance', 'Memo', 'Category'];

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, month, day, year] = mdy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return trimmed;
  throw new Error(`Unrecognized date format: ${value}`);
}

function parseAmount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const isParenNegative = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$,]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) throw new Error(`Unrecognized amount format: ${value}`);
  return isParenNegative ? -Math.abs(num) : num;
}

function matchesRule(row: { description: string; memo: string | null }, rule: ImportRule): boolean {
  const fieldValue = (rule.field === 'memo' ? row.memo : row.description) ?? '';
  const haystack = fieldValue.toLowerCase();
  const needle = rule.pattern.toLowerCase();

  switch (rule.matchType) {
    case 'contains':
      return haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    default:
      return false;
  }
}

export function findMatchingRule(
  row: { description: string; memo: string | null },
  rules: ImportRule[]
): ImportRule | null {
  return rules.find((rule) => rule.isActive && matchesRule(row, rule)) ?? null;
}

export function findAccountMatch(description: string, accounts: Account[]): Account | null {
  const normalized = description.trim().toLowerCase();
  return accounts.find((a) => a.rawName.trim().toLowerCase() === normalized) ?? null;
}

export function isDuplicateTransaction(
  row: { date: string; description: string; amount: number; refCheck: string | null },
  existing: Transaction[]
): boolean {
  return existing.some((tx) => {
    if (tx.date !== row.date || tx.description !== row.description || tx.amount !== row.amount) return false;
    if (row.refCheck && tx.refCheck) return tx.refCheck === row.refCheck;
    return true;
  });
}

export interface AmountDateCollision {
  date: string;
  amount: number;
  rows: number[]; // indices into the array of rows being imported that collide
}

// Flags rows sharing the same date+amount as another row being imported, or as a
// transaction already in the database -- regardless of account. This is a separate,
// stricter check than isDuplicateTransaction (which also requires matching
// description/refCheck): it exists to catch a real duplicate that got mis-tagged
// under a different account and so slipped past the exact-match dedup above.
export function findSameDayAmountCollisions(
  rowsToImport: { date: string; amount: number }[],
  existingTransactions: Transaction[]
): AmountDateCollision[] {
  const groups = new Map<string, { date: string; amount: number; rows: number[]; existingCount: number }>();

  const keyOf = (date: string, amount: number) => `${date}|${amount}`;

  rowsToImport.forEach((row, idx) => {
    const key = keyOf(row.date, row.amount);
    const group = groups.get(key) ?? { date: row.date, amount: row.amount, rows: [], existingCount: 0 };
    group.rows.push(idx);
    groups.set(key, group);
  });

  for (const tx of existingTransactions) {
    const key = keyOf(tx.date, tx.amount);
    const group = groups.get(key);
    if (group) group.existingCount++;
  }

  const collisions: AmountDateCollision[] = [];
  for (const group of groups.values()) {
    if (group.rows.length + group.existingCount >= 2) {
      collisions.push({ date: group.date, amount: group.amount, rows: group.rows });
    }
  }
  return collisions;
}

export function parseStatementCSV(
  csvText: string,
  rules: ImportRule[],
  accounts: Account[],
  existingTransactions: Transaction[]
): ParsedImportRow[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const header = parseCSVLine(lines[0]);
  const missing = REQUIRED_COLUMNS.filter((col) => !header.includes(col));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);
  }

  const colIndex = (name: string) => header.indexOf(name);
  const dateIdx = colIndex('Date');
  const refIdx = colIndex('Ref/Check');
  const descIdx = colIndex('Description');
  const amountIdx = colIndex('Amount');
  const balanceIdx = colIndex('Balance');
  const memoIdx = colIndex('Memo');
  const categoryIdx = colIndex('Category');

  const rows: ParsedImportRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.every((f) => f === '')) continue;

    const description = fields[descIdx] ?? '';
    const memo = fields[memoIdx]?.trim() || null;
    const refCheck = fields[refIdx]?.trim() || null;
    const category = fields[categoryIdx]?.trim() || null;
    const date = parseDate(fields[dateIdx] ?? '');
    const amount = parseAmount(fields[amountIdx] ?? '0');
    const statementBalanceRaw = fields[balanceIdx];
    const statementBalance = statementBalanceRaw ? parseAmount(statementBalanceRaw) : null;

    const matchedRule = findMatchingRule({ description, memo }, rules);
    const matchedAccount = findAccountMatch(description, accounts);
    const isDuplicate = isDuplicateTransaction({ date, description, amount, refCheck }, existingTransactions);

    rows.push({
      date,
      refCheck,
      description,
      amount,
      statementBalance,
      memo,
      category,
      matchedRule,
      matchedAccount,
      suggestedFriendlyName: matchedAccount?.friendlyName ?? description,
      isDuplicate,
      include: !matchedRule && !isDuplicate,
    });
  }

  return rows;
}
