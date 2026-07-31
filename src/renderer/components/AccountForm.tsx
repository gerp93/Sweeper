import { useState } from 'react';
import { Account } from '../../shared/types/account';

interface Props {
  account: Account;
  onSave: (friendlyName: string, rawName: string) => void;
  onCancel: () => void;
}

export default function AccountForm({ account, onSave, onCancel }: Props) {
  const [friendlyName, setFriendlyName] = useState(account.friendlyName);
  const [rawName, setRawName] = useState(account.rawName);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Rename Account</h2>
        <div className="field">
          <label>Raw Bank Description</label>
          <input value={rawName} onChange={(e) => setRawName(e.target.value)} />
        </div>
        <p className="text-muted" style={{ marginTop: -8, fontSize: 12 }}>
          Future imports are matched to this account by the raw description above — changing it means a statement
          line with the old description will create a new account instead of matching this one.
        </p>
        <div className="field">
          <label>Friendly Name</label>
          <input value={friendlyName} onChange={(e) => setFriendlyName(e.target.value)} autoFocus />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!friendlyName.trim() || !rawName.trim()}
            onClick={() => onSave(friendlyName.trim(), rawName.trim())}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
