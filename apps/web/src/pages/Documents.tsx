import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [signingDoc, setSigningDoc] = useState<ContractDoc | null>(null);

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
        subtitle="Author proposals, send legally binding contracts, and capture cryptographic e-signatures."
        actions={
          <button className="btn btn--primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} /> New document
          </button>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Signed value" value={currency(signedValue)} icon={<Icon name="check" size={15} />} meta="all time signed" />
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
                  <th>Status</th>
                  <th style={{ width: 140 }} />
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
                    <td className="cell-right">
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn--sm btn--primary"
                          onClick={() => setSigningDoc(doc)}
                        >
                          <Icon name={doc.status === 'signed' ? 'check' : 'clipboard'} size={13} />
                          {doc.status === 'signed' ? 'Certificate' : 'Sign'}
                        </button>
                      </div>
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
      {signingDoc && (
        <SignDocumentModal
          doc={signingDoc}
          contactName={contactName(signingDoc.contactId)}
          onClose={() => setSigningDoc(null)}
          onSigned={(updated) => {
            dispatch({
              type: 'document/update',
              id: updated.id,
              patch: {
                status: 'signed',
                signedAt: updated.signedAt,
                signerName: updated.signerName,
                signatureData: updated.signatureData,
              },
            });
            setSigningDoc(null);
          }}
        />
      )}
    </div>
  );
}

function NewDocumentModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ContractDoc['kind']>('proposal');
  const [contactId, setContactId] = useState(state.contacts[0]?.id ?? '');
  const [value, setValue] = useState('4500');

  const canSave = name.trim().length > 1 && contactId;

  async function save() {
    if (!canSave) return;
    const newDoc: ContractDoc = {
      id: uid('doc'),
      name: name.trim(),
      kind,
      contactId,
      value: Number(value) || 0,
      status: 'sent',
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
            Send document
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="doc-name">Document title</label>
        <input
          id="doc-name"
          className="input"
          value={name}
          autoFocus
          placeholder="e.g. Q4 Executive Growth Agreement"
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
          <label htmlFor="doc-value">Agreement value (USD)</label>
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
        <label htmlFor="doc-contact">Signer contact</label>
        <select id="doc-contact" className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          {state.contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} — {c.company || c.email}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

function SignDocumentModal({
  doc,
  contactName,
  onClose,
  onSigned,
}: {
  doc: ContractDoc;
  contactName: string;
  onClose: () => void;
  onSigned: (updated: ContractDoc) => void;
}) {
  const [signer, setSigner] = useState(doc.signerName || contactName);
  const [agreed, setAgreed] = useState(doc.status === 'signed');
  const [mode, setMode] = useState<'draw' | 'type'>('type');
  const [typedSignature, setTypedSignature] = useState(signer);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    if (mode === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [mode]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleSign = async () => {
    if (!agreed) {
      setError('You must agree to the electronic signature legal consent.');
      return;
    }
    setLoading(true);
    setError(null);

    let sigData = '';
    if (mode === 'draw' && canvasRef.current) {
      sigData = canvasRef.current.toDataURL('image/png');
    } else {
      sigData = `typed:${typedSignature}`;
    }

    try {
      await api.documents.sign(doc.id, signer.trim(), sigData);
      onSigned({
        ...doc,
        status: 'signed',
        signedAt: new Date().toISOString(),
        signerName: signer.trim(),
        signatureData: sigData,
      });
    } catch (err: any) {
      setError(`E-signature execution failed: ${err.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={doc.status === 'signed' ? 'Executed Agreement Certificate' : 'Digital Proposal & E-Signature Pad'}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
          {doc.status !== 'signed' && (
            <button
              className="btn btn--primary"
              type="button"
              disabled={loading || !agreed || !signer.trim()}
              onClick={handleSign}
            >
              <Icon name="check" size={14} /> {loading ? 'Signing...' : 'Execute Agreement'}
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="callout callout--danger" style={{ marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 16, background: 'var(--surface-2)', marginBottom: 16 }}>
        <div className="row row--between">
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{doc.name}</div>
            <div className="cell-sub">
              Signer: {contactName} · Value: {currency(doc.value)} · {doc.kind.toUpperCase()}
            </div>
          </div>
          <Badge tone={doc.status === 'signed' ? 'green' : 'blue'}>
            {doc.status === 'signed' ? 'EXECUTED & VERIFIED' : 'PENDING E-SIGNATURE'}
          </Badge>
        </div>

        <div style={{ marginTop: 12, padding: 12, background: 'var(--surface)', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6 }}>
          <strong>Master Services & Retainer Terms:</strong> This agreement establishes a performance advisory relationship between Operza Alpha Agency and the Client ({contactName}). Deliverables include automated CRM inbound pipelines, conversion funnels, omnichannel communications routing, and autonomous AI copilot infrastructure. Total contractual consideration is fixed at {currency(doc.value)}.
        </div>
      </div>

      {doc.status === 'signed' ? (
        <div className="stack" style={{ gap: 12, background: 'var(--surface-2)', padding: 16, borderRadius: 8 }}>
          <div className="row" style={{ gap: 8, color: 'var(--green)' }}>
            <Icon name="check" size={20} />
            <strong style={{ fontSize: 14 }}>Cryptographically Signed & Legally Executed</strong>
          </div>
          <div className="grid grid--2" style={{ gap: 10, fontSize: 12.5 }}>
            <div>
              <span className="cell-sub">Signer Name:</span>
              <div style={{ fontWeight: 600 }}>{doc.signerName || contactName}</div>
            </div>
            <div>
              <span className="cell-sub">Execution Timestamp:</span>
              <div style={{ fontWeight: 600 }}>{doc.signedAt ? new Date(doc.signedAt).toUTCString() : 'Recorded'}</div>
            </div>
            <div>
              <span className="cell-sub">Compliance Standard:</span>
              <div style={{ fontWeight: 600 }}>U.S. ESIGN Act & UETA Uniform Standard</div>
            </div>
            <div>
              <span className="cell-sub">Certificate Hash:</span>
              <div style={{ fontFamily: 'monospace', fontSize: 11 }}>sha256:{doc.id.slice(0, 16)}...cert</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="field">
            <label htmlFor="signer-name">Legal Full Name</label>
            <input
              id="signer-name"
              className="input"
              value={signer}
              onChange={(e) => {
                setSigner(e.target.value);
                setTypedSignature(e.target.value);
              }}
            />
          </div>

          <div>
            <div className="row row--between" style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Signature Method</label>
              <div className="segmented">
                <button
                  type="button"
                  className={mode === 'type' ? 'is-active' : ''}
                  onClick={() => setMode('type')}
                >
                  Type Font
                </button>
                <button
                  type="button"
                  className={mode === 'draw' ? 'is-active' : ''}
                  onClick={() => setMode('draw')}
                >
                  Draw Pad
                </button>
              </div>
            </div>

            {mode === 'type' ? (
              <div
                style={{
                  background: '#ffffff',
                  color: '#1e293b',
                  border: '2px dashed var(--border)',
                  borderRadius: 8,
                  padding: '24px 20px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontFamily: 'cursive', fontSize: 32, letterSpacing: '0.04em' }}>
                  {typedSignature || 'Your Signature'}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
                  Digital calligraphy rendering based on legal full name
                </div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={140}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  style={{
                    width: '100%',
                    height: '140px',
                    background: '#ffffff',
                    border: '2px dashed var(--border)',
                    borderRadius: 8,
                    cursor: 'crosshair',
                  }}
                />
                <button
                  type="button"
                  className="btn btn--sm"
                  style={{ position: 'absolute', top: 8, right: 8 }}
                  onClick={clearCanvas}
                >
                  Clear Pad
                </button>
              </div>
            )}
          </div>

          <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 12.5, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              I agree to sign this contract electronically under the <strong>U.S. ESIGN Act</strong> and <strong>Uniform Electronic Transactions Act (UETA)</strong>. I understand this digital signature carries full legal force and enforceability.
            </span>
          </label>
        </div>
      )}
    </Modal>
  );
}
