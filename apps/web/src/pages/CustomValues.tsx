import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { EmptyState, PageHeader } from '../components/ui';
import { customValueToken } from '../lib/merge';
import { uid, useStore } from '../lib/store';
import type { CustomValue } from '../lib/types';

export default function CustomValues() {
  const { state, dispatch } = useStore();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CustomValue | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (value: CustomValue) => {
    try {
      await navigator.clipboard.writeText(customValueToken(value.name));
      setCopied(value.id);
      window.setTimeout(() => setCopied((current) => (current === value.id ? null : current)), 1600);
    } catch {
      /* clipboard blocked — the token stays selectable */
    }
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
                          onClick={() => dispatch({ type: 'customValue/delete', id: value.id })}
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
          onSave={(next) => {
            if (editing) {
              dispatch({ type: 'customValue/update', id: editing.id, patch: next });
            } else {
              dispatch({ type: 'customValue/add', customValue: { ...next, id: uid('cv') } });
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
