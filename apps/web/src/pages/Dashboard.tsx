import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Avatar, Badge, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { Donut, LineChart } from '../components/Chart';
import { useStore } from '../lib/store';
import { currency, num, pct, relative, sameDay, timeOf } from '../lib/format';
import { api } from '../lib/api';

export default function Dashboard() {
  const { state } = useStore();
  const [liveStats, setLiveStats] = useState<any>(null);

  useEffect(() => {
    let active = true;
    api.dashboard.getStats().then((res) => {
      if (active && res) setLiveStats(res);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const { contacts, opportunities, invoices, appointments, conversations, pipelines } = state;

  const paid = liveStats?.invoices?.totalInvoiced ?? invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const openValue = liveStats?.opportunities?.totalValue ?? opportunities
    .filter((o) => o.status === 'open')
    .reduce((s, o) => s + o.value, 0);
  const newLeads = liveStats?.contacts?.total ?? contacts.filter(
    (c) => Date.now() - new Date(c.createdAt).getTime() < 30 * 86_400_000,
  ).length;
  const todayAppointments = appointments
    .filter((a) => sameDay(new Date(a.start), new Date()) && a.status !== 'cancelled')
    .sort((a, b) => a.start.localeCompare(b.start));

  // Revenue by month across the last six months.
  const months: Array<{ label: string; key: string; value: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      key: `${d.getFullYear()}-${d.getMonth()}`,
      value: 0,
    });
  }
  invoices.forEach((inv) => {
    const d = new Date(inv.issuedAt);
    const bucket = months.find((m) => m.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (bucket) bucket.value += inv.amount;
  });

  const mainPipeline = pipelines[0];
  const stageMix = mainPipeline.stages.map((stage, i) => ({
    label: stage.name,
    value: opportunities.filter((o) => o.stageId === stage.id).length,
    color: ['#94a3b8', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981'][i % 5],
  }));

  const hotLeads = [...contacts]
    .filter((c) => c.tags.includes('hot-lead'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentConversations = [...conversations]
    .sort((a, b) => {
      const aLast = a.messages[a.messages.length - 1]?.at ?? '';
      const bLast = b.messages[b.messages.length - 1]?.at ?? '';
      return bLast.localeCompare(aLast);
    })
    .slice(0, 4);

  const contactOf = (id: string) => contacts.find((c) => c.id === id);

  return (
    <div className="content">
      <PageHeader
        title="Good afternoon, Asim"
        subtitle="Here is what is happening across your workspace today."
        actions={
          <>
            <Link className="btn" to="/reporting">
              <Icon name="chart" size={16} /> View report
            </Link>
            <Link className="btn btn--primary" to="/contacts">
              <Icon name="plus" size={16} /> New contact
            </Link>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 14 }}>
        <StatCard
          label="Collected revenue"
          value={currency(paid)}
          icon={<Icon name="wallet" size={15} />}
          trend={{ direction: 'up', value: '12.4%' }}
          meta="vs. last quarter"
        />
        <StatCard
          label="Open pipeline"
          value={currency(openValue)}
          icon={<Icon name="kanban" size={15} />}
          trend={{ direction: 'up', value: '8.1%' }}
          meta="across all stages"
        />
        <StatCard
          label="New leads (30d)"
          value={String(newLeads)}
          icon={<Icon name="users" size={15} />}
          trend={{ direction: 'up', value: '3.2%' }}
          meta="contacts created"
        />
        <StatCard
          label="Appointments today"
          value={String(todayAppointments.length)}
          icon={<Icon name="calendar" size={15} />}
          meta={
            todayAppointments[0]
              ? `Next at ${timeOf(todayAppointments[0].start)}`
              : 'Nothing scheduled'
          }
        />
      </div>

      <div className="grid grid--sidebar" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Billed revenue</div>
              <div className="card__sub">Invoices issued, last 6 months</div>
            </div>
            <div className="card__actions">
              <Badge tone="green" dot>
                Tracking
              </Badge>
            </div>
          </div>
          <div className="card__body">
            <LineChart
              labels={months.map((m) => m.label)}
              series={[{ name: 'Billed', color: '#4f46e5', values: months.map((m) => m.value) }]}
            />
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <div>
              <div className="card__title">Pipeline mix</div>
              <div className="card__sub">{mainPipeline.name}</div>
            </div>
          </div>
          <div className="card__body">
            <Donut
              segments={stageMix}
              centerLabel="open deals"
              centerValue={String(stageMix.reduce((s, x) => s + x.value, 0))}
              size={150}
            />
          </div>
        </div>
      </div>

      <div className="grid grid--sidebar">
        <div className="card">
          <div className="card__head">
            <div className="card__title">Hot leads</div>
            <div className="card__actions">
              <Link className="btn btn--ghost btn--sm" to="/contacts">
                View all
              </Link>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th className="cell-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {hotLeads.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="person" to={`/contacts/${c.id}`}>
                        <Avatar name={`${c.firstName} ${c.lastName}`} />
                        <span className="person__text">
                          <span className="person__name">
                            {c.firstName} {c.lastName}
                          </span>
                          <span className="person__sub">{c.company}</span>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <Badge>{c.source}</Badge>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{c.owner}</td>
                    <td className="cell-right cell-sub">{relative(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card__head">
              <div className="card__title">Today</div>
              <div className="card__actions">
                <Link className="btn btn--ghost btn--sm" to="/calendars">
                  Calendar
                </Link>
              </div>
            </div>
            {todayAppointments.length === 0 ? (
              <EmptyState icon={<Icon name="calendar" size={20} />} title="No appointments" text="Your day is clear." />
            ) : (
              <div>
                {todayAppointments.map((a) => (
                  <div className="list-row" key={a.id}>
                    <div style={{ fontSize: 12, fontWeight: 650, width: 52, color: 'var(--text-2)' }}>
                      {timeOf(a.start)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 550 }}>{a.title}</div>
                      <div className="cell-sub">{a.durationMin} min</div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__head">
              <div className="card__title">Inbox</div>
              <div className="card__actions">
                <Link className="btn btn--ghost btn--sm" to="/conversations">
                  Open
                </Link>
              </div>
            </div>
            {recentConversations.map((c) => {
              const contact = contactOf(c.contactId);
              const last = c.messages[c.messages.length - 1];
              if (!contact) return null;
              return (
                <Link className="list-row" key={c.id} to="/conversations">
                  <Avatar name={`${contact.firstName} ${contact.lastName}`} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {contact.firstName} {contact.lastName}
                      </span>
                      {c.unread > 0 && <Badge tone="accent">{c.unread}</Badge>}
                    </span>
                    <span className="cell-sub" style={{ display: 'block' }}>
                      {last?.body.slice(0, 42)}
                    </span>
                  </span>
                  <span className="cell-sub">{last ? relative(last.at) : ''}</span>
                </Link>
              );
            })}
          </div>

          <div className="card">
            <div className="card__head">
              <div className="card__title">Conversion</div>
            </div>
            <div className="card__body">
              <div className="row row--between" style={{ marginBottom: 8 }}>
                <span className="hint">Leads → customers</span>
                <strong style={{ fontSize: 13 }}>
                  {pct(
                    contacts.filter((c) => c.status === 'customer').length,
                    contacts.length,
                  )}
                </strong>
              </div>
              <div style={{ height: 8, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                <div
                  style={{
                    width: pct(contacts.filter((c) => c.status === 'customer').length, contacts.length),
                    height: '100%',
                    background: 'var(--green)',
                  }}
                />
              </div>
              <div className="hint" style={{ marginTop: 10 }}>
                {num(contacts.filter((c) => c.status === 'customer').length)} of {num(contacts.length)} contacts have
                purchased.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
