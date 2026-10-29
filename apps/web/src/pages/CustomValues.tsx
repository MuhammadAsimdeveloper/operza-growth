import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { EmptyState, PageHeader } from '../components/ui';
import { customValueToken } from '../lib/merge';
import { uid, useStore } from '../lib/store';
import { api } from '../lib/api';
import type { CustomValue } from '../lib/types';

export default function CustomValues() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomValue | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [testText, setTestText] = useState('Welcome {{contact.first_name}} to {{agency.name}}! Support: {{custom_values.support_email}}');
  const [resolvedOutput, setResolvedOutput] = useState('');
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    api.crm.list<CustomValue>('customValues').then((res) => {
      if (res.data && res.data.length > 0) {
        // Sync server records to store
        for (const cv of res.data) {
          if (!state.customValues.some((x) => x.id === cv.id)) {
            dispatch({ type: 'customValue/add', customValue: cv });
          }
        }
      }
    }).catch(() => { /* offline dev fallback */ });
  }, []);

  const copy = async (value: CustomValue) => {
    try {
      await navigator.clipboard.writeText(customValueToken(value.name));
      setCopied(value.id);
      window.setTimeout(() => setCopied((current) => (current === value.id ? null : current)), 1600);
    } catch {
      /* clipboard blocked — the token stays selectable */
    }
  };

  const handleTestResolve = async () => {
    setResolving(true);
    try {
      const res = await api.customValues.resolve(testText, state.contacts[0]?.id);
      setResolvedOutput(res.resolvedText);
    } catch {
      setResolvedOutput(testText);
    } finally {
      setResolving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.crm.delete('customValues', id);
    } catch { /* dev fallback */ }
    dispatch({ type: 'customValue/delete', id });
  };

  return (
    <div className="content">
      <PageHeader
        title="Custom Values"
        subtitle="Reusable fields you can drop into emails, funnels and automations with a merge token."
        actions={
          <button className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> New value
          </button>
        }
      />

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">Workspace values</div>
            <div className="card__sub">{state.customValues.length} values</div>
          </div>
        </div>

        {state.customValues.length === 0 ? (
          <EmptyState
            icon={<Icon name="sliders" size={22} />}
            title="No custom values"
            text="Store things like your business name or booking link once, then reuse them everywhere."
            action={
              <button className="btn btn--sm" onClick={() => setCreating(true)}>
                New value
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Merge token</th>
                  <th>Value</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {state.customValues.map((value) => (
                  <tr key={value.id}>
                    <td className="cell-main">{value.name}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <span className="mono-cell" style={{ color: 'var(--text-2)' }}>
                          {customValueToken(value.name)}
                        </span>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Copy token for ${value.name}`}
                          onClick={() => copy(value)}
                        >
                          <Icon name={copied === value.id ? 'check' : 'copy'} size={14} />
                        </button>
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{value.value}</td>
                    <td className="cell-right">
                      <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button className="icon-btn" aria-label={`Edit ${value.name}`} onClick={() => setEditing(value)}>
                          <Icon name="edit" size={15} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Delete ${value.name}`}
                          onClick={() => handleDelete(value.id)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Live Merge Token Playground</div>
            <div className="card__sub">Test template resolution with workspace values and sample contact fields</div>
          </div>
        </div>
        <div className="card__body stack" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="test-template">Template Text</label>
            <textarea
              id="test-template"
              className="input textarea"
              rows={2}
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn--primary" type="button" disabled={resolving} onClick={handleTestResolve}>
              <Icon name="play" size={14} /> {resolving ? 'Resolving...' : 'Resolve Merge Tokens'}
            </button>
          </div>
          {resolvedOutput && (
            <div style={{ background: 'var(--surface-sunken)', padding: 12, borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div className="cell-sub" style={{ marginBottom: 4 }}>Resolved Result:</div>
              <div style={{ fontWeight: 500, color: 'var(--text-1)' }}>{resolvedOutput}</div>
            </div>
          )}
        </div>
      </div>

      <div className="hint" style={{ marginTop: 10 }}>
        Merge tokens resolve at send time, so editing a value updates every email and page that references it.
      </div>

      {(creating || editing) && (
        <CustomValueModal
          value={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (next) => {
            if (editing) {
              try {
                await api.crm.update('customValues', editing.id, next);
              } catch { /* dev fallback */ }
              dispatch({ type: 'customValue/update', id: editing.id, patch: next });
            } else {
              const newId = uid('cv');
              try {
                const res = await api.crm.create<CustomValue>('customValues', next);
                if (res && res.id) {
                  dispatch({ type: 'customValue/add', customValue: { ...next, id: res.id } });
                  setCreating(false);
                  setEditing(null);
                  return;
                }
              } catch { /* dev fallback */ }
              dispatch({ type: 'customValue/add', customValue: { ...next, id: newId } });
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CustomValueModal({
  value,
  onClose,
  onSave,
}: {
  value?: CustomValue;
  onClose: () => void;
  onSave: (value: Omit<CustomValue, 'id'>) => void;
}) {
  const [name, setName] = useState(value?.name ?? '');
  const [body, setBody] = useState(value?.value ?? '');

  const canSave = name.trim().length >= 2 && body.trim().length > 0;

  return (
    <Modal
      title={value ? `Edit ${value.name}` : 'New custom value'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!canSave}
            onClick={() => onSave({ name: name.trim(), value: body.trim() })}
          >
            {value ? 'Save changes' : 'Add value'}
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="cv-name">Name</label>
        <input
          id="cv-name"
          className="input"
          autoFocus
          placeholder="Support email"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="cell-sub" style={{ marginTop: 4 }}>
          Token: {customValueToken(name || 'value')}
        </div>
      </div>
      <div className="field">
        <label htmlFor="cv-body">Value</label>
        <input
          id="cv-body"
          className="input"
          placeholder="hello@agency.test"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
    </Modal>
  );
}
