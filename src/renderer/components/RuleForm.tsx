import { useState } from 'react';
import { CreateImportRuleInput, ImportRule, RuleField, RuleMatchType } from '../../shared/types/importRule';

interface Props {
  rule?: ImportRule;
  onSave: (input: CreateImportRuleInput) => void;
  onCancel: () => void;
}

export default function RuleForm({ rule, onSave, onCancel }: Props) {
  const [field, setField] = useState<RuleField>(rule?.field ?? 'description');
  const [matchType, setMatchType] = useState<RuleMatchType>(rule?.matchType ?? 'contains');
  const [pattern, setPattern] = useState(rule?.pattern ?? '');
  const [isActive, setIsActive] = useState(rule?.isActive ?? true);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{rule ? 'Edit Rule' : 'New Import Rule'}</h2>
        <div className="grid-2">
          <div className="field">
            <label>Field</label>
            <select value={field} onChange={(e) => setField(e.target.value as RuleField)}>
              <option value="description">Description</option>
              <option value="memo">Memo</option>
            </select>
          </div>
          <div className="field">
            <label>Match Type</label>
            <select value={matchType} onChange={(e) => setMatchType(e.target.value as RuleMatchType)}>
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="startsWith">Starts With</option>
              <option value="endsWith">Ends With</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>Pattern</label>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. LNS ADV FRM" autoFocus />
        </div>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <label htmlFor="rule-active" style={{ textTransform: 'none', fontSize: 14 }}>
            Active
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!pattern.trim()}
            onClick={() => onSave({ field, matchType, pattern: pattern.trim(), isActive })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
