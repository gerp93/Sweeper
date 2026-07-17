import { useEffect, useMemo, useState } from 'react';
import { Account } from '../../shared/types/account';
import { Transaction } from '../../shared/types/transaction';
import { findSimilarGroups, SimilarityGroup } from '../utils/accountSimilarity';

interface Props {
  accounts: Account[];
  transactions: Transaction[];
  onMerged: () => void;
}

const DISMISSED_STORAGE_KEY = 'sweeper.dismissedMergeGroups';

function groupKey(group: SimilarityGroup): string {
  return group.accounts
    .map((a) => a.id)
    .sort()
    .join('|');
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

export default function SuggestedMerges({ accounts, transactions, onMerged }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);

  useEffect(() => {
    saveDismissed(dismissed);
  }, [dismissed]);
  const [merging, setMerging] = useState<string | null>(null);
  const [keeperByGroup, setKeeperByGroup] = useState<Record<string, string>>({});
  const [checkedByGroup, setCheckedByGroup] = useState<Record<string, Set<string>>>({});

  const txCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.accountId) counts.set(tx.accountId, (counts.get(tx.accountId) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  const groups = useMemo(() => findSimilarGroups(accounts, 0.65), [accounts]);
  const visibleGroups = groups.filter((g) => !dismissed.has(groupKey(g)));

  function keeperFor(group: SimilarityGroup): string {
    const key = groupKey(group);
    if (keeperByGroup[key]) return keeperByGroup[key];
    const best = [...group.accounts].sort(
      (a, b) => (txCounts.get(b.id) ?? 0) - (txCounts.get(a.id) ?? 0)
    )[0];
    return best.id;
  }

  function checkedFor(group: SimilarityGroup): Set<string> {
    const key = groupKey(group);
    if (checkedByGroup[key]) return checkedByGroup[key];
    return new Set(group.accounts.map((a) => a.id));
  }

  function setKeeper(group: SimilarityGroup, id: string) {
    setKeeperByGroup((prev) => ({ ...prev, [groupKey(group)]: id }));
  }

  function toggleChecked(group: SimilarityGroup, id: string) {
    const key = groupKey(group);
    const current = new Set(checkedFor(group));
    if (current.has(id)) current.delete(id);
    else current.add(id);
    setCheckedByGroup((prev) => ({ ...prev, [key]: current }));
  }

  function dismiss(group: SimilarityGroup) {
    setDismissed((prev) => new Set(prev).add(groupKey(group)));
  }

  function rerun() {
    setDismissed(new Set());
  }

  async function merge(group: SimilarityGroup) {
    const key = groupKey(group);
    const keeperId = keeperFor(group);
    const checked = checkedFor(group);
    const toMerge = group.accounts.filter((a) => a.id !== keeperId && checked.has(a.id));
    if (toMerge.length === 0) return;

    setMerging(key);
    try {
      for (const account of toMerge) {
        await window.electronAPI.accounts.merge(account.id, keeperId);
      }
      setDismissed((prev) => new Set(prev).add(key));
      onMerged();
    } finally {
      setMerging(null);
    }
  }

  if (groups.length === 0) return null;

  if (visibleGroups.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="text-muted" style={{ fontSize: 13 }}>
            All {groups.length} suggested merge{groups.length === 1 ? '' : 's'} reviewed.
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
        <h2 style={{ fontSize: 15, margin: 0 }}>Suggested Merges ({visibleGroups.length})</h2>
        <button className="btn" onClick={rerun}>
          Rerun Suggestions
        </button>
      </div>
      <p className="text-muted" style={{ marginTop: -4, fontSize: 13 }}>
        These account names look similar enough that they might be the same real-world payee, hand-typed
        inconsistently. Review each group, pick which name survives, uncheck anything that doesn't belong, then
        merge — every transaction on a merged account moves to the survivor and the other account is deleted.
      </p>

      {visibleGroups.map((group) => {
        const key = groupKey(group);
        const keeperId = keeperFor(group);
        const checked = checkedFor(group);
        const selectedCount = group.accounts.filter((a) => a.id !== keeperId && checked.has(a.id)).length;

        return (
          <div
            key={key}
            style={{ border: '1px solid var(--color-primary-action-hover)', borderRadius: 8, padding: 12, marginBottom: 10 }}
          >
            <div style={{ fontSize: 12, color: 'var(--color-accent-blue)', marginBottom: 8 }}>
              similarity {Math.round(group.maxScore * 100)}%
            </div>
            {group.accounts.map((a) => (
              <div
                key={a.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
              >
                <input
                  type="radio"
                  name={`keeper-${key}`}
                  checked={keeperId === a.id}
                  onChange={() => setKeeper(group, a.id)}
                  title="Keep this name"
                />
                <input
                  type="checkbox"
                  checked={a.id === keeperId || checked.has(a.id)}
                  disabled={a.id === keeperId}
                  onChange={() => toggleChecked(group, a.id)}
                  title="Include in merge"
                />
                <span style={{ flex: 1, fontWeight: a.id === keeperId ? 600 : 400 }}>{a.friendlyName}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {txCounts.get(a.id) ?? 0} tx
                </span>
              </div>
            ))}
            <div className="modal-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => dismiss(group)} disabled={merging === key}>
                Not the same
              </button>
              <button
                className="btn btn-primary"
                onClick={() => merge(group)}
                disabled={merging === key || selectedCount === 0}
              >
                {merging === key ? 'Merging…' : `Merge ${selectedCount} into "${group.accounts.find((a) => a.id === keeperId)?.friendlyName}"`}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
