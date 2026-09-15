import { useState } from 'react';
import { Account } from '../../shared/types/account';
import { AccountAlias } from '../../shared/types/accountAlias';

interface Props {
  account: Account;
  aliases: AccountAlias[];
  onAdd: (rawName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function ManageAliasesForm({ account, aliases, onAdd, onDelete, onClose }: Props) {
  const [newAlias, setNewAlias] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed);
      setNewAlias('');
    } catch (err: any) {
      const message = String(err?.message ?? err);
      setError(
        message.includes('UNIQUE constraint failed')
          ? 'Another account already has that raw description as an alias.'
          : `Couldn't add alias: ${message}`
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Aliases — {account.friendlyName}</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Every raw bank description listed here will match to this account on future imports.
        </p>

        {aliases.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            No aliases yet — this account won't match anything on import until it has at least one.
          </p>
        ) : (
          <table className="data-table">
            <tbody>
              {aliases.map((a) => (
                <tr key={a.id}>
                  <td>{a.rawName}</td>
                  <td style={{ width: 1 }}>
                    <div className="ledger-actions">
                      <button className="btn-link btn-link-danger" onClick={() => onDelete(a.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>Add Alias (exact raw bank description)</label>
          <input
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            placeholder="e.g. CITI AUTOPAY PAYMENT"
          />
        </div>

        {error && <p style={{ color: 'var(--color-accent-red)', fontSize: 13 }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!newAlias.trim() || saving} onClick={handleAdd}>
            {saving ? 'Adding…' : 'Add Alias'}
          </button>
        </div>
      </div>
    </div>
  );
}
