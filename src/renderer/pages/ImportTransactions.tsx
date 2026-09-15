import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AmountDateCollision, ParsedImportRow, findSameDayAmountCollisions, parseStatementCSV } from '../utils/csvParser';
import { CreateTransactionInput, Transaction } from '../../shared/types/transaction';
import { Obligation } from '../../shared/types/obligation';
import { Account } from '../../shared/types/account';
import { RecurringBill, RecurringBillMatchCandidate } from '../../shared/types/recurringBill';
import { formatCurrency, formatDate } from '../utils/format';
import Rules from './Rules';

interface RowOverride {
  include: boolean;
}

interface AccountResolution {
  mode: 'new' | 'existing';
  friendlyName: string;
  accountId: string;
}

function defaultResolution(description: string): AccountResolution {
  return { mode: 'new', friendlyName: description, accountId: '' };
}

export default function ImportTransactions() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedImportRow[] | null>(null);
  const [overrides, setOverrides] = useState<RowOverride[]>([]);
  const [existingTransactions, setExistingTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, AccountResolution>>({});
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [autoAllocateObligations, setAutoAllocateObligations] = useState(true);
  const [pendingCollisions, setPendingCollisions] = useState<AmountDateCollision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [recurringBills, setRecurringBills] = useState<RecurringBill[]>([]);
  const [pendingBillMatches, setPendingBillMatches] = useState<RecurringBillMatchCandidate[] | null>(null);
  const [billChoices, setBillChoices] = useState<Record<string, string>>({});
  const [confirmingBillTx, setConfirmingBillTx] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'rules'>('import');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);

    try {
      const text = await file.text();
      const [rules, accts, aliases, existing, obligationList, billList] = await Promise.all([
        window.electronAPI.importRules.getAll(),
        window.electronAPI.accounts.getAll(),
        window.electronAPI.accountAliases.getAll(),
        window.electronAPI.transactions.getAll(),
        window.electronAPI.obligations.getAll(),
        window.electronAPI.recurringBills.getAll(),
      ]);

      const rows = parseStatementCSV(text, rules, accts, aliases, existing);
      setPreview(rows);
      setOverrides(rows.map((r) => ({ include: r.include })));
      setExistingTransactions(existing);
      setAccounts(accts);
      const initialResolutions: Record<string, AccountResolution> = {};
      rows.forEach((r) => {
        if (!r.matchedAccount && !(r.description in initialResolutions)) {
          initialResolutions[r.description] = defaultResolution(r.description);
        }
      });
      setResolutions(initialResolutions);
      setObligations(obligationList);
      setRecurringBills(billList);
      setPendingCollisions(null);
      setPendingBillMatches(null);
      setBillChoices({});
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPreview(null);
    }
  }

  function updateOverride(idx: number, patch: Partial<RowOverride>) {
    setOverrides((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
    setPendingCollisions(null);
  }

  function updateResolution(description: string, patch: Partial<AccountResolution>) {
    setResolutions((prev) => ({
      ...prev,
      [description]: { ...(prev[description] ?? defaultResolution(description)), ...patch },
    }));
  }

  function statusFor(row: ParsedImportRow): { label: string; pillClass: string } {
    if (row.matchedRule) {
      return { label: `Skipped — rule: ${row.matchedRule.pattern}`, pillClass: 'pill-excluded' };
    }
    if (row.isDuplicate) {
      return { label: 'Duplicate', pillClass: 'pill-duplicate' };
    }
    return { label: row.matchedAccount ? `Matched: ${row.matchedAccount.friendlyName}` : 'New description', pillClass: 'pill-included' };
  }

  // Rows the same-day/same-amount check should look at -- whatever would actually get
  // imported, i.e. not rule-skipped and still checked "include" by the user.
  const includedIndexes = useMemo(() => {
    if (!preview) return [];
    return preview.map((_row, idx) => idx).filter((idx) => !preview[idx].matchedRule && overrides[idx]?.include);
  }, [preview, overrides]);

  // Distinct raw descriptions among rows that would actually import but didn't match an
  // existing account -- one resolution decision per description, not per row, since a
  // statement commonly has several rows sharing one description.
  const unmatchedToResolve = useMemo(() => {
    if (!preview) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    includedIndexes.forEach((idx) => {
      const row = preview[idx];
      if (!row.matchedAccount && !seen.has(row.description)) {
        seen.add(row.description);
        out.push(row.description);
      }
    });
    return out;
  }, [preview, includedIndexes]);

  const hasUnresolvedChoice = unmatchedToResolve.some((desc) => {
    const r = resolutions[desc] ?? defaultResolution(desc);
    return r.mode === 'existing' ? !r.accountId : !r.friendlyName.trim();
  });

  const currentCollisions = useMemo(
    () => (preview ? findSameDayAmountCollisions(includedIndexes.map((idx) => preview[idx]), existingTransactions) : []),
    [preview, includedIndexes, existingTransactions]
  );

  // Surface collisions in the preview table itself, not just as a gate at Import time --
  // c.rows holds positions into includedIndexes (the filtered subset), so map back through
  // it to get the actual preview row index each collision applies to.
  const collisionRowIndexes = useMemo(() => {
    const set = new Set<number>();
    currentCollisions.forEach((c) => c.rows.forEach((localIdx) => set.add(includedIndexes[localIdx])));
    return set;
  }, [currentCollisions, includedIndexes]);

  function handleImport() {
    if (!preview || !fileName || hasUnresolvedChoice) return;

    if (currentCollisions.length > 0 && !pendingCollisions) {
      setPendingCollisions(currentCollisions);
      return;
    }

    void commitImport();
  }

  async function commitImport() {
    if (!preview || !fileName) return;
    setImporting(true);
    setError(null);

    try {
      const inputs: CreateTransactionInput[] = [];
      let importedCount = 0;
      let skippedCount = 0;
      // One account/alias gets created per distinct new description, not per row.
      const resolvedAccountIds = new Map<string, string>();

      for (let i = 0; i < preview.length; i++) {
        const row = preview[i];

        // Rows matching an exclusion rule are never imported -- no override.
        if (row.matchedRule) {
          skippedCount++;
          continue;
        }

        const override = overrides[i];
        if (!override.include) {
          skippedCount++;
          continue;
        }

        let accountId: string | null = row.matchedAccount?.id ?? null;
        if (!accountId) {
          if (resolvedAccountIds.has(row.description)) {
            accountId = resolvedAccountIds.get(row.description)!;
          } else {
            const resolution = resolutions[row.description] ?? defaultResolution(row.description);
            if (resolution.mode === 'existing' && resolution.accountId) {
              accountId = resolution.accountId;
              await window.electronAPI.accountAliases.create(accountId, row.description);
            } else {
              const friendlyName = resolution.friendlyName.trim() || row.description;
              const account = await window.electronAPI.accounts.create({ friendlyName });
              await window.electronAPI.accountAliases.create(account.id, row.description);
              accountId = account.id;
            }
            resolvedAccountIds.set(row.description, accountId);
          }
        }

        const autoObligation =
          autoAllocateObligations && accountId
            ? obligations.find((o) => o.accountId === accountId && o.autoAllocate)
            : undefined;

        inputs.push({
          accountId,
          date: row.date,
          description: row.description,
          refCheck: row.refCheck,
          amount: row.amount,
          memo: row.memo,
          category: row.category,
          obligationId: autoObligation?.id ?? null,
        });
        importedCount++;
      }

      const batch = await window.electronAPI.importBatches.create({
        fileName,
        rowCount: preview.length,
        includedCount: importedCount,
        excludedCount: skippedCount,
      });

      const created = await window.electronAPI.transactions.createBulk(
        inputs.map((i) => ({ ...i, importBatchId: batch.id }))
      );

      setResult({ imported: importedCount, skipped: skippedCount });
      setPreview(null);
      setOverrides([]);
      setExistingTransactions([]);
      setAccounts([]);
      setResolutions({});
      setObligations([]);
      setPendingCollisions(null);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

      // Post-commit, never automatic -- the newly-created real transactions are already safe
      // and saved regardless of what happens here. This only surfaces candidates for the user
      // to explicitly confirm or skip; nothing gets linked without that click.
      if (created.length > 0 && recurringBills.some((b) => b.active)) {
        const candidates = await window.electronAPI.recurringBills.findCandidateMatches(created.map((tx) => tx.id));
        setPendingBillMatches(candidates.length > 0 ? candidates : null);
        const defaults: Record<string, string> = {};
        candidates.forEach((c) => {
          if (c.candidateBillIds.length === 1) defaults[c.transactionId] = c.candidateBillIds[0];
        });
        setBillChoices(defaults);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function billLabel(id: string): string {
    return recurringBills.find((b) => b.id === id)?.label ?? '(unknown bill)';
  }

  function chooseBill(transactionId: string, billId: string) {
    setBillChoices((prev) => ({ ...prev, [transactionId]: billId }));
  }

  async function confirmBillMatch(transactionId: string) {
    const billId = billChoices[transactionId];
    if (!billId) return;
    setConfirmingBillTx(transactionId);
    try {
      await window.electronAPI.transactions.update(transactionId, { recurringBillId: billId });
      setPendingBillMatches((prev) => {
        const next = (prev ?? []).filter((c) => c.transactionId !== transactionId);
        return next.length > 0 ? next : null;
      });
    } finally {
      setConfirmingBillTx(null);
    }
  }

  function skipBillMatch(transactionId: string) {
    setPendingBillMatches((prev) => {
      const next = (prev ?? []).filter((c) => c.transactionId !== transactionId);
      return next.length > 0 ? next : null;
    });
  }

  const importableCount = preview
    ? preview.reduce((sum, row, idx) => sum + (!row.matchedRule && overrides[idx]?.include ? 1 : 0), 0)
    : 0;

  return (
    <div>
      <div className="page-header">
        <h1>Import Statement</h1>
      </div>

      <div className="tab-bar">
        <button
          className={`tab-button${activeTab === 'import' ? ' active' : ''}`}
          onClick={() => setActiveTab('import')}
        >
          Import
        </button>
        <button
          className={`tab-button${activeTab === 'rules' ? ' active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          Rules
        </button>
      </div>

      {activeTab === 'rules' ? (
        <Rules />
      ) : (
        <>
      <div className="card">
        <div className="field" style={{ maxWidth: 420 }}>
          <label>Checking Account CSV Export</label>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} />
        </div>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Expected columns: Date, Ref/Check, Description, Amount, Balance, Memo, Category — same shape as the bank
          portal export. Rows matching an active import rule are skipped automatically and never stored.
        </p>
      </div>

      {error && (
        <div className="card" style={{ marginTop: 16, color: 'var(--color-accent-red)' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          Imported {result.imported} transaction{result.imported === 1 ? '' : 's'} ({result.skipped} skipped).{' '}
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            View Transactions
          </button>
        </div>
      )}

      {pendingBillMatches && pendingBillMatches.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>
            Recurring Bill matches ({pendingBillMatches.length})
          </h2>
          <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
            These imported transactions look like they might satisfy a Recurring Bill you've pencilled in. Nothing is
            linked automatically — confirm each one you want to mark satisfied, or skip it.
          </p>
          {pendingBillMatches.map((c) => (
            <div
              key={c.transactionId}
              style={{ borderTop: '1px solid var(--color-primary-action-hover)', padding: '12px 0' }}
            >
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>{c.transactionDescription}</strong> — {formatCurrency(c.transactionAmount)} on{' '}
                {formatDate(c.transactionDate)}
              </div>
              {c.candidateBillIds.length === 1 ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400 }}>
                  <input
                    type="radio"
                    name={`bill-match-${c.transactionId}`}
                    checked={billChoices[c.transactionId] === c.candidateBillIds[0]}
                    onChange={() => chooseBill(c.transactionId, c.candidateBillIds[0])}
                  />
                  This is "{billLabel(c.candidateBillIds[0])}"
                </label>
              ) : (
                <div>
                  <p className="text-muted" style={{ fontSize: 12, margin: '0 0 4px' }}>
                    More than one bill could match — pick the right one:
                  </p>
                  {c.candidateBillIds.map((billId) => (
                    <label
                      key={billId}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400 }}
                    >
                      <input
                        type="radio"
                        name={`bill-match-${c.transactionId}`}
                        checked={billChoices[c.transactionId] === billId}
                        onChange={() => chooseBill(c.transactionId, billId)}
                      />
                      {billLabel(billId)}
                    </label>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => skipBillMatch(c.transactionId)}>
                  Skip
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!billChoices[c.transactionId] || confirmingBillTx === c.transactionId}
                  onClick={() => void confirmBillMatch(c.transactionId)}
                >
                  {confirmingBillTx === c.transactionId ? 'Confirming…' : 'Confirm Match'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && unmatchedToResolve.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>New Account Descriptions ({unmatchedToResolve.length})</h2>
          <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
            These statement descriptions didn't match any existing account. For each, either confirm it's genuinely
            new, or map it to an account you already have — either way, this exact description will auto-match on
            every future import from now on.
          </p>
          {unmatchedToResolve.map((desc) => {
            const resolution = resolutions[desc] ?? defaultResolution(desc);
            return (
              <div key={desc} style={{ borderTop: '1px solid var(--color-primary-action-hover)', padding: '12px 0' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{desc}</div>
                <div className="grid-2">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400 }}>
                    <input
                      type="radio"
                      name={`resolution-${desc}`}
                      checked={resolution.mode === 'new'}
                      onChange={() => updateResolution(desc, { mode: 'new' })}
                    />
                    Create new account
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400 }}>
                    <input
                      type="radio"
                      name={`resolution-${desc}`}
                      checked={resolution.mode === 'existing'}
                      onChange={() => updateResolution(desc, { mode: 'existing' })}
                    />
                    Map to existing account
                  </label>
                </div>
                {resolution.mode === 'new' ? (
                  <input
                    value={resolution.friendlyName}
                    onChange={(e) => updateResolution(desc, { friendlyName: e.target.value })}
                    style={{ marginTop: 8 }}
                    placeholder="Friendly name"
                  />
                ) : (
                  <select
                    value={resolution.accountId}
                    onChange={(e) => updateResolution(desc, { accountId: e.target.value })}
                    style={{ marginTop: 8 }}
                  >
                    <option value="">Select an account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.friendlyName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}

      {preview && pendingCollisions && pendingCollisions.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--color-accent-red)' }}>
          <h2 style={{ fontSize: 15, marginTop: 0, color: 'var(--color-accent-red)' }}>
            Possible duplicate{pendingCollisions.length === 1 ? '' : 's'} found
          </h2>
          <p className="text-muted" style={{ fontSize: 13 }}>
            The same amount shows up more than once on the same day (even across different accounts) — this can be a
            real duplicate that got mis-tagged. Review below, then confirm these are genuinely separate transactions
            to proceed.
          </p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13 }}>
            {pendingCollisions.map((c, i) => (
              <li key={i}>
                {formatCurrency(c.amount)} on {formatDate(c.date)} — {c.rows.length} row{c.rows.length === 1 ? '' : 's'}{' '}
                in this import
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setPendingCollisions(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={importing} onClick={() => void commitImport()}>
              {importing ? 'Importing…' : 'Confirm — Not Duplicates, Import Anyway'}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div style={{ padding: '16px 16px 0' }}>
            <div className="page-header" style={{ marginBottom: 8 }}>
              <h1 style={{ fontSize: 16 }}>
                Preview — {preview.length} row{preview.length === 1 ? '' : 's'}
              </h1>
              <button
                className="btn btn-primary"
                disabled={importing || hasUnresolvedChoice || Boolean(pendingCollisions && pendingCollisions.length > 0)}
                onClick={handleImport}
                title={hasUnresolvedChoice ? 'Resolve the new account descriptions above first' : undefined}
              >
                {importing ? 'Importing…' : `Import ${importableCount} Transactions`}
              </button>
            </div>
            {obligations.some((o) => o.accountId && o.autoAllocate) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={autoAllocateObligations}
                  onChange={(e) => setAutoAllocateObligations(e.target.checked)}
                />
                Auto-allocate these transactions to their linked obligations
              </label>
            )}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row, idx) => {
                const status = statusFor(row);
                const override = overrides[idx];
                const skippedByRule = Boolean(row.matchedRule);
                const hasCollision = collisionRowIndexes.has(idx);
                return (
                  <tr key={idx} style={skippedByRule ? { opacity: 0.5 } : undefined}>
                    <td>
                      {!skippedByRule && (
                        <input
                          type="checkbox"
                          checked={override.include}
                          onChange={(e) => updateOverride(idx, { include: e.target.checked })}
                        />
                      )}
                    </td>
                    <td>{formatDate(row.date)}</td>
                    <td>{row.description}</td>
                    <td>
                      {skippedByRule ? (
                        '—'
                      ) : row.matchedAccount ? (
                        row.matchedAccount.friendlyName
                      ) : (
                        <span className="text-muted">see "New Account Descriptions" above</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} className={row.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                      {formatCurrency(row.amount)}
                    </td>
                    <td>
                      <span className={`pill ${status.pillClass}`}>{status.label}</span>
                      {hasCollision && (
                        <span className="pill pill-collision" style={{ marginLeft: 6 }}>
                          Same-day/amount match
                        </span>
                      )}
                      {autoAllocateObligations &&
                        row.matchedAccount &&
                        obligations.some((o) => o.accountId === row.matchedAccount!.id && o.autoAllocate) && (
                          <span className="pill pill-included" style={{ marginLeft: 6 }}>
                            → obligation
                          </span>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}
