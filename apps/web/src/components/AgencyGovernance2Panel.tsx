import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Badge, EmptyState } from './ui';

type GovTab = 'workspace' | 'locations' | 'team' | 'roles' | 'security' | 'onboarding';

export function AgencyGovernance2Panel() {
  const [tab, setTab] = useState<GovTab>('workspace');
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [workspace, setWorkspace] = useState<any | null>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [rolesData, setRolesData] = useState<{ builtinRoles: any[]; customRoles: any[]; permissionCatalog: Record<string, string[]> }>({
    builtinRoles: [],
    customRoles: [],
    permissionCatalog: {},
  });
  const [sessions, setSessions] = useState<any[]>([]);
  const [mfaNotice, setMfaNotice] = useState<string>('');
  const [onboarding, setOnboarding] = useState<any | null>(null);

  const [newLocName, setNewLocName] = useState('');
  const [newLocTz, setNewLocTz] = useState('America/New_York');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [customRoleName, setCustomRoleName] = useState('');
  const [customRoleScope, setCustomRoleScope] = useState<'location' | 'agency'>('location');

  const loadAll = async () => {
    try {
      const [wsRes, locRes, teamRes, invRes, roleRes, sessRes, onbRes] = await Promise.all([
        api.agency2.getWorkspace(),
        api.agency2.listLocations(),
        api.agency2.listTeam(),
        api.agency2.listInvitations().catch(() => ({ invitations: [] })),
        api.agency2.listRoles(),
        api.agency2.listSessions().catch(() => ({ sessions: [], mfaNotice: '' })),
        api.agency2.getOnboarding(),
      ]);
      setWorkspace(wsRes.workspace);
      setLocations(locRes.locations || []);
      setMembers(teamRes.members || []);
      setInvitations(invRes.invitations || []);
      setRolesData(roleRes);
      setSessions(sessRes.sessions || []);
      setMfaNotice(sessRes.mfaNotice || '');
      setOnboarding(onbRes.onboarding);
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to load agency governance data.' });
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const saveWorkspace = async () => {
    if (!workspace) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.agency2.updateWorkspace(workspace);
      setWorkspace(res.workspace);
      setFeedback({ tone: 'green', text: 'Agency workspace profile saved.' });
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to save workspace profile.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateLocation = async () => {
    if (newLocName.trim().length < 2) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api.agency2.createLocation({ name: newLocName.trim(), timezone: newLocTz });
      setNewLocName('');
      setFeedback({ tone: 'green', text: 'Location created.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to create location.' });
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await api.agency2.createInvitation({ email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      setFeedback({ tone: 'amber', text: res.deliveryNotice || 'Invitation created in local/test adapter mode.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to create invitation.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCustomRole = async () => {
    if (customRoleName.trim().length < 2) return;
    setBusy(true);
    setFeedback(null);
    try {
      await api.agency2.createCustomRole({
        name: customRoleName.trim(),
        scope: customRoleScope,
        permissions: ['contacts:read', 'conversations:read'],
      });
      setCustomRoleName('');
      setFeedback({ tone: 'green', text: 'Custom role created.' });
      await loadAll();
    } catch (err: any) {
      setFeedback({ tone: 'red', text: err?.message || 'Failed to create custom role.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ padding: 16 }} aria-label="Agency Governance 2.0">
      <div className="card__head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div className="card__title">Agency Workspace & Access Governance 2.0</div>
          <div className="card__sub">Multi-location administration, invitations, RBAC permissions, sessions, and setup progress.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn btn--xs" to="/audit-log">Audit Log →</Link>
          <Link className="btn btn--xs" to="/plan-usage">Plan &amp; Usage →</Link>
        </div>
      </div>

      <div role="tablist" aria-label="Governance sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {([
          ['workspace', 'Workspace'],
          ['locations', `Locations (${locations.length})`],
          ['team', `Team & Invites (${members.length})`],
          ['roles', `Roles (${rolesData.builtinRoles.length + rolesData.customRoles.length})`],
          ['security', `Security (${sessions.length})`],
          ['onboarding', `Setup (${onboarding?.percent ?? 0}%)`],
        ] as Array<[GovTab, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`btn btn--xs ${tab === id ? 'btn--primary' : 'btn--subtle'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {feedback && (
        <div style={{ marginBottom: 12 }}>
          <Badge tone={feedback.tone}>{feedback.text}</Badge>
        </div>
      )}

      {tab === 'workspace' && workspace && (
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <label className="stack" style={{ gap: 4, fontSize: 12 }}>
              <span>Agency Name</span>
              <input className="input" value={workspace.name || ''} onChange={e => setWorkspace({ ...workspace, name: e.target.value })} />
            </label>
            <label className="stack" style={{ gap: 4, fontSize: 12 }}>
              <span>Business Email</span>
              <input className="input" value={workspace.email || ''} onChange={e => setWorkspace({ ...workspace, email: e.target.value })} />
            </label>
            <label className="stack" style={{ gap: 4, fontSize: 12 }}>
              <span>Default Timezone</span>
              <input className="input" value={workspace.defaultTimezone || 'UTC'} onChange={e => setWorkspace({ ...workspace, defaultTimezone: e.target.value })} />
            </label>
            <label className="stack" style={{ gap: 4, fontSize: 12 }}>
              <span>Default Currency</span>
              <input className="input" value={workspace.defaultCurrency || 'USD'} onChange={e => setWorkspace({ ...workspace, defaultCurrency: e.target.value })} />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--sm btn--primary" onClick={saveWorkspace} disabled={busy}>
              Save Agency Profile
            </button>
          </div>
        </div>
      )}

      {tab === 'locations' && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              aria-label="New location name"
              className="input"
              placeholder="New location name..."
              value={newLocName}
              onChange={e => setNewLocName(e.target.value)}
            />
            <input
              aria-label="New location timezone"
              className="input"
              placeholder="Timezone (e.g. America/New_York)"
              value={newLocTz}
              onChange={e => setNewLocTz(e.target.value)}
            />
            <button type="button" className="btn btn--sm btn--primary" onClick={handleCreateLocation} disabled={busy || newLocName.trim().length < 2}>
              Add Location
            </button>
          </div>
          {locations.length === 0 ? (
            <EmptyState title="No locations found" text="Create your primary business location above." />
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {locations.map(l => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, border: '1px solid var(--border)', borderRadius: 6 }}>
                  <div>
                    <strong>{l.name}</strong> <span className="cell-sub">· {l.timezone}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Badge tone={l.status === 'active' ? 'green' : 'default'}>{l.status}</Badge>
                    <button
                      type="button"
                      className="btn btn--xs"
                      onClick={async () => {
                        if (l.status === 'active') await api.agency2.archiveLocation(l.id);
                        else await api.agency2.restoreLocation(l.id);
                        await loadAll();
                      }}
                    >
                      {l.status === 'active' ? 'Archive' : 'Restore'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'team' && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="email"
              aria-label="Invite email"
              className="input"
              placeholder="Invite teammate by email..."
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
            />
            <select aria-label="Invite role" className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="button" className="btn btn--sm btn--primary" onClick={handleInvite} disabled={busy || !inviteEmail.includes('@')}>
              Send Invite
            </button>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            {members.map(m => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, border: '1px solid var(--border)', borderRadius: 6 }}>
                <div>
                  <strong>{m.name}</strong> <span className="cell-sub">({m.email})</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge>{m.role}</Badge>
                  <Badge tone={m.status === 'active' ? 'green' : 'default'}>{m.status}</Badge>
                  {m.status === 'active' && m.role !== 'owner' && (
                    <button
                      type="button"
                      className="btn btn--xs"
                      onClick={async () => {
                        await api.agency2.offboardMember(m.userId || m.id);
                        await loadAll();
                      }}
                    >
                      Offboard
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {invitations.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>Invitations</div>
              {invitations.map(inv => (
                <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                  <span>{inv.email} · {inv.role} ({inv.delivery_status || inv.deliveryStatus || 'pending_local'})</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <Badge>{inv.status}</Badge>
                    {inv.status === 'pending' && (
                      <button
                        type="button"
                        className="btn btn--xs"
                        onClick={async () => {
                          await api.agency2.revokeInvitation(inv.id);
                          await loadAll();
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'roles' && (
        <div className="stack" style={{ gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              aria-label="Custom role name"
              className="input"
              placeholder="New custom role name..."
              value={customRoleName}
              onChange={e => setCustomRoleName(e.target.value)}
            />
            <select aria-label="Custom role scope" className="input" value={customRoleScope} onChange={e => setCustomRoleScope(e.target.value as 'location' | 'agency')}>
              <option value="location">Location Scope</option>
              <option value="agency">Agency Scope</option>
            </select>
            <button type="button" className="btn btn--sm btn--primary" onClick={handleCreateCustomRole} disabled={busy || customRoleName.trim().length < 2}>
              Create Role
            </button>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {[...rolesData.builtinRoles, ...rolesData.customRoles].map(r => (
              <div key={r.slug || r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                <div><strong>{r.name}</strong> <span className="cell-sub">({r.scope})</span></div>
                <span className="cell-sub">{(r.permissions || []).length} permissions</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="stack" style={{ gap: 10 }}>
          {mfaNotice && <div className="cell-sub">{mfaNotice}</div>}
          {sessions.length === 0 ? (
            <EmptyState title="No active sessions listed" text="Active authenticated sessions appear here for security review and revocation." />
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {sessions.map(s => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                  <span>{s.userEmail || s.userId} · {s.userAgent}</span>
                  <button
                    type="button"
                    className="btn btn--xs"
                    onClick={async () => {
                      await api.agency2.revokeSession(s.id);
                      await loadAll();
                    }}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'onboarding' && onboarding && (
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Setup Completion: {onboarding.completedCount}/{onboarding.totalCount} ({onboarding.percent}%)
          </div>
          {(onboarding.steps || []).map((st: any) => (
            <div key={st.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 8, border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
              <span>{st.label}</span>
              <Badge tone={st.completed ? 'green' : 'default'}>{st.completed ? 'Complete' : 'Pending'}</Badge>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
