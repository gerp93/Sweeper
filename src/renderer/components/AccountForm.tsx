import { useState } from 'react';
import { Account } from '../../shared/types/account';

interface Props {
  // Omitted when creating a new account.
  account?: Account;
  onSave: (friendlyName: string) => void;
  onCancel: () => void;
}

export default function AccountForm({ account, onSave, onCancel }: Props) {
  const [friendlyName, setFriendlyName] = useState(account?.friendlyName ?? '');
  const canSave = friendlyName.trim() !== '';

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{account ? 'Rename Account' : 'Add Account'}</h2>
        <div className="field">
          <label>Friendly Name</label>
          <input
            value={friendlyName}
            onChange={(e) => setFriendlyName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) onSave(friendlyName.trim());
            }}
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!canSave} onClick={() => onSave(friendlyName.trim())}>
            {account ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
