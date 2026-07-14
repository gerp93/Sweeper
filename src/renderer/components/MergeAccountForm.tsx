import { useState } from 'react';
import { Account } from '../../shared/types/account';

interface Props {
  account: Account;
  otherAccounts: Account[];
  onMerge: (targetId: string) => void;
  onCancel: () => void;
}

export default function MergeAccountForm({ account, otherAccounts, onMerge, onCancel }: Props) {
  const [targetId, setTargetId] = useState('');

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Merge Account</h2>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 13 }}>
          Every transaction on <strong>{account.friendlyName}</strong> will move to the account you pick below, and
          "{account.friendlyName}" will be deleted. This can't be undone.
        </p>
        <div className="field">
          <label>Merge Into</label>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} autoFocus>
            <option value="">Select an account…</option>
            {otherAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.friendlyName}
              </option>
            ))}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!targetId} onClick={() => onMerge(targetId)}>
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
