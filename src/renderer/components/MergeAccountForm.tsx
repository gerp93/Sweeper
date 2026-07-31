import { useState } from 'react';
import { Account } from '../../shared/types/account';

interface Props {
  account: Account;
  otherAccounts: Account[];
  onMerge: (targetId: string, memo: string | null) => void;
  onCancel: () => void;
}

export default function MergeAccountForm({ account, otherAccounts, onMerge, onCancel }: Props) {
  const [targetId, setTargetId] = useState('');
  const [memo, setMemo] = useState('');

  const usingOldName = memo === account.friendlyName;

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
        <div className="field">
          <label>Memo for Moved Transactions (optional)</label>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="e.g. moved from old account"
          />
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 400, marginTop: 6 }}
          >
            <input
              type="checkbox"
              checked={usingOldName}
              onChange={(e) => setMemo(e.target.checked ? account.friendlyName : '')}
              style={{ width: 'auto' }}
            />
            Use old account name ("{account.friendlyName}")
          </label>
        </div>
        <p className="text-muted" style={{ fontSize: 12 }}>
          Only applied to the {account.friendlyName} transactions being moved — transactions already on the target
          account are left as-is. If a moved transaction already has a memo, this is appended after a semicolon.
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!targetId}
            onClick={() => onMerge(targetId, memo.trim() || null)}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}
