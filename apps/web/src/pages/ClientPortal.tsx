import { Icon } from '../components/Icon';
import { Avatar, Badge, PageHeader, StatCard, Switch } from '../components/ui';
import { useStore } from '../lib/store';
import { num, shortDate } from '../lib/format';

const PORTAL_FEATURES = [
  { icon: 'file', title: 'Contracts & proposals', text: 'Members review and sign documents in the portal.' },
  { icon: 'book', title: 'Courses & lessons', text: 'Any published membership offer appears automatically.' },
  { icon: 'wallet', title: 'Invoices & payments', text: 'Outstanding balances with a pay-now link.' },
  { icon: 'calendar', title: 'Bookings', text: 'Members reschedule appointments without emailing.' },
];

export default function ClientPortal() {
  const { state, dispatch } = useStore();
  const members = state.contacts.filter((c) => c.portalAccess);
  const candidates = state.contacts.filter((c) => !c.portalAccess).slice(0, 4);

  const sharedDocs = state.documents.filter((d) => members.some((m) => m.id === d.contactId)).length;
  const seats = state.enrollments.filter((e) => members.some((m) => m.id === e.contactId)).length;

  return (
    <div className="content">
      <PageHeader
        title="Client Portal"
        subtitle="A branded space where clients see documents, courses and invoices."
        actions={
          <>
            <button className="btn">
              <Icon name="globe" size={15} /> Preview portal
            </button>
            <button className="btn btn--primary">
              <Icon name="settings" size={15} /> Portal settings
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Portal members" value={num(members.length)} icon={<Icon name="users" size={15} />} meta={`${candidates.length} invites pending`} />
        <StatCard label="Shared documents" value={num(sharedDocs)} icon={<Icon name="file" size={15} />} meta="visible to members" />
        <StatCard label="Course seats" value={num(seats)} icon={<Icon name="book" size={15} />} meta="inside the portal" />
        <StatCard label="Pending invites" value={num(candidates.length)} icon={<Icon name="clock" size={15} />} meta="contacts without access" />
      </div>

      <div className="grid grid--2" style={{ marginBottom: 16 }}>
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
                  <th className="cell-right" style={{ width: 80 }}>
                    Access
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
                    <td>{m.company}</td>
                    <td className="cell-right">
                      <span style={{ display: 'inline-flex' }}>
                        <Switch
                          on
                          label={`Revoke portal access for ${m.firstName}`}
                          onChange={() =>
                            dispatch({ type: 'contact/update', id: m.id, patch: { portalAccess: false } })
                          }
                        />
                      </span>
                    </td>
                  </tr>
                ))}
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
                    <span className="person__sub">Contact since {shortDate(c.createdAt)}</span>
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    dispatch({ type: 'contact/update', id: c.id, patch: { portalAccess: true } })
                  }
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
    </div>
  );
}
