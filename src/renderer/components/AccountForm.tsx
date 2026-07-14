import { useState } from 'react';
import { Account } from '../../shared/types/account';

interface Props {
  account: Account;
  onSave: (friendlyName: string) => void;
  onCancel: () => void;
}

export default function AccountForm({ account, onSave, onCancel }: Props) {
  const [friendlyName, setFriendlyName] = useState(account.friendlyName);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Rename Account</h2>
        <div className="field">
          <label>Raw Bank Description</label>
          <input value={account.rawName} disabled />
        </div>
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
            disabled={!friendlyName.trim()}
            onClick={() => onSave(friendlyName.trim())}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
