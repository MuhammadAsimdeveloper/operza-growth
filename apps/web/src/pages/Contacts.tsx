import { api } from '../lib/api';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { shortDate } from '../lib/format';
import type { Contact, ContactStatus } from '../lib/types';

const STATUSES: Array<{ value: 'all' | ContactStatus; label: string }> = [
  { value: 'all', label: 'All contacts' },
  { value: 'lead', label: 'Leads' },
  { value: 'customer', label: 'Customers' },
  { value: 'cold', label: 'Cold' },
];

export default function Contacts() {
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ContactStatus>('all');
  const [tag, setTag] = useState('all');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState<ContactStatus>('lead');
  const [confirmBulk, setConfirmBulk] = useState(false);

  useEffect(() => {
    let active = true;
    api.crm.list('contacts').then((res) => {
      if (!active || !res?.data || !Array.isArray(res.data)) return;
      for (const c of res.data) {
        if (!state.contacts.some((sc) => sc.id === c.id)) {
          dispatch({
            type: 'contact/add',
            contact: {
              id: c.id,
              firstName: c.firstName || '',
              lastName: c.lastName || '',
              email: c.email || '',
              phone: c.phone || '',
              company: c.company || '',
              tags: Array.isArray(c.tags) ? c.tags : [],
              source: c.source || 'Manual',
              status: (c.status || 'lead') as ContactStatus,
              owner: c.owner || 'Operator',
              createdAt: c.createdAt || new Date().toISOString(),
              notes: [],
              customFields: c.customValues || {},
            },
          });
        }
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, [state.contacts, dispatch]);

  const allTags = useMemo(
    () => Array.from(new Set(state.contacts.flatMap((c) => c.tags))).sort(),
    [state.contacts],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.contacts
      .filter((c) => {
        if (status !== 'all' && c.status !== status) return false;
        if (tag !== 'all' && !c.tags.includes(tag)) return false;
        if (!q) return true;
        return `${c.firstName} ${c.lastName} ${c.email} ${c.company} ${c.phone}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state.contacts, query, status, tag]);

  const visibleIds = rows.map((c) => c.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const toggleRow = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const toggleAll = () =>
    setSelected((current) =>
      allSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds])),
    );

  const applyTag = async () => {
    const value = tagDraft.trim().toLowerCase().replace(/\s+/g, '-');
    if (!value || selected.length === 0) return;
    dispatch({ type: 'contact/bulkTag', ids: selected, tag: value });
    try {
      await api.contacts.bulkTag(selected, value);
      setNotice(`Tag “${value}” applied to ${selected.length} contact(s)`);
    } catch (err: any) {
      console.error('Failed to bulk tag contacts:', err);
    }
    setTagDraft('');
  };

  const applyStatus = () => {
    if (selected.length === 0) return;
    dispatch({ type: 'contact/bulkStatus', ids: selected, status: statusDraft });
  };

  return (
    <div className="content">
      <PageHeader
        title="Contacts"
        subtitle={`${state.contacts.length} people in this workspace`}
        actions={
          <>
            <button className="btn" onClick={() => setImporting(true)}>
              <Icon name="upload" size={15} /> Import CSV
            </button>
            <button className="btn btn--primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add contact
            </button>
          </>
        }
      />

      {notice && (
        <div className="callout callout--info" style={{ marginBottom: 14 }}>
          {notice}
        </div>
      )}

      <div className="card">
        <div className="card__head" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="search" style={{ flex: '1 1 240px', maxWidth: 320 }}>
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Search name, email, company…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="select" style={{ width: 150 }} value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="all">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <span className="hint">{rows.length} shown</span>
        </div>

        {selected.length > 0 && (
          <div className="bulk-bar">
            <strong style={{ fontSize: 13 }}>{selected.length} selected</strong>
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input"
                style={{ height: 30, width: 150 }}
                placeholder="Add tag…"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyTag();
                }}
              />
              <button className="btn btn--sm" type="button" onClick={applyTag} disabled={!tagDraft.trim()}>
                Add tag
              </button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <select
                className="select select--sm"
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value as ContactStatus)}
                aria-label="Status for selected contacts"
              >
                <option value="lead">Lead</option>
                <option value="customer">Customer</option>
                <option value="cold">Cold</option>
              </select>
              <button className="btn btn--sm" type="button" onClick={applyStatus}>
                Set status
              </button>
            </div>
            <span className="spacer" />
            {selected.length >= 2 && (
              <button
                className="btn btn--sm btn--primary"
                type="button"
                onClick={() => setMerging(true)}
              >
                <Icon name="link" size={13} /> Merge ({selected.length})
              </button>
            )}
            <button className="btn btn--sm btn--ghost" type="button" onClick={() => setSelected([])}>
              Clear
            </button>
            <button
              className="btn btn--sm"
              type="button"
              style={{ color: 'var(--red)' }}
              onClick={() => setConfirmBulk(true)}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={<Icon name="users" size={22} />}
            title="No contacts match"
            text="Try clearing the search or filters."
            action={
              <button className="btn btn--sm" onClick={() => { setQuery(''); setStatus('all'); setTag('all'); }}>
                Reset filters
              </button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      className="check"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all contacts"
                    />
                  </th>
                  <th>Contact</th>
                  <th>Company</th>
                  <th>Tags</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th className="cell-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="is-clickable" onClick={() => navigate(`/contacts/${c.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="check"
                        checked={selected.includes(c.id)}
                        onChange={() => toggleRow(c.id)}
                        aria-label={`Select ${c.firstName} ${c.lastName}`}
                      />
                    </td>
                    <td>
                      <Link className="person" to={`/contacts/${c.id}`} onClick={(e) => e.stopPropagation()}>
                        <Avatar name={`${c.firstName} ${c.lastName}`} />
                        <span className="person__text">
                          <span className="person__name">
                            {c.firstName} {c.lastName}
                          </span>
                          <span className="person__sub">{c.email}</span>
                        </span>
                      </Link>
                    </td>
                    <td>{c.company || '—'}</td>
                    <td>
                      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                        {c.tags.slice(0, 2).map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))}
                        {c.tags.length > 2 && <Badge>+{c.tags.length - 2}</Badge>}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{c.source}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{c.owner}</td>
                    <td className="cell-right cell-sub">{shortDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && (
        <AddContact
          onClose={() => setAdding(false)}
          onSave={(contact) => {
            dispatch({ type: 'contact/add', contact });
            api.crm.create('contacts', contact).catch(() => {});
            setAdding(false);
            navigate(`/contacts/${contact.id}`);
          }}
        />
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onImported={(count) => {
            setNotice(`Successfully imported ${count} contact(s) via CSV!`);
            // Refresh contacts from server
            api.crm.list('contacts').then((res) => {
              if (res?.data && Array.isArray(res.data)) {
                for (const c of res.data) {
                  if (!state.contacts.some((sc) => sc.id === c.id)) {
                    dispatch({
                      type: 'contact/add',
                      contact: {
                        id: c.id,
                        firstName: c.firstName || '',
                        lastName: c.lastName || '',
                        email: c.email || '',
                        phone: c.phone || '',
                        company: c.company || '',
                        tags: Array.isArray(c.tags) ? c.tags : [],
                        source: c.source || 'CSV Import',
                        status: (c.status || 'lead') as ContactStatus,
                        owner: c.owner || 'Operator',
                        createdAt: c.createdAt || new Date().toISOString(),
                        notes: [],
                        customFields: c.customValues || {},
                      },
                    });
                  }
                }
              }
            }).catch(() => {});
          }}
        />
      )}

      {merging && (
        <MergeModal
          selectedIds={selected}
          contacts={state.contacts}
          onClose={() => setMerging(false)}
          onMerged={(primaryId, mergedIds) => {
            dispatch({ type: 'contact/bulkDelete', ids: mergedIds });
            setSelected([primaryId]);
            setNotice(`Merged ${mergedIds.length} contact(s) into master record.`);
          }}
        />
      )}

      {confirmBulk && (
        <Modal
          title={`Delete ${selected.length} contact${selected.length === 1 ? '' : 's'}?`}
          onClose={() => setConfirmBulk(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmBulk(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={() => {
                  dispatch({ type: 'contact/bulkDelete', ids: selected });
                  setSelected([]);
                  setConfirmBulk(false);
                }}
              >
                Delete permanently
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            This removes the selected contacts along with their deals, conversations, appointments, invoices, orders and
            subscriptions. This cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

export function AddContact({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (contact: Contact) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [company, setCompany] = useState('');
  const [source, setSource] = useState('Manual');
  const [status, setStatus] = useState<ContactStatus>('lead');
  const [tags, setTags] = useState('');

  const valid = firstName.trim() && lastName.trim() && email.trim();

  const submit = () => {
    if (!valid) return;
    onSave({
      id: uid('c'),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      company: company.trim(),
      tags: tags
        .split(',')
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
        .filter(Boolean),
      source,
      status,
      owner: 'Asim R.',
      createdAt: new Date().toISOString(),
      notes: [],
      customFields: {},
    });
  };

  return (
    <Modal
      title="Add contact"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={submit} disabled={!valid}>
            Save contact
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label>First name</label>
          <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Last name</label>
          <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="grid grid--2">
        <div className="field">
          <label>Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label>Company</label>
          <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
      </div>
      <div className="grid grid--2">
        <div className="field">
          <label>Source</label>
          <select className="select" value={source} onChange={(e) => setSource(e.target.value)}>
            {['Manual', 'Facebook Ads', 'Google Ads', 'Instagram', 'LinkedIn', 'Referral', 'Webinar', 'Organic search', 'Cold email'].map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
            <option value="lead">Lead</option>
            <option value="customer">Customer</option>
            <option value="cold">Cold</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Tags (comma separated)</label>
        <input className="input" placeholder="hot-lead, webinar" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
    </Modal>
  );
}

function ImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const [csv, setCsv] = useState(
    'firstName,lastName,email,phone,company,tags\nJane,Doe,jane@acme.com,+15550188,Acme Corp,vip;q4\nAlex,Chen,alex@chen-analytics.io,+15550192,Chen Analytics,ai-ready'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleImport = async () => {
    if (!csv.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.contacts.importCsv(csv);
      onImported(res.imported || 0);
      onClose();
    } catch (err: any) {
      setError(err.message || 'CSV Import failed. Verify headers.');
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Import Contacts (CSV)"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleImport} disabled={loading || !csv.trim()}>
            {loading ? 'Importing…' : 'Import Contacts'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>CSV Data (headers: firstName, lastName, email, phone, company, tags)</label>
        <textarea
          className="textarea"
          rows={7}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="firstName,lastName,email,phone,company,tags..."
        />
        <div className="hint" style={{ marginTop: 4 }}>
          Tags can be separated by semicolons (e.g. <code>lead;enterprise</code>).
        </div>
      </div>
      {error && <div className="callout callout--danger">{error}</div>}
    </Modal>
  );
}

function MergeModal({
  selectedIds,
  contacts,
  onClose,
  onMerged,
}: {
  selectedIds: string[];
  contacts: Contact[];
  onClose: () => void;
  onMerged: (primaryId: string, mergedIds: string[]) => void;
}) {
  const selectedContacts = contacts.filter((c) => selectedIds.includes(c.id));
  const [primaryId, setPrimaryId] = useState(selectedContacts[0]?.id || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleMerge = async () => {
    if (!primaryId) return;
    const mergeIds = selectedIds.filter((id) => id !== primaryId);
    setLoading(true);
    setError('');
    try {
      await api.contacts.merge(primaryId, mergeIds);
      onMerged(primaryId, mergeIds);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to merge contacts');
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`Merge ${selectedIds.length} Duplicate Contacts`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleMerge} disabled={loading || !primaryId}>
            {loading ? 'Merging…' : 'Confirm Merge'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Select Master (Primary) Contact to Retain</label>
        <select className="select" value={primaryId} onChange={(e) => setPrimaryId(e.target.value)}>
          {selectedContacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName} ({c.email || c.company || 'No email'})
            </option>
          ))}
        </select>
        <div className="hint" style={{ marginTop: 6 }}>
          All tags, opportunities, notes, and tasks from secondary contacts will be transferred to the primary record. Secondary records will be deleted permanently.
        </div>
      </div>
      {error && <div className="callout callout--danger">{error}</div>}
    </Modal>
  );
}

