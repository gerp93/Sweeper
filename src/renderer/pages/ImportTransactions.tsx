import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ParsedImportRow, parseStatementCSV } from '../utils/csvParser';
import { CreateTransactionInput } from '../../shared/types/transaction';
import { formatCurrency, formatDate } from '../utils/format';
import Rules from './Rules';

interface RowOverride {
  include: boolean;
  friendlyName: string;
}

export default function ImportTransactions() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedImportRow[] | null>(null);
  const [overrides, setOverrides] = useState<RowOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'import' | 'rules'>('import');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);

    try {
      const text = await file.text();
      const [rules, accounts, existingTransactions] = await Promise.all([
        window.electronAPI.importRules.getAll(),
        window.electronAPI.accounts.getAll(),
        window.electronAPI.transactions.getAll(),
      ]);

      const rows = parseStatementCSV(text, rules, accounts, existingTransactions);
      setPreview(rows);
      setOverrides(rows.map((r) => ({ include: r.include, friendlyName: r.suggestedFriendlyName })));
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPreview(null);
    }
  }

  function updateOverride(idx: number, patch: Partial<RowOverride>) {
    setOverrides((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)));
  }

  function statusFor(row: ParsedImportRow): { label: string; pillClass: string } {
    if (row.matchedRule) {
      return { label: `Skipped — rule: ${row.matchedRule.pattern}`, pillClass: 'pill-excluded' };
    }
    if (row.isDuplicate) {
      return { label: 'Duplicate', pillClass: 'pill-duplicate' };
    }
    return { label: row.matchedAccount ? `Matched: ${row.matchedAccount.friendlyName}` : 'New account', pillClass: 'pill-included' };
  }

  async function handleImport() {
    if (!preview || !fileName) return;
    setImporting(true);
    setError(null);

    try {
      const inputs: CreateTransactionInput[] = [];
      let importedCount = 0;
      let skippedCount = 0;

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
          const friendlyName = override.friendlyName.trim() || row.description;
          const account = await window.electronAPI.accounts.findOrCreate(row.description, friendlyName);
          accountId = account.id;
        }

        inputs.push({
          accountId,
          date: row.date,
          description: row.description,
          refCheck: row.refCheck,
          amount: row.amount,
          memo: row.memo,
          category: row.category,
        });
        importedCount++;
      }

      const batch = await window.electronAPI.importBatches.create({
        fileName,
        rowCount: preview.length,
        includedCount: importedCount,
        excludedCount: skippedCount,
      });

      await window.electronAPI.transactions.createBulk(inputs.map((i) => ({ ...i, importBatchId: batch.id })));

      setResult({ imported: importedCount, skipped: skippedCount });
      setPreview(null);
      setOverrides([]);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
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
        <div className="card" style={{ marginTop: 16, color: 'var(--negative)' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          Imported {result.imported} transaction{result.imported === 1 ? '' : 's'} ({result.skipped} skipped).{' '}
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            View Dashboard
          </button>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div style={{ padding: '16px 16px 0' }}>
            <div className="page-header" style={{ marginBottom: 8 }}>
              <h1 style={{ fontSize: 16 }}>
                Preview — {preview.length} row{preview.length === 1 ? '' : 's'}
              </h1>
              <button className="btn btn-primary" disabled={importing} onClick={handleImport}>
                {importing ? 'Importing…' : `Import ${importableCount} Transactions`}
              </button>
            </div>
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
                        <input
                          value={override.friendlyName}
                          onChange={(e) => updateOverride(idx, { friendlyName: e.target.value })}
                          style={{
                            padding: '4px 6px',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            width: '100%',
                          }}
                          disabled={!override.include}
                        />
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }} className={row.amount >= 0 ? 'amount-positive' : 'amount-negative'}>
                      {formatCurrency(row.amount)}
                    </td>
                    <td>
                      <span className={`pill ${status.pillClass}`}>{status.label}</span>
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
