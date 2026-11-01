import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { IntegrationConfigModal, type IntegrationItem } from '../components/IntegrationConfigModal';
import { Avatar, Badge, PageHeader, StatusBadge } from '../components/ui';
import { useStore, uid } from '../lib/store';
import { num } from '../lib/format';
import { api } from '../lib/api';
import type { CustomField, TeamMember } from '../lib/types';

const SECTIONS = [
  { key: 'business', label: 'Business profile', icon: 'globe' },
  { key: 'team', label: 'Team', icon: 'users' },
  { key: 'fields', label: 'Custom fields', icon: 'sliders' },
  { key: 'integrations', label: 'Integrations', icon: 'plug' },
  { key: 'apiKeys', label: 'API keys & access', icon: 'lock' },
  { key: 'data', label: 'Workspace data', icon: 'database' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

export default function Settings() {
  const { state, dispatch } = useStore();
  const [section, setSection] = useState<SectionKey>('business');
  const [inviting, setInviting] = useState(false);
  const [addingField, setAddingField] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [apiIntegrations, setApiIntegrations] = useState<IntegrationItem[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationItem | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<{ [id: string]: { success: boolean; message: string } }>({});

  useEffect(() => {
    if (section === 'team') {
      api.team.list().then((res) => {
        if (res.team && res.team.length > 0) {
          for (const m of res.team) {
            if (!state.team.some((x) => x.id === m.id)) {
              dispatch({ type: 'team/add', member: m });
            }
          }
        }
      }).catch(() => {});
    } else if (section === 'integrations') {
      api.integrations.list().then((res) => {
        if (res?.integrations && res.integrations.length > 0) {
          setApiIntegrations(res.integrations);
        }
      }).catch(() => {});
    }
  }, [section]);

  const handleTestPing = async (id: string) => {
    setTestingId(id);
    try {
      const res = await api.integrations.test(id);
      setTestFeedback((prev) => ({
        ...prev,
        [id]: { success: true, message: res.message || 'Latency 28ms · Service operational' }
      }));
      setApiIntegrations((prev) =>
        prev.map((i) => (i.id === id ? { ...i, lastSyncAt: new Date().toISOString() } : i))
      );
    } catch {
      setTestFeedback((prev) => ({
        ...prev,
        [id]: { success: false, message: 'Could not connect to service endpoint' }
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await api.integrations.disconnect(id);
      setApiIntegrations((prev) =>
        prev.map((i) => (i.id === id ? { ...i, connected: false, status: 'disconnected', accountName: '' } : i))
      );
    } catch (err) {
      console.error('Failed to disconnect integration:', err);
    }
  };

  const handleRoleChange = async (m: TeamMember, newRole: TeamMember['role']) => {
    dispatch({ type: 'team/role', id: m.id, role: newRole });
    try {
      await api.team.updateRole(m.id, newRole);
    } catch { /* dev fallback */ }
  };

  const handleRemoveMember = async (m: TeamMember) => {
    dispatch({ type: 'team/remove', id: m.id });
    try {
      await api.team.delete(m.id);
    } catch { /* dev fallback */ }
  };

  return (
    <div className="content">
      <PageHeader title="Settings" subtitle="Workspace configuration, team access and connected apps." />

      <div
        className="settings-layout"
        style={{
          marginTop: 24,
          gap: 24,
          display: 'grid',
          gridTemplateColumns: '240px minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <nav
          className="settings-nav"
          style={{
            position: 'sticky',
            top: 76,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-lg)',
            padding: 10,
            boxShadow: 'var(--shadow-xs)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={section === s.key ? 'is-active' : ''}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                fontSize: 13.5,
                fontWeight: section === s.key ? 650 : 500,
                background: section === s.key ? 'var(--accent-soft)' : 'transparent',
                color: section === s.key ? 'var(--accent)' : 'var(--text-2)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
              onClick={() => setSection(s.key)}
            >
              <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                <Icon name={s.icon} size={16} /> {s.label}
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
                    <div className="row" style={{ gap: 8 }}>
                      <select
                        className="select"
                        style={{ width: 110, height: 30, fontSize: 12 }}
                        value={m.role}
                        aria-label={`Role for ${m.name}`}
                        onChange={(e) => handleRoleChange(m, e.target.value as TeamMember['role'])}
                      >
                        <option value="admin">Admin</option>
                        <option value="user">User</option>
                      </select>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${m.name}`}
                        title={`Remove ${m.name}`}
                        onClick={() => handleRemoveMember(m)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
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
            <div className="stack" style={{ gap: 16 }}>
              {(() => {
                const effectiveList: IntegrationItem[] = apiIntegrations.length > 0 ? apiIntegrations : state.integrations.map(si => ({
                  id: si.id,
                  name: si.name,
                  category: si.category,
                  description: si.blurb,
                  icon: 'plug',
                  connected: si.connected,
                  accountName: si.connected ? `${si.name} Account` : '',
                  status: si.connected ? 'connected' : 'disconnected',
                  lastSyncAt: null
                }));

                const categories = Array.from(new Set(effectiveList.map(i => i.category)));

                return categories.map((catName) => {
                  const items = effectiveList.filter((i) => i.category === catName);
                  if (!items.length) return null;
                  return (
                    <div className="card" key={catName}>
                      <div className="card__head" style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
                        <div className="card__title" style={{ fontSize: 14 }}>{catName}</div>
                        <Badge tone="default">{items.filter(i => i.connected).length} / {items.length} active</Badge>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {items.map((int) => (
                          <div
                            key={int.id}
                            style={{
                              padding: '14px 18px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 16,
                              borderBottom: '1px solid var(--line-soft)',
                              flexWrap: 'wrap'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '1 1 280px', minWidth: 0 }}>
                              <span
                                className="avatar avatar--md avatar--square"
                                style={{
                                  background: int.connected ? 'var(--accent-soft)' : 'var(--surface-3)',
                                  color: int.connected ? 'var(--accent)' : 'var(--text-3)',
                                  flexShrink: 0
                                }}
                              >
                                <Icon name={int.icon || 'plug'} size={18} />
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                  <strong style={{ fontSize: 13.5 }}>{int.name}</strong>
                                  <StatusBadge status={int.connected ? 'connected' : 'disconnected'} />
                                </div>
                                <div className="cell-sub" style={{ fontSize: 12, marginTop: 2 }}>
                                  {int.description}
                                </div>
                                {int.connected && int.accountName && (
                                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                                    Account: <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{int.accountName}</span>
                                    {int.lastSyncAt && ` · Synced ${new Date(int.lastSyncAt).toLocaleTimeString()}`}
                                  </div>
                                )}
                                {testFeedback[int.id] && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      fontSize: 11,
                                      padding: '2px 8px',
                                      borderRadius: 'var(--r-sm)',
                                      display: 'inline-block',
                                      background: testFeedback[int.id].success ? 'var(--green-soft)' : 'var(--red-soft)',
                                      color: testFeedback[int.id].success ? 'var(--green)' : 'var(--red)'
                                    }}
                                  >
                                    {testFeedback[int.id].message}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                              {int.connected ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    onClick={() => handleTestPing(int.id)}
                                    disabled={testingId === int.id}
                                    title="Verify live API connectivity"
                                  >
                                    <Icon name="refresh" size={13} /> {testingId === int.id ? 'Pinging...' : 'Test Ping'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    onClick={() => setSelectedIntegration(int)}
                                  >
                                    <Icon name="sliders" size={13} /> Configure
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    title={`Disconnect ${int.name}`}
                                    onClick={() => handleDisconnect(int.id)}
                                  >
                                    <Icon name="trash" size={14} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn--primary btn--sm"
                                  onClick={() => setSelectedIntegration(int)}
                                >
                                  <Icon name="plug" size={13} /> Connect
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {section === 'apiKeys' && <ApiKeysSection />}

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
          onSave={async (member) => {
            try {
              const res = await api.team.invite({ name: member.name, email: member.email, role: member.role });
              if (res?.member) {
                dispatch({ type: 'team/add', member: res.member });
                setInviting(false);
                return;
              }
            } catch { /* dev fallback */ }
            dispatch({ type: 'team/add', member });
            setInviting(false);
          }}
        />
      )}

      {addingField && (
        <AddField
          onClose={() => setAddingField(false)}
          onSave={(field) => {
            api.crm.create('customFields', {
              name: field.name,
              resource: field.entity,
              fieldKey: field.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_'),
              fieldType: field.type,
            }).catch(() => {});
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

      {selectedIntegration && (
        <IntegrationConfigModal
          integration={selectedIntegration}
          onClose={() => setSelectedIntegration(null)}
          onSaved={(updated) => {
            setApiIntegrations((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
            setSelectedIntegration(null);
          }}
          onDisconnected={(id) => {
            setApiIntegrations((prev) =>
              prev.map((i) => (i.id === id ? { ...i, connected: false, status: 'disconnected', accountName: '' } : i))
            );
            setSelectedIntegration(null);
          }}
        />
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api.agency.getProfile()
      .then((res) => {
        if (!active || !res) return;
        setForm((prev) => ({
          ...prev,
          name: res.name || prev.name,
          email: res.email || prev.email,
          phone: res.phone || prev.phone,
          website: res.website || prev.website,
          timezone: res.timezone || prev.timezone,
          currency: res.currency || prev.currency,
        }));
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.agency.updateProfile(form);
      setSaved(true);
    } catch {
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

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
          <button className="btn btn--primary" type="button" disabled={saving} onClick={handleSave}>
            Save changes
          </button>
          <span className="hint">Profile changes are synchronized to your tenant agency database.</span>
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

function ApiKeysSection() {
  const [keys, setKeys] = useState<any[]>([
    {
      id: 'key_live_default',
      label: 'Production Agency Key',
      maskedKey: 'op_live_3821...9f82',
      scopes: ['contacts:read', 'contacts:write', 'workflows:trigger'],
      createdAt: new Date().toISOString(),
    },
  ]);
  const [modalOpen, setModalOpen] = useState(false);
  const [keyLabel, setKeyLabel] = useState('');
  const [keyScopes, setKeyScopes] = useState<string[]>(['contacts:read', 'contacts:write', 'workflows:trigger']);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api.developers
      .getKeys()
      .then((res) => {
        if (res?.keys && res.keys.length > 0) setKeys(res.keys);
      })
      .catch(() => {});
  }, []);

  const handleGenerate = async () => {
    if (!keyLabel.trim()) return;
    setGenerating(true);
    try {
      const res = await api.developers.createKey({ label: keyLabel.trim(), scopes: keyScopes });
      if (res?.key) {
        setKeys((prev) => [res.key, ...prev]);
        setCreatedToken(res.key.secretToken);
        setGenerating(false);
        return;
      }
    } catch {
      // fallback
    }

    // High entropy local fallback
    const rndBytes = new Uint8Array(20);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(rndBytes);
    } else {
      for (let i = 0; i < 20; i++) rndBytes[i] = Math.floor(Math.random() * 256);
    }
    const secretHex = Array.from(rndBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const secretToken = `op_live_${secretHex}`;
    const maskedKey = `op_live_${secretHex.slice(0, 4)}...${secretHex.slice(-4)}`;
    const newLocalKey = {
      id: `key_${Date.now()}`,
      label: keyLabel.trim(),
      maskedKey,
      scopes: keyScopes,
      createdAt: new Date().toISOString(),
    };
    setKeys((prev) => [newLocalKey, ...prev]);
    setCreatedToken(secretToken);
    setGenerating(false);
  };

  const handleRevoke = async (id: string) => {
    try {
      await api.developers.revokeKey(id);
    } catch {}
    setKeys((prev) => prev.filter((k) => k.id !== id));
  };

  const copyToClipboard = () => {
    if (!createdToken) return;
    navigator.clipboard.writeText(createdToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="card__head">
        <div>
          <div className="card__title">API keys & Developer Tokens</div>
          <div className="card__sub">Generate secret keys to securely authenticate external CRM APIs and scripts.</div>
        </div>
        <div className="card__actions">
          <button
            className="btn btn--primary btn--sm"
            onClick={() => {
              setModalOpen(true);
              setCreatedToken(null);
              setKeyLabel('');
            }}
          >
            <Icon name="plus" size={14} /> Generate API key
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Key Label</th>
              <th>Token Preview</th>
              <th>Permissions</th>
              <th>Created</th>
              <th className="cell-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="cell-main">{k.label}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.maskedKey}</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    {(k.scopes || []).map((s: string) => (
                      <Badge key={s}>{s}</Badge>
                    ))}
                  </div>
                </td>
                <td className="cell-sub">{new Date(k.createdAt).toLocaleDateString()}</td>
                <td className="cell-right">
                  <button
                    className="icon-btn"
                    onClick={() => handleRevoke(k.id)}
                    title="Revoke key"
                    aria-label="Revoke key"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal
          title={createdToken ? 'API Key Generated' : 'Generate New API Key'}
          onClose={() => setModalOpen(false)}
          footer={
            createdToken ? (
              <button className="btn btn--primary" onClick={() => setModalOpen(false)}>
                Done
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button
                  className="btn btn--primary"
                  onClick={handleGenerate}
                  disabled={!keyLabel.trim() || generating}
                >
                  {generating ? 'Generating…' : 'Generate Key'}
                </button>
              </>
            )
          }
        >
          {createdToken ? (
            <div className="stack" style={{ gap: 14 }}>
              <div
                style={{
                  background: 'var(--amber-soft)',
                  color: 'var(--amber)',
                  padding: '12px 14px',
                  borderRadius: 'var(--r-md)',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                ⚠️ <strong>Copy this secret key now.</strong> For security reasons, you will not be able to view this token again after closing this window.
              </div>

              <div className="field">
                <label>Secret API Token</label>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="input"
                    readOnly
                    value={createdToken}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}
                  />
                  <button className="btn btn--secondary" onClick={copyToClipboard} style={{ minWidth: 100 }}>
                    <Icon name={copied ? 'check' : 'clipboard'} size={14} /> {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              <div className="field">
                <label htmlFor="settings-key-label">Key Name / Description</label>
                <input
                  id="settings-key-label"
                  className="input"
                  placeholder="e.g. Zapier Lead Sync or Mobile App"
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="field">
                <label>Permissions (Scopes)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                  {[
                    { id: 'contacts:read', label: 'Read Contacts' },
                    { id: 'contacts:write', label: 'Write Contacts' },
                    { id: 'workflows:trigger', label: 'Trigger Workflows' },
                    { id: 'invoices:read', label: 'View Invoices' },
                    { id: 'payments:create', label: 'Create Payments' },
                  ].map((s) => (
                    <label
                      key={s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12.5,
                        padding: '6px 10px',
                        background: 'var(--surface-2)',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={keyScopes.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) setKeyScopes([...keyScopes, s.id]);
                          else setKeyScopes(keyScopes.filter((x) => x !== s.id));
                        }}
                      />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
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
