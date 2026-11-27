import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, Switch } from '../components/ui';
import { useStore } from '../lib/store';
import { currency, num } from '../lib/format';
import { api } from '../lib/api';
import type { Contact } from '../lib/types';
import { PortalHub2Panel } from '../components/PortalHub2Panel';

const PORTAL_FEATURES = [
  { icon: 'file', title: 'Contracts & proposals', text: 'Members review and sign documents in the portal.' },
  { icon: 'book', title: 'Courses & lessons', text: 'Any published membership offer appears automatically.' },
  { icon: 'wallet', title: 'Invoices & payments', text: 'Outstanding balances with a pay-now link.' },
  { icon: 'calendar', title: 'Bookings', text: 'Members reschedule appointments without emailing.' },
];

export default function ClientPortal() {
  const { state, dispatch } = useStore();
  const [previewContactId, setPreviewContactId] = useState<string | null>(null);
  const [portalSummary, setPortalSummary] = useState<any | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Sync contacts from backend on mount
  useEffect(() => {
    let active = true;
    api.crm.list<Contact>('contacts')
      .then((res) => {
        if (!active || !res || !Array.isArray(res)) return;
        for (const item of res) {
          if (!state.contacts.some((c) => c.id === item.id)) {
            dispatch({ type: 'contact/add', contact: item });
          }
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [dispatch, state.contacts]);

  const contacts = state.contacts || [];
  const members = contacts.filter((c) => c.portalAccess);
  const candidates = contacts.filter((c) => !c.portalAccess).slice(0, 4);

  const sharedDocs = (state.documents || []).filter((d) => members.some((m) => m.id === d.contactId)).length;
  const seats = (state.enrollments || []).filter((e) => members.some((m) => m.id === e.contactId)).length;

  async function handleToggleAccess(contactId: string, granted: boolean) {
    try {
      await api.portal.toggleAccess(contactId, granted);
    } catch {
      /* fallback */
    }
    dispatch({ type: 'contact/update', id: contactId, patch: { portalAccess: granted } });
  }

  async function handleOpenPreview(contactId: string) {
    setPreviewContactId(contactId);
    setLoadingSummary(true);
    try {
      const summary = await api.portal.getSummary(contactId);
      setPortalSummary(summary);
    } catch {
      setPortalSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Client Experience &amp; Portal</div>
          <h1>Client Portal OS</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <button
            className="atlas-quick-action-button"
            type="button"
            disabled={members.length === 0}
            onClick={() => handleOpenPreview(members[0]?.id || '')}
          >
            <Icon name="globe" size={13} /> Preview Portal
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">WHITE-LABEL CLIENT PORTAL</div>
        <h2>Unified Self-Service Client Environment</h2>
        <p>A branded client experience where buyers access signed contracts, ongoing courses, outstanding invoices, and appointments.</p>
      </section>

      <section className="atlas-kpis" aria-label="Client portal metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Active Members</span>
            <span className="atlas-status atlas-status--healthy">Access Granted</span>
          </div>
          <div className="atlas-kpi__value">{num(members.length)}</div>
          <div className="atlas-kpi__note">{candidates.length} invites pending</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Shared Contracts</span>
            <span className="atlas-status atlas-status--healthy">Live</span>
          </div>
          <div className="atlas-kpi__value">{num(sharedDocs)}</div>
          <div className="atlas-kpi__note">Visible in member vault</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Curriculum Seats</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{num(seats)}</div>
          <div className="atlas-kpi__note">Unlocked learning modules</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Pending Invites</span>
            <span className="atlas-status atlas-status--healthy">Available</span>
          </div>
          <div className="atlas-kpi__value">{num(candidates.length)}</div>
          <div className="atlas-kpi__note">Contacts eligible for access</div>
        </article>
      </section>

      <div className="grid grid--2" style={{ marginTop: 22, marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Members with access</div>
              <div className="card__sub">{members.length} people can sign in</div>
            </div>
            <div className="card__actions">
              <Badge tone="green">{members.length} active</Badge>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Company</th>
                  <th className="cell-right" style={{ width: 140 }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <span className="person">
                        <Avatar name={`${m.firstName} ${m.lastName}`} />
                        <span className="person__text">
                          <span className="person__name">
                            {m.firstName} {m.lastName}
                          </span>
                          <span className="person__sub">{m.email}</span>
                        </span>
                      </span>
                    </td>
                    <td>{m.company || '—'}</td>
                    <td className="cell-right">
                      <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn--sm"
                          title="Copy public client portal direct URL"
                          onClick={() => {
                            const url = `${window.location.origin}/portal/${m.id}`;
                            navigator.clipboard.writeText(url);
                            alert(`Client Portal URL copied to clipboard:\n${url}`);
                          }}
                        >
                          <Icon name="link" size={12} /> Link
                        </button>
                        <button
                          type="button"
                          className="btn btn--sm"
                          aria-label={`Preview portal for ${m.firstName}`}
                          onClick={() => handleOpenPreview(m.id)}
                        >
                          <Icon name="eye" size={12} /> Preview
                        </button>
                        <span style={{ display: 'inline-flex' }}>
                          <Switch
                            on
                            label={`Revoke portal access for ${m.firstName}`}
                            onChange={() => handleToggleAccess(m.id, false)}
                          />
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr>
                    <td colSpan={3} className="cell-sub" style={{ textAlign: 'center', padding: '24px' }}>
                      No members have active portal access. Invite contacts below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Invite a client</div>
              <div className="card__sub">Turn on portal access for an existing contact</div>
            </div>
          </div>
          <div className="card__body stack" style={{ gap: 10 }}>
            {candidates.map((c) => (
              <div key={c.id} className="row row--between" style={{ gap: 10 }}>
                <span className="person">
                  <Avatar name={`${c.firstName} ${c.lastName}`} size="xs" />
                  <span className="person__text">
                    <span className="person__name">
                      {c.firstName} {c.lastName}
                    </span>
                    <span className="person__sub">{c.email}</span>
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => handleToggleAccess(c.id, true)}
                >
                  <Icon name="plus" size={12} /> Grant access
                </button>
              </div>
            ))}
            {candidates.length === 0 && <div className="cell-sub">Everyone already has access.</div>}
          </div>
        </div>
      </div>

      <div className="grid grid--4">
        {PORTAL_FEATURES.map((f) => (
          <div key={f.title} className="card">
            <div className="card__body">
              <span
                className="avatar avatar--md avatar--square"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 10 }}
              >
                <Icon name={f.icon} size={16} />
              </span>
              <div style={{ fontSize: 13, fontWeight: 650 }}>{f.title}</div>
              <div className="cell-sub" style={{ marginTop: 3, lineHeight: 1.5 }}>
                {f.text}
              </div>
            </div>
          </div>
        ))}
      </div>

      {previewContactId && (
        <Modal
          title={`Client Portal · ${portalSummary?.contact?.firstName || 'Member'} ${portalSummary?.contact?.lastName || ''}`}
          wide
          onClose={() => {
            setPreviewContactId(null);
            setPortalSummary(null);
          }}
          footer={
            <button
              className="btn btn--primary"
              type="button"
              onClick={() => {
                setPreviewContactId(null);
                setPortalSummary(null);
              }}
            >
              Done Previewing
            </button>
          }
        >
          {loadingSummary ? (
            <div className="cell-sub" style={{ padding: 20 }}>
              Loading member data from secure portal ingress...
            </div>
          ) : portalSummary ? (
            <div className="stack" style={{ gap: 16 }}>
              <div className="card" style={{ background: 'var(--surface-2)', border: 'none' }}>
                <div className="card__body row row--between">
                  <span className="person">
                    <Avatar name={`${portalSummary.contact.firstName} ${portalSummary.contact.lastName}`} size="md" />
                    <span className="person__text">
                      <strong style={{ fontSize: 14 }}>
                        {portalSummary.contact.firstName} {portalSummary.contact.lastName}
                      </strong>
                      <span className="cell-sub">{portalSummary.contact.email} · {portalSummary.contact.company || 'Private Client'}</span>
                    </span>
                  </span>
                  <Badge tone="green">Verified Client Access</Badge>
                </div>
              </div>

              <div className="grid grid--3">
                <div className="card">
                  <div className="card__head">
                    <div className="card__title">Invoices ({portalSummary.invoices?.length || 0})</div>
                  </div>
                  <div className="card__body stack" style={{ gap: 8 }}>
                    {portalSummary.invoices?.length ? (
                      portalSummary.invoices.map((inv: any) => (
                        <div key={inv.id} className="row row--between" style={{ fontSize: 12 }}>
                          <span>{inv.number}</span>
                          <span className="row" style={{ gap: 6 }}>
                            <strong>{currency(inv.amount)}</strong>
                            <Badge tone={inv.status === 'paid' ? 'green' : 'amber'}>{inv.status}</Badge>
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="cell-sub">No outstanding invoices</div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="card__head">
                    <div className="card__title">Courses ({portalSummary.courses?.length || 0})</div>
                  </div>
                  <div className="card__body stack" style={{ gap: 8 }}>
                    {portalSummary.courses?.length ? (
                      portalSummary.courses.map((c: any) => (
                        <div key={c.courseId} style={{ fontSize: 12 }}>
                          <div className="row row--between">
                            <strong>{c.name}</strong>
                            <span className="cell-sub">{c.progress}%</span>
                          </div>
                          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${c.progress}%`, height: '100%', background: 'var(--accent)' }} />
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="cell-sub">No enrolled courses</div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="card__head">
                    <div className="card__title">Documents ({portalSummary.documents?.length || 0})</div>
                  </div>
                  <div className="card__body stack" style={{ gap: 8 }}>
                    {portalSummary.documents?.length ? (
                      portalSummary.documents.map((d: any) => (
                        <div key={d.id} className="row row--between" style={{ fontSize: 12 }}>
                          <span>{d.name || d.title}</span>
                          <Badge tone={d.status === 'signed' ? 'green' : 'blue'}>{d.status}</Badge>
                        </div>
                      ))
                    ) : (
                      <div className="cell-sub">No contracts or proposals</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="hint">
                Direct Portal Endpoint: <span className="mono-cell">/api/portal/summary/{portalSummary.contact.id}</span>
              </div>
            </div>
          ) : (
            <div className="cell-sub" style={{ padding: 20 }}>
              Unable to load portal summary. Ensure portal access is active.
            </div>
          )}
        </Modal>
      )}
      <PortalHub2Panel />
    </main>
  );
}