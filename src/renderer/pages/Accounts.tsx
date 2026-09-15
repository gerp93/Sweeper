import { useEffect, useMemo, useRef, useState } from 'react';
import { Account } from '../../shared/types/account';
import { AccountAlias } from '../../shared/types/accountAlias';
import { Transaction } from '../../shared/types/transaction';
import AccountForm from '../components/AccountForm';
import MergeAccountForm from '../components/MergeAccountForm';
import ManageAliasesForm from '../components/ManageAliasesForm';
import SuggestedMerges from '../components/SuggestedMerges';

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [aliases, setAliases] = useState<AccountAlias[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [editing, setEditing] = useState<Account | null>(null);
  const [merging, setMerging] = useState<Account | null>(null);
  const [managingAliasesFor, setManagingAliasesFor] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [activeTab, setActiveTab] = useState<'accounts' | 'merges'>('accounts');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [accts, aliasList, txs] = await Promise.all([
      window.electronAPI.accounts.getAll(),
      window.electronAPI.accountAliases.getAll(),
      window.electronAPI.transactions.getAll(),
    ]);
    setAccounts(accts);
    setAliases(aliasList);
    setTransactions(txs);
    setLoading(false);
  }

  function flash(id: string) {
    setHighlightId(id);
    // list re-sorts alphabetically after a rename, so the row can jump far
    // away in a long list -- scroll to it so the change is unmistakable.
    requestAnimationFrame(() => {
      rowRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setTimeout(() => setHighlightId((current) => (current === id ? null : current)), 2000);
  }

  async function handleSave(friendlyName: string) {
    if (!editing) return;
    const id = editing.id;
    try {
      await window.electronAPI.accounts.update(id, { friendlyName });
    } catch (err: any) {
      alert(`Couldn't save: ${String(err?.message ?? err)}`);
      return;
    }
    setEditing(null);
    await load();
    flash(id);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this account? Transactions pointing to it will be unlinked, not deleted.')) return;
    await window.electronAPI.accounts.delete(id);
    await load();
  }

  async function handleMerge(targetId: string, memo: string | null) {
    if (!merging) return;
    await window.electronAPI.accounts.merge(merging.id, targetId, memo);
    setMerging(null);
    await load();
    flash(targetId);
  }

  async function handleAddAlias(rawName: string) {
    if (!managingAliasesFor) return;
    await window.electronAPI.accountAliases.create(managingAliasesFor.id, rawName);
    await load();
  }

  async function handleDeleteAlias(id: string) {
    await window.electronAPI.accountAliases.delete(id);
    await load();
  }

  const txCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.accountId) counts.set(tx.accountId, (counts.get(tx.accountId) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  const aliasesByAccount = useMemo(() => {
    const map = new Map<string, AccountAlias[]>();
    for (const alias of aliases) {
      const list = map.get(alias.accountId) ?? [];
      list.push(alias);
      map.set(alias.accountId, list);
    }
    return map;
  }, [aliases]);

  return (
    <div>
      <div className="page-header">
        <h1>Accounts</h1>
      </div>

      <div className="tab-bar">
        <button
          className={`tab-button${activeTab === 'accounts' ? ' active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          All Accounts
        </button>
        <button
          className={`tab-button${activeTab === 'merges' ? ' active' : ''}`}
          onClick={() => setActiveTab('merges')}
        >
          Suggested Merges
        </button>
      </div>

      {activeTab === 'merges' ? (
        <SuggestedMerges accounts={accounts} transactions={transactions} onMerged={load} />
      ) : (
        <div className="card">
          <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
            Accounts are the entities money comes from or goes to. Each one can have several aliases — the raw bank
            descriptions that match to it on import. Merging one account into another moves its aliases along with
            it, so future imports keep matching correctly.
          </p>
          {loading ? (
            <div className="empty-state">Loading…</div>
          ) : accounts.length === 0 ? (
            <div className="empty-state">No accounts yet. They'll appear as you import transactions.</div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Friendly Name</th>
                  <th>Aliases</th>
                  <th style={{ textAlign: 'right' }}>Transactions</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const accountAliases = aliasesByAccount.get(a.id) ?? [];
                  return (
                    <tr
                      key={a.id}
                      ref={(el) => {
                        rowRefs.current[a.id] = el;
                      }}
                      className={a.id === highlightId ? 'row-highlight' : undefined}
                    >
                      <td>{a.friendlyName}</td>
                      <td className="text-muted">
                        {accountAliases.length === 0 ? (
                          <span className="amount-negative">none — won't match on import</span>
                        ) : accountAliases.length === 1 ? (
                          accountAliases[0].rawName
                        ) : (
                          `${accountAliases[0].rawName} +${accountAliases.length - 1} more`
                        )}
                      </td>
                      <td className="text-muted" style={{ textAlign: 'right' }}>
                        {txCounts.get(a.id) ?? 0}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn" onClick={() => setManagingAliasesFor(a)}>
                            Aliases
                          </button>
                          <button className="btn" onClick={() => setEditing(a)}>
                            Rename
                          </button>
                          <button className="btn" onClick={() => setMerging(a)}>
                            Merge into…
                          </button>
                          <button className="btn btn-danger" onClick={() => handleDelete(a.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && <AccountForm account={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      {merging && (
        <MergeAccountForm
          account={merging}
          otherAccounts={accounts.filter((a) => a.id !== merging.id)}
          onMerge={handleMerge}
          onCancel={() => setMerging(null)}
        />
      )}
      {managingAliasesFor && (
        <ManageAliasesForm
          account={managingAliasesFor}
          aliases={aliasesByAccount.get(managingAliasesFor.id) ?? []}
          onAdd={handleAddAlias}
          onDelete={handleDeleteAlias}
          onClose={() => setManagingAliasesFor(null)}
        />
      )}
    </div>
  );
}
