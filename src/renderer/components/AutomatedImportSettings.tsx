import { useEffect, useState } from 'react';
import { SimplefinStatus, SimplefinSyncResult } from '../../shared/types/simplefinStatus';

function formatWhen(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function describeResult(r: SimplefinSyncResult): string {
  if (!r.ok) return r.messages[0] ?? 'The sync failed.';
  const parts = [`${r.imported} new transaction${r.imported === 1 ? '' : 's'} imported`];
  if (r.alreadyImported > 0) parts.push(`${r.alreadyImported} already imported by hand`);
  if (r.excludedByRule > 0) parts.push(`${r.excludedByRule} skipped by import rules`);
  return parts.join(', ') + '.';
}

export default function AutomatedImportSettings() {
  const [status, setStatus] = useState<SimplefinStatus | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
    const unsubscribe = window.electronAPI.simplefin.onSyncFinished(() => void refresh());
    return unsubscribe;
  }, []);

  async function refresh() {
    try {
      setStatus(await window.electronAPI.simplefin.getStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function cleanError(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    // Electron prefixes IPC errors with "Error invoking remote method '...': Error: ".
    return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  async function handleConnect() {
    setBusy('connect');
    setError(null);
    try {
      const next = await window.electronAPI.simplefin.connect(token);
      setToken('');
      setStatus(next);
      if (next.selectedAccountIds.length > 0) {
        setBusy('sync');
        await window.electronAPI.simplefin.syncNow();
        await refresh();
      }
    } catch (err) {
      setError(cleanError(err));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleSyncNow() {
    setBusy('sync');
    setError(null);
    try {
      await window.electronAPI.simplefin.syncNow();
      await refresh();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        'Disconnect automated import? Sweeper forgets the connection; transactions already imported stay. To cut off access completely, also delete this app connection at SimpleFIN Bridge.'
      )
    )
      return;
    setBusy('disconnect');
    setError(null);
    try {
      setStatus(await window.electronAPI.simplefin.disconnect());
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAccount(id: string, checked: boolean) {
    if (!status) return;
    const ids = checked
      ? [...new Set([...status.selectedAccountIds, id])]
      : status.selectedAccountIds.filter((x) => x !== id);
    setStatus(await window.electronAPI.simplefin.setSelectedAccounts(ids));
  }

  if (!status) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Automated import (SimpleFIN Bridge)</h2>
      <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
        Pulls new bank transactions in every time Sweeper opens, using the same import rules and account names as the
        CSV import. Manual import still works as a fallback.
      </p>

      {!status.connected && (
        <>
          {!status.secureStorageAvailable && (
            <p className="amount-negative" style={{ fontSize: 13 }}>
              This computer has no secure place to keep the connection (no system keychain), so automated import can't
              be turned on here.
            </p>
          )}
          <p style={{ fontSize: 13 }}>
            In SimpleFIN Bridge, connect your bank, then create a new app connection and copy its setup token. Paste it
            here once. A setup token works only one time.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Setup token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 1, maxWidth: 480 }}
              disabled={busy !== null || !status.secureStorageAvailable}
            />
            <button
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={busy !== null || !token.trim() || !status.secureStorageAvailable}
            >
              {busy === 'connect' ? 'Connecting…' : busy === 'sync' ? 'Importing…' : 'Connect'}
            </button>
          </div>
        </>
      )}

      {status.connected && (
        <>
          <table style={{ fontSize: 13, marginBottom: 12 }}>
            <tbody>
              <tr>
                <td className="text-muted" style={{ paddingRight: 16 }}>Status</td>
                <td>
                  {status.syncing || busy === 'sync'
                    ? 'Importing…'
                    : status.selectedAccountIds.length === 0
                      ? 'Connected. Choose an account below.'
                      : 'Connected. Imports when Sweeper opens.'}
                </td>
              </tr>
              <tr>
                <td className="text-muted" style={{ paddingRight: 16 }}>Last successful import</td>
                <td>{formatWhen(status.lastSuccessAt)}</td>
              </tr>
              {status.lastResult && (
                <tr>
                  <td className="text-muted" style={{ paddingRight: 16 }}>Last result</td>
                  <td className={status.lastResult.ok ? '' : 'amount-negative'}>
                    {describeResult(status.lastResult)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {status.lastResult?.ok && status.lastResult.messages.length > 0 && (
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              <div className="text-muted">Your bank connection reported:</div>
              <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {status.lastResult.messages.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          {status.accounts.length > 0 && (
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              <div className="text-muted" style={{ marginBottom: 4 }}>Import from</div>
              {status.accounts.map((a) => (
                <label key={a.id} style={{ display: 'block', marginBottom: 2 }}>
                  <input
                    type="checkbox"
                    checked={status.selectedAccountIds.includes(a.id)}
                    onChange={(e) => void toggleAccount(a.id, e.target.checked)}
                    disabled={busy !== null}
                  />{' '}
                  {a.name}
                  {a.orgName ? <span className="text-muted"> ({a.orgName})</span> : null}
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleSyncNow}
              disabled={busy !== null || status.syncing || status.selectedAccountIds.length === 0}
            >
              {busy === 'sync' || status.syncing ? 'Importing…' : 'Sync now'}
            </button>
            <button className="btn" onClick={handleDisconnect} disabled={busy !== null}>
              Disconnect
            </button>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            SimpleFIN allows about 24 refreshes a day, so opening Sweeper again within an hour of the last import
            doesn't import again. Use Sync now for that.
          </p>
        </>
      )}

      {error && (
        <p className="amount-negative" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
          {error}
        </p>
      )}
    </div>
  );
}
