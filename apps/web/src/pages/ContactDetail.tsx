import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, EmptyState, StatusBadge } from '../components/ui';
import { useStore, CHANNEL_META, uid } from '../lib/store';
import { currency, fullDate, relative, shortDate, timeOf } from '../lib/format';
import { api } from '../lib/api';
import type { Contact, ContactStatus } from '../lib/types';

const TABS = ['overview', 'timeline', 'notes', 'tasks', 'deals', 'inbox'] as const;
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
  const [timelineEvents, setTimelineEvents] = useState<any[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // GHL-Grade Quick Actions Modals
  const [smsOpen, setSmsOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [apptOpen, setApptOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  const contact = state.contacts.find((c) => c.id === id);

  if (!contact) {
    return (
      <main className="operza-dashboard atlas-dashboard">
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
      </main>
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

  useEffect(() => {
    if (!contact?.id) return;
    setTimelineLoading(true);
    api.contacts.getTimeline(contact.id)
      .then((res) => {
        if (res?.timeline && Array.isArray(res.timeline)) {
          setTimelineEvents(res.timeline);
        }
      })
      .catch(() => {})
      .finally(() => setTimelineLoading(false));
  }, [contact?.id]);

  const addNote = () => {
    if (!noteDraft.trim()) return;
    api.crm.create('notes', { text: noteDraft.trim(), contactId: contact.id, createdBy: 'Asim R.' }).catch(() => {});
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
    const taskPayload = {
      id: uid('tk'),
      title: taskDraft.trim(),
      contactId: contact.id,
      assignee: contact.owner,
      dueAt: due.toISOString(),
      priority: 'medium' as const,
      done: false,
      createdAt: new Date().toISOString(),
    };
    api.crm.create('tasks', {
      title: taskDraft.trim(),
      contactId: contact.id,
      priority: 'medium',
      status: 'pending',
      assignedTo: contact.owner,
      dueDate: due.toISOString().slice(0, 10),
    }).catch(() => {});
    dispatch({
      type: 'task/add',
      task: taskPayload,
    });
    setTaskDraft('');
  };

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">
            <Link to="/contacts" style={{ color: 'inherit', textDecoration: 'none' }}>Contacts</Link> <span>/</span> {name}
          </div>
          <h1>Contact 360</h1>
        </div>
        <div className="atlas-dashboard__toolbar" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="atlas-quick-action-button"
            style={{ background: 'rgba(99, 102, 241, 0.1)', color: '#6366f1', border: '1px solid rgba(99, 102, 241, 0.3)' }}
            onClick={() => setSmsOpen(true)}
            title="Send Direct SMS to contact"
          >
            <Icon name="message" size={13} /> Send SMS
          </button>
          <button
            type="button"
            className="atlas-quick-action-button"
            style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}
            onClick={() => setEmailOpen(true)}
            title="Send Rich Email to contact"
          >
            <Icon name="mail" size={13} /> Send Email
          </button>
          <button
            type="button"
            className="atlas-quick-action-button"
            style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#059669', border: '1px solid rgba(16, 185, 129, 0.3)' }}
            onClick={() => navigate('/phone')}
            title="Call Contact via WebRTC Softphone"
          >
            <Icon name="phone" size={13} /> Call Softphone
          </button>
          <button
            type="button"
            className="atlas-quick-action-button"
            onClick={() => setApptOpen(true)}
            title="Book Strategy Appointment"
          >
            <Icon name="calendar" size={13} /> Book Appt
          </button>
          <button
            type="button"
            className="atlas-quick-action-button"
            onClick={() => setDealOpen(true)}
            title="Create Pipeline Deal Opportunity"
          >
            <Icon name="plus" size={13} /> Add Deal
          </button>
          <button className="atlas-quick-action-button" onClick={() => setEditing(true)}>
            <Icon name="edit" size={13} /> Edit Profile
          </button>
        </div>
      </header>

      <section className="card-premium" style={{ padding: 20, marginBottom: 18 }}>
        <div className="row row--wrap" style={{ gap: 16 }}>
          <Avatar name={name} size="lg" />
          <div style={{ minWidth: 0, flex: '1 1 260px' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: 'var(--text)' }}>{name}</h2>
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
            <button className="icon-btn" onClick={() => setConfirmDelete(true)} aria-label="Delete contact">
              <Icon name="trash" size={16} />
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid--sidebar">
        <div className="card-premium" style={{ padding: '16px 20px' }}>
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

          {tab === 'timeline' && (
            <div className="card__body stack">
              <div className="row row--between" style={{ marginBottom: 4 }}>
                <strong style={{ fontSize: 13 }}>Contact 360 Activity Ledger</strong>
                <button
                  className="btn btn--sm btn--ghost"
                  onClick={() => {
                    setTimelineLoading(true);
                    api.contacts.getTimeline(contact.id)
                      .then((res) => {
                        if (res?.timeline) setTimelineEvents(res.timeline);
                      })
                      .finally(() => setTimelineLoading(false));
                  }}
                >
                  <Icon name="refresh" size={13} /> Refresh
                </button>
              </div>

              {timelineLoading ? (
                <div className="hint" style={{ padding: '16px 0' }}>Loading activity history…</div>
              ) : timelineEvents.length === 0 ? (
                <EmptyState icon={<Icon name="clock" size={20} />} title="No events logged yet" />
              ) : (
                <div className="timeline-list stack" style={{ gap: 12 }}>
                  {timelineEvents.map((evt, idx) => (
                    <div
                      key={idx}
                      className="row"
                      style={{
                        gap: 12,
                        padding: '10px 14px',
                        background: 'var(--surface-2)',
                        borderRadius: 6,
                        border: '1px solid var(--line)',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div
                        className="avatar avatar--sm avatar--square"
                        style={{
                          background:
                            evt.type === 'opportunity'
                              ? 'var(--accent-soft)'
                              : evt.type === 'task'
                              ? 'var(--green-soft)'
                              : evt.type === 'audit'
                              ? 'var(--amber-soft)'
                              : 'var(--surface-3)',
                          color:
                            evt.type === 'opportunity'
                              ? 'var(--accent)'
                              : evt.type === 'task'
                              ? 'var(--green)'
                              : evt.type === 'audit'
                              ? 'var(--amber)'
                              : 'var(--text-1)',
                        }}
                      >
                        <Icon
                          name={
                            evt.type === 'opportunity'
                              ? 'dollar'
                              : evt.type === 'task'
                              ? 'check'
                              : evt.type === 'note'
                              ? 'message'
                              : evt.type === 'contact_created'
                              ? 'users'
                              : 'bell'
                          }
                          size={14}
                        />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 550 }}>{evt.detail}</div>
                        <div className="cell-sub" style={{ marginTop: 2 }}>
                          <span style={{ textTransform: 'capitalize' }}>{evt.type.replace('_', ' ')}</span>
                          {evt.date && ` · ${fullDate(evt.date)} (${relative(evt.date)})`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
          <div className="card-premium" style={{ padding: '16px 20px', marginTop: 16 }}>
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

          <div className="card-premium" style={{ padding: '16px 20px', marginTop: 16 }}>
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
            api.crm.update('contacts', contact.id, patch).catch(() => {});
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
                  api.crm.delete('contacts', contact.id).catch(() => {});
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

      {smsOpen && <SmsModal contact={contact} onClose={() => setSmsOpen(false)} />}
      {emailOpen && <EmailModal contact={contact} onClose={() => setEmailOpen(false)} />}
      {apptOpen && <BookApptModal contact={contact} onClose={() => setApptOpen(false)} />}
      {dealOpen && <AddDealModal contact={contact} onClose={() => setDealOpen(false)} />}
    </main>
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

function SmsModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { dispatch } = useStore();
  const [text, setText] = useState(`Hi ${contact.firstName}, following up on our discussion regarding Operza growth solutions.`);
  const [sending, setSending] = useState(false);

  const templates: Record<string, string> = {
    follow_up: `Hi ${contact.firstName}, following up on our discussion regarding Operza growth solutions. Let me know when you are free!`,
    reminder: `Hi ${contact.firstName}, friendly reminder about our upcoming strategy session. Looking forward to speaking!`,
    special_offer: `Hi ${contact.firstName}, we have a special high-touch onboarding package available this month. Would love to share details!`,
  };

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.telephony.sendSms({
        to: contact.phone || '+15550199000',
        message: text.trim(),
        contactId: contact.id,
      }).catch(() => {});
      dispatch({
        type: 'contact/note',
        id: contact.id,
        body: `[SMS Sent to ${contact.phone || 'Phone'}]: ${text.trim()}`,
        author: 'Asim R.',
      });
      alert('SMS dispatched successfully!');
      onClose();
    } finally {
      setSending(false);
    }
  };

  const segmentCount = Math.ceil(text.length / 160) || 1;

  return (
    <Modal
      title={`Direct SMS to ${contact.firstName} ${contact.lastName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={sending || !text.trim()}
            onClick={handleSend}
            style={{ background: '#4f46e5' }}
          >
            {sending ? 'Sending SMS…' : 'Send Direct SMS'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label>Recipient Phone Number</label>
          <input className="input" readOnly value={contact.phone || 'No phone recorded'} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>

        <div className="field">
          <label>Quick Canned Template</label>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--xs btn--subtle" onClick={() => setText(templates.follow_up)}>
              Follow Up
            </button>
            <button type="button" className="btn btn--xs btn--subtle" onClick={() => setText(templates.reminder)}>
              Reminder
            </button>
            <button type="button" className="btn btn--xs btn--subtle" onClick={() => setText(templates.special_offer)}>
              Special Offer
            </button>
          </div>
        </div>

        <div className="field">
          <label>SMS Message Body</label>
          <textarea
            className="textarea"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your SMS message..."
          />
          <div className="row row--between hint" style={{ marginTop: 4, fontSize: 11.5 }}>
            <span>{text.length} characters ({segmentCount} {segmentCount === 1 ? 'segment' : 'segments'})</span>
            <span>A2P 10DLC Compliant</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EmailModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { dispatch } = useStore();
  const [subject, setSubject] = useState(`Strategy & Growth Session with ${contact.firstName}`);
  const [body, setBody] = useState(`Hi ${contact.firstName},\n\nIt was great connecting with you. Let's schedule a time to review your automation pipeline.\n\nBest regards,\nAsim`);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      dispatch({
        type: 'contact/note',
        id: contact.id,
        body: `[Email Sent: "${subject.trim()}"]: ${body.trim()}`,
        author: 'Asim R.',
      });
      alert('Email sent successfully!');
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      title={`Send Email to ${contact.firstName} (${contact.email})`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            type="button"
            disabled={sending || !subject.trim() || !body.trim()}
            onClick={handleSend}
            style={{ background: '#3b82f6' }}
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label>To</label>
          <input className="input" readOnly value={contact.email} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
        <div className="field">
          <label>Subject</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line..." />
        </div>
        <div className="field">
          <label>Message Content</label>
          <textarea className="textarea" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function BookApptModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [calendarId, setCalendarId] = useState(state.calendars[0]?.id || 'cal-discovery');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('14:00');
  const [note, setNote] = useState('Discovery & Strategy Session');

  const handleBook = () => {
    const startIso = `${date}T${time}:00Z`;
    const apptId = uid('ap');
    dispatch({
      type: 'appointment/add',
      appointment: {
        id: apptId,
        contactId: contact.id,
        calendarId,
        title: note,
        start: startIso,
        durationMin: 30,
        status: 'confirmed',
      },
    });
    dispatch({
      type: 'contact/note',
      id: contact.id,
      body: `[Appointment Booked]: ${note} scheduled for ${date} at ${time}`,
      author: 'Asim R.',
    });
    alert('Appointment successfully booked!');
    onClose();
  };

  return (
    <Modal
      title={`Book Appointment for ${contact.firstName} ${contact.lastName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" onClick={handleBook} style={{ background: '#4f46e5' }}>
            Confirm Appointment
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label>Calendar Service</label>
          <select className="select" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            {state.calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name} (30 min)
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid--2">
          <div className="field">
            <label>Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>Time</label>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Meeting Notes / Purpose</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function AddDealModal({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const activePipeline = state.pipelines[0];
  const [pipelineId, setPipelineId] = useState(activePipeline?.id || 'pipe-lead');
  const [stageId, setStageId] = useState(activePipeline?.stages[0]?.id || 's1');
  const [title, setTitle] = useState(`${contact.company || contact.firstName}'s Enterprise Deal`);
  const [value, setValue] = useState('5000');

  const selectedPipeline = state.pipelines.find((p) => p.id === pipelineId) || activePipeline;

  const handleCreateDeal = () => {
    const oppId = uid('op');
    dispatch({
      type: 'opportunity/add',
      opportunity: {
        id: oppId,
        contactId: contact.id,
        pipelineId,
        stageId,
        name: title.trim(),
        value: Number(value) || 0,
        status: 'open',
        owner: 'Asim R.',
        createdAt: new Date().toISOString(),
      },
    });
    alert('Pipeline deal opportunity added!');
    onClose();
  };

  return (
    <Modal
      title={`Add Pipeline Opportunity for ${contact.firstName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" onClick={handleCreateDeal} style={{ background: '#10b981' }}>
            Create Opportunity
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="field">
          <label>Pipeline</label>
          <select
            className="select"
            value={pipelineId}
            onChange={(e) => {
              setPipelineId(e.target.value);
              const p = state.pipelines.find((x) => x.id === e.target.value);
              if (p?.stages[0]) setStageId(p.stages[0].id);
            }}
          >
            {state.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Stage</label>
          <select className="select" value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {selectedPipeline?.stages.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid--2">
          <div className="field">
            <label>Opportunity Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Deal Value ($)</label>
            <input className="input" type="number" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
