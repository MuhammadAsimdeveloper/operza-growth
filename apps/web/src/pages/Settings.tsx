import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, PageHeader, Switch } from '../components/ui';
import { INTEGRATION_CATEGORIES, useStore, uid } from '../lib/store';
import { num } from '../lib/format';
import type { CustomField, TeamMember } from '../lib/types';

const SECTIONS = [
  { key: 'business', label: 'Business profile', icon: 'globe' },
  { key: 'team', label: 'Team', icon: 'users' },
  { key: 'fields', label: 'Custom fields', icon: 'sliders' },
  { key: 'integrations', label: 'Integrations', icon: 'plug' },
  { key: 'data', label: 'Workspace data', icon: 'database' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

export default function Settings() {
  const { state, dispatch } = useStore();
  const [section, setSection] = useState<SectionKey>('business');
  const [inviting, setInviting] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [resetting, setResetting] = useState(false);

  return (
    <div className="content">
      <PageHeader title="Settings" subtitle="Workspace configuration, team access and connected apps." />

      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} className={section === s.key ? 'is-active' : ''} onClick={() => setSection(s.key)}>
              <span className="row" style={{ gap: 8 }}>
                <Icon name={s.icon} size={15} /> {s.label}
              </span>
            </button>
          ))}
        </nav>

        <div className="stack">
          {section === 'business' && <BusinessProfile />}

          {section === 'team' && (
            <div className="card">
              <div className="card__head">
                <div>
                  <div className="card__title">Team members</div>
                  <div className="card__sub">{state.team.length} people with workspace access</div>
                </div>
                <div className="card__actions">
                  <button className="btn btn--primary btn--sm" onClick={() => setInviting(true)}>
                    <Icon name="plus" size={14} /> Invite
                  </button>
                </div>
              </div>
              <div>
                {state.team.map((m) => (
                  <div className="list-row" key={m.id}>
                    <Avatar name={m.name} size="md" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row" style={{ gap: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</span>
                        {m.online && (
                          <span className="badge badge--green badge--dot" style={{ height: 18, fontSize: 10.5 }}>
                            online
                          </span>
                        )}
                      </div>
                      <div className="cell-sub">{m.email}</div>
                    </div>
                    <select
                      className="select"
                      style={{ width: 110, height: 30, fontSize: 12 }}
                      value={m.role}
                      onChange={(e) => dispatch({ type: 'team/role', id: m.id, role: e.target.value as TeamMember['role'] })}
                    >
                      <option value="admin">Admin</option>
                      <option value="user">User</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {section === 'fields' && (
            <div className="card">
              <div className="card__head">
                <div>
                  <div className="card__title">Custom fields</div>
                  <div className="card__sub">Extra data captured on contacts and opportunities</div>
                </div>
                <div className="card__actions">
                  <button className="btn btn--primary btn--sm" onClick={() => setAddingField(true)}>
                    <Icon name="plus" size={14} /> Add field
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Applies to</th>
                      <th className="cell-right">Used by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.customFields.map((f) => (
                      <tr key={f.id}>
                        <td className="cell-main">{f.name}</td>
                        <td>
                          <Badge>{f.type}</Badge>
                        </td>
                        <td style={{ textTransform: 'capitalize', color: 'var(--text-2)' }}>{f.entity}</td>
                        <td className="cell-right cell-sub">
                          {f.entity === 'contact'
                            ? num(state.contacts.filter((c) => f.name in c.customFields).length)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {section === 'integrations' && (
            <div className="stack">
              {INTEGRATION_CATEGORIES.map((category) => {
                const items = state.integrations.filter((i) => i.category === category);
                if (!items.length) return null;
                return (
                  <div className="card" key={category}>
                    <div className="card__head">
                      <div className="card__title">{category}</div>
                    </div>
                    <div>
                      {items.map((int) => (
                        <div className="list-row" key={int.id}>
                          <span
                            className="avatar avatar--md avatar--square"
                            style={{ background: int.connected ? 'var(--green-soft)' : 'var(--surface-3)', color: int.connected ? 'var(--green)' : 'var(--text-3)' }}
                          >
                            <Icon name="plug" size={16} />
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="row" style={{ gap: 7 }}>
                              <span style={{ fontSize: 13, fontWeight: 600 }}>{int.name}</span>
                              {int.connected ? (
                                <Badge tone="green" dot>
                                  Connected
                                </Badge>
                              ) : (
                                <Badge>Not connected</Badge>
                              )}
                            </div>
                            <div className="cell-sub">{int.blurb}</div>
                          </div>
                          <Switch
                            on={int.connected}
                            label={`Toggle ${int.name}`}
                            onChange={() => dispatch({ type: 'integration/toggle', id: int.id })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {section === 'data' && (
            <div className="stack">
              <div className="card">
                <div className="card__head">
                  <div className="card__title">Workspace contents</div>
                </div>
                <div className="card__body">
                  <dl className="kv">
                    <dt>Contacts</dt>
                    <dd>{num(state.contacts.length)}</dd>
                    <dt>Opportunities</dt>
                    <dd>{num(state.opportunities.length)}</dd>
                    <dt>Conversations</dt>
                    <dd>{num(state.conversations.length)}</dd>
                    <dt>Appointments</dt>
                    <dd>{num(state.appointments.length)}</dd>
                    <dt>Invoices</dt>
                    <dd>{num(state.invoices.length)}</dd>
                    <dt>Workflows</dt>
                    <dd>{num(state.workflows.length)}</dd>
                  </dl>
                </div>
              </div>

              <div className="card">
                <div className="card__head">
                  <div>
                    <div className="card__title">Reset demo data</div>
                    <div className="card__sub">Restore the original seed data set</div>
                  </div>
                </div>
                <div className="card__body row row--between row--wrap" style={{ gap: 12 }}>
                  <p className="hint" style={{ maxWidth: 420 }}>
                    All changes are stored in your browser&apos;s local storage. Resetting clears them and reloads the
                    seeded workspace.
                  </p>
                  <button className="btn btn--danger" onClick={() => setResetting(true)}>
                    <Icon name="refresh" size={15} /> Reset workspace
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {inviting && (
        <InviteMember
          onClose={() => setInviting(false)}
          onSave={(member) => {
            dispatch({ type: 'team/add', member });
            setInviting(false);
          }}
        />
      )}

      {addingField && (
        <AddField
          onClose={() => setAddingField(false)}
          onSave={(field) => {
            dispatch({ type: 'customField/add', field });
            setAddingField(false);
          }}
        />
      )}

      {resetting && (
        <Modal
          title="Reset workspace?"
          onClose={() => setResetting(false)}
          footer={
            <>
              <button className="btn" onClick={() => setResetting(false)}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={() => {
                  dispatch({ type: 'workspace/reset' });
                  setResetting(false);
                }}
              >
                Reset everything
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            This discards every contact, deal, invoice and workflow change you have made in this browser and restores
            the seeded demo data.
          </p>
        </Modal>
      )}
    </div>
  );
}

function BusinessProfile() {
  const [form, setForm] = useState({
    name: 'Asim Growth Agency',
    email: 'hello@agency.test',
    phone: '+1 (415) 555-0100',
    website: 'agency.test',
    timezone: 'America/Los_Angeles',
    currency: 'USD',
  });
  const [saved, setSaved] = useState(false);

  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">Business profile</div>
          <div className="card__sub">Shown on invoices, emails and booking pages</div>
        </div>
        <div className="card__actions">
          {saved && (
            <Badge tone="green" dot>
              Saved
            </Badge>
          )}
        </div>
      </div>
      <div className="card__body stack">
        <div className="grid grid--2">
          <div className="field">
            <label>Business name</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="field">
            <label>Support email</label>
            <input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="field">
            <label>Website</label>
            <input className="input" value={form.website} onChange={(e) => set('website', e.target.value)} />
          </div>
          <div className="field">
            <label>Timezone</label>
            <select className="select" value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Karachi', 'Asia/Dubai'].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Currency</label>
            <select className="select" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
              {['USD', 'EUR', 'GBP', 'PKR', 'AED'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <button className="btn btn--primary" onClick={() => setSaved(true)}>
            Save changes
          </button>
          <span className="hint">Demo build: profile values are kept in component state only.</span>
        </div>
      </div>
    </div>
  );
}

function InviteMember({ onClose, onSave }: { onClose: () => void; onSave: (member: TeamMember) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamMember['role']>('user');

  return (
    <Modal
      title="Invite team member"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={!name.trim() || !email.trim()}
            onClick={() =>
              onSave({ id: uid('u'), name: name.trim(), email: email.trim(), role, online: false })
            }
          >
            Send invite
          </button>
        </>
      }
    >
      <div className="field">
        <label>Full name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Email</label>
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label>Role</label>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as TeamMember['role'])}>
          <option value="user">User — access to own records</option>
          <option value="admin">Admin — full workspace access</option>
        </select>
      </div>
    </Modal>
  );
}

function AddField({ onClose, onSave }: { onClose: () => void; onSave: (field: CustomField) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<CustomField['type']>('text');
  const [entity, setEntity] = useState<CustomField['entity']>('contact');

  return (
    <Modal
      title="Add custom field"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={!name.trim()}
            onClick={() => onSave({ id: uid('cf'), name: name.trim(), type, entity })}
          >
            Create field
          </button>
        </>
      }
    >
      <div className="field">
        <label>Field name</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Industry" autoFocus />
      </div>
      <div className="grid grid--2">
        <div className="field">
          <label>Type</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as CustomField['type'])}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
            <option value="select">Select</option>
          </select>
        </div>
        <div className="field">
          <label>Applies to</label>
          <select className="select" value={entity} onChange={(e) => setEntity(e.target.value as CustomField['entity'])}>
            <option value="contact">Contact</option>
            <option value="opportunity">Opportunity</option>
          </select>
        </div>
      </div>
    </Modal>
  );
}
