import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState } from '../components/ui';
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
  const [viewingDoc, setViewingDoc] = useState<ContractDoc | null>(null);

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
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Legal OS &amp; Contracts</div>
          <h1>Documents &amp; Contracts</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button className="atlas-quick-action-button" onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} /> New Document
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">CONTRACT LIFECYCLE &amp; CRYPTOGRAPHIC E-SIGNATURES</div>
        <h2>Proposals, Estimates, &amp; Legally Binding Agreements</h2>
        <p>Author proposal documents, dispatch legally enforceable contracts, track signer delivery status, and capture immutable cryptographic verification trails.</p>
      </section>

      <section className="atlas-kpis" aria-label="Document metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="check" size={15} /></span>
            <span className="operza-kpi__trend"><Icon name="arrow-up-right" size={12} /> +24%</span>
          </div>
          <div className="atlas-kpi__label">Signed Value</div>
          <div className="atlas-kpi__value tabular">{currency(signedValue)}</div>
          <div className="atlas-kpi__note">Executed revenue</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 16 Q25 12 50 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#10b981', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="clock" size={15} /></span>
            <span className="operza-kpi__trend">Pending</span>
          </div>
          <div className="atlas-kpi__label">Awaiting Signature</div>
          <div className="atlas-kpi__value tabular">{currency(pendingValue)}</div>
          <div className="atlas-kpi__note">{documents.filter(d => d.status === 'sent').length} sent documents</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 14 Q30 8 60 12 T100 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#3b82f6', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="file" size={15} /></span>
            <span className="operza-kpi__trend">Staged</span>
          </div>
          <div className="atlas-kpi__label">Active Drafts</div>
          <div className="atlas-kpi__value tabular">{num(draftCount)}</div>
          <div className="atlas-kpi__note">Authoring pipeline</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 18 Q35 14 70 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: '#f59e0b', opacity: 0.8 }} />
          </svg>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="operza-kpi__header">
            <span className="operza-kpi__icon"><Icon name="folder" size={15} /></span>
            <span className="operza-kpi__trend">Active</span>
          </div>
          <div className="atlas-kpi__label">Total Documents</div>
          <div className="atlas-kpi__value tabular">{num(documents.length)}</div>
          <div className="atlas-kpi__note">Workspace repository</div>
          <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
            <path d="M0 10 Q30 14 60 8 T100 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--accent)', opacity: 0.8 }} />
          </svg>
        </article>
      </section>

      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
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
                  <tr
                    key={doc.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setViewingDoc(doc)}
                    title="Click to open and read full document"
                  >
                    <td>
                      <span className="person">
                        <span className="avatar avatar--sm avatar--square" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                          <Icon name={KIND_META[doc.kind].icon} size={14} />
                        </span>
                        <span className="person__text">
                          <span className="person__name" style={{ color: 'var(--accent)', fontWeight: 650 }}>{doc.name}</span>
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
                    <td onClick={(e) => e.stopPropagation()}>
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
                    <td className="cell-right" onClick={(e) => e.stopPropagation()}>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          className="btn btn--sm"
                          type="button"
                          onClick={() => setViewingDoc(doc)}
                          title="Open document view and clauses"
                        >
                          <Icon name="file" size={13} />
                          Open
                        </button>
                        <button
                          className="btn btn--sm btn--primary"
                          type="button"
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
      </section>

      <div className="grid grid--3" style={{ marginTop: 20 }}>
        {(['proposal', 'contract', 'estimate'] as const).map((kind) => {
          const items = documents.filter((d) => d.kind === kind);
          return (
            <div key={kind} className="card-premium" style={{ padding: '18px 20px' }}>
              <div className="card__head" style={{ marginBottom: 12 }}>
                <div className="card__title" style={{ fontSize: 14, fontWeight: 700 }}>{KIND_META[kind].label}s</div>
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
      {viewingDoc && (
        <ViewDocumentModal
          doc={viewingDoc}
          contactName={contactName(viewingDoc.contactId)}
          onClose={() => setViewingDoc(null)}
          onSign={() => {
            setSigningDoc(viewingDoc);
            setViewingDoc(null);
          }}
        />
      )}
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
    </main>
  );
}

function ViewDocumentModal({
  doc,
  contactName,
  onClose,
  onSign,
}: {
  doc: ContractDoc;
  contactName: string;
  onClose: () => void;
  onSign: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'agreement' | 'certificate' | 'audit'>('agreement');
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    navigator.clipboard?.writeText?.(window.location.origin + `/documents?id=${doc.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printDoc = () => {
    window.print();
  };

  return (
    <Modal
      title={doc.name}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={printDoc}>
            <Icon name="download" size={14} /> Print / Export PDF
          </button>
          <button className="btn" type="button" onClick={copyLink}>
            <Icon name="link" size={14} /> {copied ? 'Link Copied!' : 'Share Link'}
          </button>
          {doc.status !== 'signed' ? (
            <button className="btn btn--primary" type="button" onClick={onSign}>
              <Icon name="clipboard" size={14} /> Execute &amp; Sign
            </button>
          ) : (
            <button className="btn btn--primary" type="button" onClick={onSign}>
              <Icon name="check" size={14} /> View Certificate
            </button>
          )}
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        {/* Document Meta Banner */}
        <div className="card-premium" style={{ padding: '16px 20px', background: 'var(--surface-2)' }}>
          <div className="row row--between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="avatar avatar--sm avatar--square" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  <Icon name={KIND_META[doc.kind].icon} size={16} />
                </span>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{doc.name}</h3>
                  <div className="cell-sub" style={{ fontSize: 13, marginTop: 2 }}>
                    Client: <strong>{contactName}</strong> · Document ID: <code>{doc.id}</code>
                  </div>
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Contract Value</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{currency(doc.value)}</div>
              </div>
              <Badge tone={STATUS_TONE[doc.status]} dot>
                {doc.status.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="tabs" style={{ margin: 0 }}>
          <button
            type="button"
            className={`tab ${activeTab === 'agreement' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('agreement')}
          >
            Agreement &amp; Clauses
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'certificate' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('certificate')}
          >
            Cryptographic Certificate
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'audit' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Audit Trail
          </button>
        </div>

        {/* Tab 1: Agreement & Clauses */}
        {activeTab === 'agreement' && (
          <div className="card-premium" style={{ padding: 24, background: 'var(--surface)', maxHeight: '420px', overflowY: 'auto' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontWeight: 800 }}>
                OPERZA LEGAL CONTRACT ENGINE · {KIND_META[doc.kind].label.toUpperCase()}
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>Master Services Agreement &amp; Statement of Work</h2>
              <p className="cell-sub" style={{ marginTop: 4 }}>
                Effective Date: {shortDate(doc.updatedAt)} · Between Operza Growth Partner &amp; {contactName}
              </p>
            </div>

            <div className="stack" style={{ gap: 16, fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>1. Scope of Engagement &amp; Deliverables</h4>
                <p>
                  Operza shall deliver and maintain full digital operational infrastructure for {contactName}, including autonomous CRM automation, conversion funnels, multi-channel inbound messaging (SMS, WhatsApp, Email), appointment calendars, and white-labeled client portals as set forth in this agreement.
                </p>
              </div>

              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>2. Consideration &amp; Payment Milestones</h4>
                <p>
                  The Client agrees to pay the fixed contractual consideration of <strong>{currency(doc.value)}</strong>. All billing is reconciled under secure tokenized payment channels with immutable cryptographic invoice ledger receipts.
                </p>
              </div>

              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>3. Intellectual Property &amp; Tenant Sovereignty</h4>
                <p>
                  All customer records, database objects, workflow logic, and marketing collateral remain the sole property of the Client. Operza enforces database-level tenant isolation with fail-closed Row Level Security (RLS).
                </p>
              </div>

              <div>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>4. Electronic Signature Enforceability</h4>
                <p>
                  The parties acknowledge and agree that this document may be executed by electronic signature pursuant to the United States Electronic Signatures in Global and National Commerce Act (E-SIGN Act, 15 U.S.C. § 7001 et seq.) and the Uniform Electronic Transactions Act (UETA).
                </p>
              </div>
            </div>

            {/* Counterparty signature block */}
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span className="cell-sub" style={{ fontSize: 11, textTransform: 'uppercase' }}>Service Provider</span>
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>Operza Growth Platform, Inc.</div>
                <div style={{ marginTop: 10, borderBottom: '1px dashed var(--line-strong)', paddingBottom: 4, fontFamily: 'cursive', fontSize: 18, color: 'var(--accent)' }}>
                  Operza Authorized Representative
                </div>
                <span className="cell-sub" style={{ fontSize: 11 }}>Status: Verified &amp; Registered</span>
              </div>

              <div style={{ padding: 14, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span className="cell-sub" style={{ fontSize: 11, textTransform: 'uppercase' }}>Client Signer</span>
                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{contactName}</div>
                <div style={{ marginTop: 10, borderBottom: '1px dashed var(--line-strong)', paddingBottom: 4, fontFamily: 'cursive', fontSize: 18, color: doc.status === 'signed' ? 'var(--green)' : 'var(--text-3)' }}>
                  {doc.signerName || (doc.status === 'signed' ? contactName : 'Pending Signature...')}
                </div>
                <span className="cell-sub" style={{ fontSize: 11 }}>
                  {doc.status === 'signed' ? `Signed on ${shortDate(doc.signedAt || doc.updatedAt)}` : 'Awaiting counter-signature'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Certificate */}
        {activeTab === 'certificate' && (
          <div className="card-premium" style={{ padding: 24, background: 'var(--surface)' }}>
            <div className="row" style={{ gap: 10, color: doc.status === 'signed' ? 'var(--green)' : 'var(--amber)', marginBottom: 16 }}>
              <Icon name={doc.status === 'signed' ? 'check' : 'clock'} size={24} />
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  {doc.status === 'signed' ? 'Official Certificate of Electronic Execution' : 'Pre-Execution Audit Verification'}
                </h3>
                <span className="cell-sub">Compliant with U.S. ESIGN, UETA, and eIDAS Electronic Signature Standards</span>
              </div>
            </div>

            <div className="grid grid--2" style={{ gap: 14, fontSize: 13 }}>
              <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span className="cell-sub">Certificate ID</span>
                <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>CERT-OPZ-{doc.id.toUpperCase()}</div>
              </div>
              <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span className="cell-sub">Signer IP / Security Origin</span>
                <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>127.0.0.1 (Authenticated Client Session)</div>
              </div>
              <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span className="cell-sub">SHA-256 Checksum</span>
                <div style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                  e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
                </div>
              </div>
              <div style={{ padding: 12, background: 'var(--surface-2)', borderRadius: 8 }}>
                <span className="cell-sub">Execution Timestamp</span>
                <div style={{ fontWeight: 600 }}>
                  {doc.signedAt ? new Date(doc.signedAt).toUTCString() : (doc.status === 'signed' ? 'Completed' : 'Pending')}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Audit Trail */}
        {activeTab === 'audit' && (
          <div className="card-premium" style={{ padding: 20 }}>
            <div className="timeline">
              <div className="timeline__item">
                <div className="timeline__icon" style={{ background: 'var(--blue-soft)', color: 'var(--blue)' }}>
                  <Icon name="file" size={12} />
                </div>
                <div className="timeline__body">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Document Created</div>
                  <div className="cell-sub">{doc.name} authored and bound to {contactName}</div>
                  <div className="cell-sub" style={{ fontSize: 11 }}>{shortDate(doc.updatedAt)}</div>
                </div>
              </div>
              <div className="timeline__item">
                <div className="timeline__icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                  <Icon name="mail" size={12} />
                </div>
                <div className="timeline__body">
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Dispatched to Signer</div>
                  <div className="cell-sub">Secure signing invitation dispatched via client portal</div>
                  <div className="cell-sub" style={{ fontSize: 11 }}>{shortDate(doc.updatedAt)}</div>
                </div>
              </div>
              {doc.status === 'signed' && (
                <div className="timeline__item">
                  <div className="timeline__icon" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                    <Icon name="check" size={12} />
                  </div>
                  <div className="timeline__body">
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--green)' }}>Legally Executed &amp; Certified</div>
                    <div className="cell-sub">Digitally signed by {doc.signerName || contactName} with cryptographic seal</div>
                    <div className="cell-sub" style={{ fontSize: 11 }}>{shortDate(doc.signedAt || doc.updatedAt)}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
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
