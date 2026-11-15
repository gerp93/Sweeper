import { Account } from './types/account';
import { AccountAlias } from './types/accountAlias';
import { ImportRule } from './types/importRule';

// Shared by the manual CSV import (renderer) and the SimpleFIN automated import (main
// process), so a row is skipped or matched to an account by exactly the same rules either way.

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

export function findAccountMatch(description: string, accounts: Account[], aliases: AccountAlias[]): Account | null {
  const normalized = description.trim().toLowerCase();
  const alias = aliases.find((a) => a.rawName.trim().toLowerCase() === normalized);
  if (!alias) return null;
  return accounts.find((a) => a.id === alias.accountId) ?? null;
}
