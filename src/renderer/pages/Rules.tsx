import { useEffect, useState } from 'react';
import { CreateImportRuleInput, ImportRule } from '../../shared/types/importRule';
import RuleForm from '../components/RuleForm';

export default function Rules() {
  const [rules, setRules] = useState<ImportRule[]>([]);
  const [editing, setEditing] = useState<ImportRule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setRules(await window.electronAPI.importRules.getAll());
    setLoading(false);
  }

  async function handleSave(input: CreateImportRuleInput) {
    if (editing) {
      await window.electronAPI.importRules.update(editing.id, input);
    } else {
      await window.electronAPI.importRules.create(input);
    }
    setShowForm(false);
    setEditing(null);
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rule? Transactions already excluded by it will stay excluded until edited manually.')) return;
    await window.electronAPI.importRules.delete(id);
    await load();
  }

  async function toggleActive(rule: ImportRule) {
    await window.electronAPI.importRules.update(rule.id, { isActive: !rule.isActive });
    await load();
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <p className="text-muted" style={{ marginTop: 0, fontSize: 13 }}>
            Rows matching an active rule are automatically excluded during import — this is how the checking/HELOC
            sweep transfers (e.g. <code>LNS ADV FRM</code>, <code>LNS PAY TO</code>) get filtered out so they don't
            count as real spend.
          </p>
          <button
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            + New Rule
          </button>
        </div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : rules.length === 0 ? (
          <div className="empty-state">No rules yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Match</th>
                <th>Pattern</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td style={{ textTransform: 'capitalize' }}>{rule.field}</td>
                  <td>{rule.matchType}</td>
                  <td>
                    <code>{rule.pattern}</code>
                  </td>
                  <td>
                    <span className={`pill ${rule.isActive ? 'pill-included' : 'pill-excluded'}`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" onClick={() => toggleActive(rule)}>
                      {rule.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setEditing(rule);
                        setShowForm(true);
                      }}
                    >
                      Edit
                    </button>
                    <button className="btn btn-danger" onClick={() => handleDelete(rule.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <RuleForm
          rule={editing ?? undefined}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
