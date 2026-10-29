import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatCard } from '../components/ui';
import { uid, useStore } from '../lib/store';
import { currency, num, relative, shortDate } from '../lib/format';
import { api } from '../lib/api';
import type { ContractDoc } from '../lib/types';

const KIND_META = {
  proposal: { label: 'Proposal', icon: 'file' },
  contract: { label: 'Contract', icon: 'clipboard' },
  estimate: { label: 'Estimate', icon: 'dollar' },
} as const;

const STATUS_TONE = {
  draft: 'default',
  sent: 'blue',
  signed: 'green',
  declined: 'red',
} as const;

type Filter = 'all' | ContractDoc['status'];

export default function Documents() {
  const { state, dispatch } = useStore();
  const { documents } = state;
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.crm.list<ContractDoc>('documents').then((res) => {
      if (res.data && res.data.length > 0) {
        for (const doc of res.data) {
          if (!documents.some((x) => x.id === doc.id)) {
            dispatch({ type: 'document/add', document: doc });
          }
        }
      }
    }).catch(() => { /* dev fallback */ });
  }, []);

  const handleStatusChange = async (doc: ContractDoc, newStatus: ContractDoc['status']) => {
    dispatch({ type: 'document/status', id: doc.id, status: newStatus });
    try {
      if (newStatus === 'signed') {
        const contact = state.contacts.find((c) => c.id === doc.contactId);
        const signerName = contact ? `${contact.firstName} ${contact.lastName}` : 'Client Signer';
        await api.documents.sign(doc.id, signerName);
      } else {
        await api.crm.update('documents', doc.id, { status: newStatus });
      }
    } catch { /* dev fallback */ }
  };

  const signedValue = documents.filter((d) => d.status === 'signed').reduce((s, d) => s + d.value, 0);
  const pendingValue = documents.filter((d) => d.status === 'sent').reduce((s, d) => s + d.value, 0);
  const draftCount = documents.filter((d) => d.status === 'draft').length;

  const visible = useMemo(
    () => documents.filter((d) => (filter === 'all' ? true : d.status === filter)),
    [documents, filter],
  );

  const contactName = (id: string) => {
    const c = state.contacts.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown contact';
  };

  return (
    <div className="content">
      <PageHeader
        title="Documents & Contracts"
        subtitle="Send proposals and contracts, then track signatures."
        actions={
          <>
            <button className="btn">
              <Icon name="folder" size={15} /> Templates
            </button>
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} /> New document
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Signed value" value={currency(signedValue)} icon={<Icon name="check" size={15} />} meta="all time" />
        <StatCard label="Awaiting signature" value={currency(pendingValue)} icon={<Icon name="clock" size={15} />} meta="sent documents" />
        <StatCard label="Drafts" value={num(draftCount)} icon={<Icon name="file" size={15} />} meta="not sent yet" />
        <StatCard label="Documents" value={num(documents.length)} icon={<Icon name="folder" size={15} />} meta="in this workspace" />
      </div>

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title">All documents</div>
            <div className="card__sub">{visible.length} shown</div>
          </div>
          <div className="card__actions">
            <div className="tabs" style={{ margin: 0 }}>
              {(['all', 'draft', 'sent', 'signed', 'declined'] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`tab${filter === f ? ' is-active' : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="card__body">
            <EmptyState icon={<Icon name="file" size={22} />} title="No documents" text="Create one to get started." />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Contact</th>
                  <th className="cell-right">Value</th>
                  <th>Updated</th>
                  <th style={{ width: 150 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <span className="person">
                        <span className="avatar avatar--sm avatar--square" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          <Icon name={KIND_META[doc.kind].icon} size={14} />
                        </span>
                        <span className="person__text">
                          <span className="person__name">{doc.name}</span>
                          <span className="person__sub">{KIND_META[doc.kind].label}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Avatar name={contactName(doc.contactId)} size="xs" />
                        {contactName(doc.contactId)}
                      </span>
                    </td>
                    <td className="cell-right cell-num">{currency(doc.value)}</td>
                    <td className="cell-sub" title={relative(doc.updatedAt)}>
                      {shortDate(doc.updatedAt)}
                    </td>
                    <td>
                      <select
                        className="select select--sm"
                        value={doc.status}
                        aria-label={`Status for ${doc.name}`}
                        onChange={(e) => handleStatusChange(doc, e.target.value as ContractDoc['status'])}
                      >
                        <option value="draft">Draft</option>
                        <option value="sent">Sent</option>
                        <option value="signed">Signed</option>
                        <option value="declined">Declined</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid--3" style={{ marginTop: 16 }}>
        {(['proposal', 'contract', 'estimate'] as const).map((kind) => {
          const items = documents.filter((d) => d.kind === kind);
          return (
            <div key={kind} className="card">
              <div className="card__head">
                <div className="card__title">{KIND_META[kind].label}s</div>
                <div className="card__actions">
                  <Badge>{items.length}</Badge>
                </div>
              </div>
              <div className="card__body stack" style={{ gap: 10 }}>
                {items.slice(0, 3).map((d) => (
                  <div key={d.id} className="row row--between" style={{ gap: 10 }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{d.name}</span>
                      <span className="cell-sub">{currency(d.value)}</span>
                    </span>
                    <Badge tone={STATUS_TONE[d.status]} dot>
                      {d.status}
                    </Badge>
                  </div>
                ))}
                {items.length === 0 && <div className="cell-sub">Nothing here yet.</div>}
              </div>
            </div>
          );
        })}
      </div>

      {adding && <NewDocumentModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewDocumentModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ContractDoc['kind']>('proposal');
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [value, setValue] = useState('2500');

  const canSave = name.trim().length > 1 && contactId;

  async function save() {
    if (!canSave) return;
    const newDoc: ContractDoc = {
      id: uid('doc'),
      name: name.trim(),
      kind,
      contactId,
      value: Number(value) || 0,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    };
    try {
      await api.crm.create('documents', {
        name: newDoc.name,
        kind: newDoc.kind,
        value: newDoc.value,
        status: newDoc.status,
        contactId: newDoc.contactId,
      });
    } catch { /* dev fallback */ }
    dispatch({
      type: 'document/add',
      document: newDoc,
    });
    onClose();
  }

  return (
    <Modal
      title="New document"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Create draft
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="doc-name">Document name</label>
        <input
          id="doc-name"
          className="input"
          value={name}
          autoFocus
          placeholder="Website rebuild proposal"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid grid--2" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="doc-kind">Type</label>
          <select id="doc-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value as ContractDoc['kind'])}>
            <option value="proposal">Proposal</option>
            <option value="contract">Contract</option>
            <option value="estimate">Estimate</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="doc-value">Value (USD)</label>
          <input
            id="doc-value"
            className="input"
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="doc-contact">Contact</label>
        <select id="doc-contact" className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          {state.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} — {c.company}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
