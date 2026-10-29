import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, StatusBadge } from '../components/ui';
import { useStore, CHANNEL_META, uid } from '../lib/store';
import { currency, fullDate, relative, shortDate, timeOf } from '../lib/format';
import type { Contact, ContactStatus } from '../lib/types';

const TABS = ['overview', 'notes', 'tasks', 'deals', 'inbox'] as const;
type Tab = (typeof TABS)[number];

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [taskDraft, setTaskDraft] = useState('');

  const contact = state.contacts.find((c) => c.id === id);

  if (!contact) {
    return (
      <div className="content">
        <EmptyState
          icon={<Icon name="user" size={22} />}
          title="Contact not found"
          text="This contact may have been deleted."
          action={
            <Link className="btn" to="/contacts">
              Back to contacts
            </Link>
          }
        />
      </div>
    );
  }

  const deals = state.opportunities.filter((o) => o.contactId === contact.id);
  const dealsValue = deals.reduce((s, o) => s + o.value, 0);
  const conversation = state.conversations.find((c) => c.contactId === contact.id);
  const appointments = state.appointments
    .filter((a) => a.contactId === contact.id && new Date(a.start).getTime() > Date.now())
    .sort((a, b) => a.start.localeCompare(b.start));
  const invoices = state.invoices.filter((i) => i.contactId === contact.id);
  const name = `${contact.firstName} ${contact.lastName}`;

  const addNote = () => {
    if (!noteDraft.trim()) return;
    dispatch({ type: 'contact/note', id: contact.id, body: noteDraft.trim(), author: 'Asim R.' });
    setNoteDraft('');
  };

  const contactTasks = state.tasks
    .filter((t) => t.contactId === contact.id)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.dueAt.localeCompare(b.dueAt));

  const addTask = () => {
    if (!taskDraft.trim()) return;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
    dispatch({
      type: 'task/add',
      task: {
        id: uid('tk'),
        title: taskDraft.trim(),
        contactId: contact.id,
        assignee: contact.owner,
        dueAt: due.toISOString(),
        priority: 'medium',
        done: false,
        createdAt: new Date().toISOString(),
      },
    });
    setTaskDraft('');
  };

  return (
    <div className="content">
      <Link to="/contacts" className="row" style={{ gap: 6, fontSize: 12.5, color: 'var(--text-3)', marginBottom: 12 }}>
        <Icon name="chevron-left" size={15} /> All contacts
      </Link>

      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <div className="row row--wrap" style={{ gap: 16 }}>
          <Avatar name={name} size="lg" />
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ fontSize: 19, fontWeight: 680, letterSpacing: '-0.02em' }}>{name}</h1>
              <StatusBadge status={contact.status} />
            </div>
            <div className="hint" style={{ marginTop: 3 }}>
              {contact.company} · {contact.email} · {contact.phone}
            </div>
            <div className="row" style={{ gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
              {contact.tags.map((t) => (
                <span className="tag" key={t}>
                  <Icon name="tag" size={11} /> {t}
                </span>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" to="/conversations">
              <Icon name="message" size={15} /> Message
            </Link>
            <button className="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={15} /> Edit
            </button>
            <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete contact">
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid--sidebar">
        <div className="card">
          <div className="tabs" style={{ padding: '0 8px' }}>
            {TABS.map((t) => (
              <button key={t} className={`tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)} style={{ textTransform: 'capitalize' }}>
                {t === 'inbox' ? 'Conversation' : t}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div className="card__body stack">
              <dl className="kv">
                <dt>Email</dt>
                <dd>{contact.email}</dd>
                <dt>Phone</dt>
                <dd>{contact.phone || '—'}</dd>
                <dt>Company</dt>
                <dd>{contact.company || '—'}</dd>
                <dt>Source</dt>
                <dd>
                  <Badge>{contact.source}</Badge>
                </dd>
                <dt>Owner</dt>
                <dd>{contact.owner}</dd>
                <dt>Created</dt>
                <dd>{fullDate(contact.createdAt)}</dd>
                {Object.entries(contact.customFields).map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="divider" />

              <div className="row row--between">
                <strong style={{ fontSize: 13 }}>Appointments</strong>
                <Link className="btn btn--ghost btn--sm" to="/calendars">
                  Calendar
                </Link>
              </div>
              {appointments.length === 0 ? (
                <div className="hint">No upcoming appointments booked.</div>
              ) : (
                appointments.map((a) => (
                  <div className="row" key={a.id} style={{ gap: 10 }}>
                    <div className="nav__icon">
                      <Icon name="calendar" size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 550 }}>{a.title}</div>
                      <div className="cell-sub">
                        {fullDate(a.start)} · {timeOf(a.start)} · {a.durationMin} min
                      </div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div className="card__body stack">
              <div className="field">
                <label>Add a note</label>
                <textarea
                  className="textarea"
                  placeholder="Log a call, meeting or next step…"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
              </div>
              <div>
                <button className="btn btn--primary btn--sm" onClick={addNote} disabled={!noteDraft.trim()}>
                  <Icon name="plus" size={14} /> Save note
                </button>
              </div>
              <div className="divider" />
              {contact.notes.length === 0 ? (
                <div className="hint">No notes yet.</div>
              ) : (
                <div className="stack" style={{ gap: 10 }}>
                  {contact.notes.map((n) => (
                    <div className="note" key={n.id}>
                      <div className="note__body">{n.body}</div>
                      <div className="note__meta">
                        {n.author} · {relative(n.at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'tasks' && (
            <div className="card__body stack">
              <div className="field">
                <label>Add a task</label>
                <input
                  className="input"
                  placeholder="Follow up about the proposal…"
                  value={taskDraft}
                  onChange={(e) => setTaskDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addTask();
                  }}
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--primary btn--sm" onClick={addTask} disabled={!taskDraft.trim()}>
                  <Icon name="plus" size={14} /> Add task
                </button>
                <Link className="btn btn--ghost btn--sm" to="/tasks">
                  All tasks
                </Link>
              </div>
              <div className="divider" />
              {contactTasks.length === 0 ? (
                <div className="hint">No tasks for this contact yet.</div>
              ) : (
                <div className="stack" style={{ gap: 2 }}>
                  {contactTasks.map((t) => (
                    <div className={`task${t.done ? ' is-done' : ''}`} key={t.id}>
                      <button
                        type="button"
                        className="task__check"
                        role="checkbox"
                        aria-checked={t.done}
                        aria-label={t.done ? `Reopen ${t.title}` : `Complete ${t.title}`}
                        onClick={() => dispatch({ type: 'task/toggle', id: t.id })}
                      >
                        {t.done && <Icon name="check" size={13} />}
                      </button>
                      <div className="task__body">
                        <div className="task__title">{t.title}</div>
                        <div className="task__meta">
                          <span>{t.assignee}</span>
                          <span className="task__dot">·</span>
                          <span>{shortDate(t.dueAt)}, {timeOf(t.dueAt)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete ${t.title}`}
                        onClick={() => dispatch({ type: 'task/delete', id: t.id })}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'deals' && (
            <div className="table-wrap">
              {deals.length === 0 ? (
                <EmptyState icon={<Icon name="kanban" size={20} />} title="No deals yet" text="Create an opportunity to track revenue." />
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Deal</th>
                      <th>Stage</th>
                      <th>Status</th>
                      <th className="cell-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deals.map((d) => {
                      const pipeline = state.pipelines.find((p) => p.id === d.pipelineId);
                      const stage = pipeline?.stages.find((s) => s.id === d.stageId);
                      return (
                        <tr key={d.id}>
                          <td className="cell-main">{d.name}</td>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: stage?.color }} />
                              {stage?.name}
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={d.status} />
                          </td>
                          <td className="cell-right cell-num">{currency(d.value)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'inbox' && (
            <div className="card__body">
              {!conversation ? (
                <EmptyState icon={<Icon name="message" size={20} />} title="No conversation" text="This contact has not messaged yet." />
              ) : (
                <div className="stack">
                  <div className="row row--between">
                    <Badge tone="accent">{CHANNEL_META[conversation.channel].label}</Badge>
                    <Link className="btn btn--sm" to="/conversations">
                      Open inbox
                    </Link>
                  </div>
                  {conversation.messages.slice(-3).map((m) => (
                    <div key={m.id} className={`bubble bubble--${m.direction}`} style={{ maxWidth: '85%' }}>
                      {m.body}
                      <div className="bubble__meta">{timeOf(m.at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">
              <div className="card__title">Summary</div>
            </div>
            <div className="card__body stack" style={{ gap: 12 }}>
              <div className="row row--between">
                <span className="hint">Deal value</span>
                <strong style={{ fontSize: 14 }}>{currency(dealsValue)}</strong>
              </div>
              <div className="row row--between">
                <span className="hint">Open deals</span>
                <strong style={{ fontSize: 14 }}>{deals.filter((d) => d.status === 'open').length}</strong>
              </div>
              <div className="row row--between">
                <span className="hint">Invoices</span>
                <strong style={{ fontSize: 14 }}>{invoices.length}</strong>
              </div>
              <div className="row row--between">
                <span className="hint">Open tasks</span>
                <strong style={{ fontSize: 14 }}>{contactTasks.filter((t) => !t.done).length}</strong>
              </div>
              <div className="divider" />
              <div className="hint">
                Owner <strong style={{ color: 'var(--text-2)' }}>{contact.owner}</strong> · added{' '}
                {relative(contact.createdAt)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <div className="card__title">Recent invoices</div>
              <div className="card__actions">
                <Link className="btn btn--ghost btn--sm" to="/payments">
                  All
                </Link>
              </div>
            </div>
            {invoices.length === 0 ? (
              <div className="hint" style={{ padding: 16 }}>
                No invoices for this contact.
              </div>
            ) : (
              invoices.map((inv) => (
                <div className="list-row" key={inv.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 550 }}>{inv.number}</div>
                    <div className="cell-sub">{fullDate(inv.issuedAt)}</div>
                  </div>
                  <strong style={{ fontSize: 13 }}>{currency(inv.amount)}</strong>
                  <StatusBadge status={inv.status} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {editing && (
        <EditContact
          contact={contact}
          onClose={() => setEditing(false)}
          onSave={(patch) => {
            dispatch({ type: 'contact/update', id: contact.id, patch });
            setEditing(false);
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Delete contact?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={() => {
                  dispatch({ type: 'contact/delete', id: contact.id });
                  navigate('/contacts');
                }}
              >
                Delete permanently
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            This removes <strong>{name}</strong> along with their deals, conversation and appointments. This cannot be
            undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

function EditContact({
  contact,
  onClose,
  onSave,
}: {
  contact: Contact;
  onClose: () => void;
  onSave: (patch: Partial<Contact>) => void;
}) {
  const [form, setForm] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
    status: contact.status,
    owner: contact.owner,
    tags: contact.tags.join(', '),
  });
  const { state } = useStore();
  const [custom, setCustom] = useState<Record<string, string>>({ ...contact.customFields });
  const contactFields = state.customFields.filter((field) => field.entity === 'contact');

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = () => {
    const customFields: Record<string, string> = { ...contact.customFields };
    for (const field of contactFields) {
      const value = (custom[field.name] ?? '').trim();
      if (value) customFields[field.name] = value;
      else delete customFields[field.name];
    }
    onSave({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      status: form.status as ContactStatus,
      owner: form.owner,
      tags: form.tags
        .split(',')
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
        .filter(Boolean),
      customFields,
    });
  };

  return (
    <Modal
      title="Edit contact"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={save}>
            Save changes
          </button>
        </>
      }
    >
      <div className="grid grid--2">
        <div className="field">
          <label>First name</label>
          <input className="input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </div>
        <div className="field">
          <label>Last name</label>
          <input className="input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </div>
        <div className="field">
          <label>Email</label>
          <input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div className="field">
          <label>Phone</label>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div className="field">
          <label>Company</label>
          <input className="input" value={form.company} onChange={(e) => set('company', e.target.value)} />
        </div>
        <div className="field">
          <label>Status</label>
          <select className="select" value={form.status} onChange={(e) => set('status', e.target.value)}>
            <option value="lead">Lead</option>
            <option value="customer">Customer</option>
            <option value="cold">Cold</option>
          </select>
        </div>
        <div className="field">
          <label>Owner</label>
          <select className="select" value={form.owner} onChange={(e) => set('owner', e.target.value)}>
            {['Asim R.', 'Priya N.', 'Jonah T.', 'Maya L.'].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Tags</label>
          <input className="input" value={form.tags} onChange={(e) => set('tags', e.target.value)} />
        </div>
      </div>

      <div className="divider" style={{ margin: '16px 0 12px' }} />
      <div className="row row--between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Custom fields</strong>
        <span className="cell-sub">{contactFields.length} defined</span>
      </div>
      {contactFields.length === 0 ? (
        <div className="hint">
          No contact custom fields yet — add field definitions in Settings to collect extra details here.
        </div>
      ) : (
        <div className="grid grid--2">
          {contactFields.map((field) => (
            <div className="field" key={field.id}>
              <label htmlFor={`contact-cf-${field.id}`}>{field.name}</label>
              <input
                id={`contact-cf-${field.id}`}
                className="input"
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                value={custom[field.name] ?? ''}
                onChange={(e) =>
                  setCustom((current) => ({ ...current, [field.name]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
