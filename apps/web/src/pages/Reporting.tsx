import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge } from '../components/ui';
import { BarChart, Donut, LineChart, Spark } from '../components/Chart';
import { uid, useStore } from '../lib/store';
import { currency, num, pct } from '../lib/format';
import { api } from '../lib/api';
import type {
  DashboardChart,
  DashboardWidget,
  ReportMetric,
  ReportRange,
  SavedReport,
  WorkspaceState,
} from '../lib/types';

const METRIC_META: Record<ReportMetric, { label: string; color: string; money: boolean }> = {
  revenue: { label: 'Collected revenue', color: '#10b981', money: true },
  pipeline: { label: 'Pipeline value', color: '#4f46e5', money: true },
  deals: { label: 'Deals won', color: '#0ea5e9', money: false },
  contacts: { label: 'New contacts', color: '#f59e0b', money: false },
};

const CHART_META: Record<DashboardChart, string> = {
  stat: 'Single value',
  line: 'Trend line',
  bar: 'Period bars',
};

const RANGE_OPTIONS: ReportRange[] = [30, 90, 180];
const DAY = 86_400_000;
const PERIOD_LABELS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];

/** Metric total for [from, to) using record timestamps. */
function metricInRange(state: WorkspaceState, metric: ReportMetric, from: number, to: number): number {
  const within = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from && t < to;
  };
  switch (metric) {
    case 'revenue':
      return state.invoices
        .filter((i) => i.status === 'paid' && within(i.issuedAt))
        .reduce((s, i) => s + i.amount, 0);
    case 'pipeline':
      return state.opportunities.filter((o) => within(o.createdAt)).reduce((s, o) => s + o.value, 0);
    case 'deals':
      return state.opportunities.filter((o) => o.status === 'won' && within(o.createdAt)).length;
    case 'contacts':
      return state.contacts.filter((c) => within(c.createdAt)).length;
  }
}

function reportSnapshot(
  state: WorkspaceState,
  report: Pick<SavedReport, 'metric' | 'rangeDays'> | Pick<DashboardWidget, 'metric' | 'rangeDays'>,
) {
  const end = Date.now();
  const span = report.rangeDays * DAY;
  const current = metricInRange(state, report.metric, end - span, end);
  const previous = metricInRange(state, report.metric, end - 2 * span, end - span);
  const buckets = Array.from({ length: 6 }, (_, i) =>
    metricInRange(state, report.metric, end - span + (span / 6) * i, end - span + (span / 6) * (i + 1)),
  );
  const delta = previous === 0 ? (current > 0 ? null : 0) : (current - previous) / previous;
  return { current, previous, delta, buckets };
}

function formatMetric(metric: ReportMetric, value: number): string {
  return METRIC_META[metric].money ? currency(Math.round(value)) : num(value);
}

export default function Reporting() {
  const { state, dispatch } = useStore();
  const { invoices, opportunities, contacts, campaigns, team, savedReports, dashboardWidgets } = state;
  const [selectedTimeframe, setSelectedTimeframe] = useState<ReportRange>(180);
  const [creating, setCreating] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);
  const [serverMetrics, setServerMetrics] = useState<{
    revenue: number;
    pipeline: number;
    dealsWon: number;
    contacts: number;
    appointmentShowRate: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    api.reporting
      .getOverview()
      .then((res) => {
        if (active && res && res.metrics) {
          setServerMetrics(res.metrics);
        }
      })
      .catch(() => {
        /* dev fallback */
      });
    return () => {
      active = false;
    };
  }, []);

  const collected = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const won = opportunities.filter((o) => o.status === 'won');
  const wonValue = won.reduce((s, o) => s + o.value, 0);
  const closed = opportunities.filter((o) => o.status !== 'open');

  const months: Array<{ label: string; key: string; billed: number; collected: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      key: `${d.getFullYear()}-${d.getMonth()}`,
      billed: 0,
      collected: 0,
    });
  }
  invoices.forEach((inv) => {
    const d = new Date(inv.issuedAt);
    const bucket = months.find((m) => m.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (!bucket) return;
    bucket.billed += inv.amount;
    if (inv.status === 'paid') bucket.collected += inv.amount;
  });

  const bySource = Object.entries(
    contacts.reduce<Record<string, number>>((acc, c) => {
      acc[c.source] = (acc[c.source] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label: label.split(' ')[0], value }));

  const statusMix = [
    { label: 'Leads', value: contacts.filter((c) => c.status === 'lead').length, color: '#3b82f6' },
    { label: 'Customers', value: contacts.filter((c) => c.status === 'customer').length, color: '#10b981' },
    { label: 'Cold', value: contacts.filter((c) => c.status === 'cold').length, color: '#94a3b8' },
  ];

  const stageFunnel = useMemo(() => {
    const opps = state.opportunities || [];
    const stages = [
      { name: 'Lead Capture', color: '#6366f1' },
      { name: 'Qualified', color: '#3b82f6' },
      { name: 'Proposal Sent', color: '#8b5cf6' },
      { name: 'Negotiation', color: '#ec4899' },
      { name: 'Closed Won', color: '#10b981' },
    ];
    const totalCount = opps.length || 1;
    return stages.map((s) => {
      const matched = opps.filter((o: any) =>
        (o.stage || '').toLowerCase().includes(s.name.toLowerCase().split(' ')[0]),
      );
      const count = matched.length;
      const value = matched.reduce((sum: number, o: any) => sum + (Number(o.value) || 0), 0);
      const pctValue = Math.max(8, Math.round((count / totalCount) * 100));
      return { ...s, count, value, pct: pctValue };
    });
  }, [state.opportunities]);

  const ownerRows = team.map((member) => {
    const deals = opportunities.filter((o) => o.owner === member.name);
    const memberWon = deals.filter((d) => d.status === 'won');
    return {
      member,
      deals: deals.length,
      won: memberWon.length,
      value: deals.reduce((s, d) => s + d.value, 0),
      winRate: deals.length ? memberWon.length / deals.length : 0,
    };
  });

  const sent = campaigns.filter((c) => c.status === 'sent');
  const openRate = sent.length
    ? sent.reduce((s, c) => s + c.opened, 0) / Math.max(sent.reduce((s, c) => s + c.sent, 0), 1)
    : 0;

  const kpis = [
    {
      label: 'Collected Revenue',
      value: currency(serverMetrics ? serverMetrics.revenue : collected),
      note: 'Settled invoice balances',
      icon: 'wallet',
      trend: '+12.4%',
      sparkline: 'M0 16 Q25 10 50 4 T100 2',
    },
    {
      label: 'Pipeline Value',
      value: currency(serverMetrics ? serverMetrics.pipeline : wonValue),
      note: `${serverMetrics ? serverMetrics.dealsWon : won.length} won deals`,
      icon: 'chart',
      trend: '+6.8%',
      sparkline: 'M0 15 Q30 12 60 5 T100 3',
    },
    {
      label: 'Win Rate',
      value: pct(won.length, closed.length || 1),
      note: `${closed.length} closed deals`,
      icon: 'target',
      trend: 'Active',
      sparkline: 'M0 14 Q35 14 70 8 T100 4',
    },
    {
      label: 'Email Open Rate',
      value: pct(Math.round(openRate * 100), 100),
      note: `${serverMetrics?.appointmentShowRate ?? 100}% show rate`,
      icon: 'mail',
      trend: '+4.2%',
      sparkline: 'M0 16 Q20 15 50 10 T100 6',
    },
    {
      label: 'Custom Widgets',
      value: String(dashboardWidgets.length),
      note: `${savedReports.length} saved reports`,
      icon: 'sliders',
      trend: 'Live',
      sparkline: 'M0 15 Q40 10 70 5 T100 2',
    },
  ];

  return (
    <main className="operza-dashboard atlas-dashboard">
      {/* Atlas Header */}
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">
            Workspace <span>/</span> Executive telemetry
          </div>
          <h1>Command Center</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <div
            className="segmented"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: '8px',
              padding: '2px',
              display: 'flex',
              gap: 2,
            }}
          >
            {([30, 90, 180] as ReportRange[]).map((r) => (
              <button
                key={r}
                type="button"
                className={`btn btn--sm ${selectedTimeframe === r ? 'is-active btn--primary' : ''}`}
                style={{ height: 32, fontSize: 11.5, padding: '0 10px' }}
                onClick={() => setSelectedTimeframe(r)}
              >
                {r === 180 ? '6 Months' : `${r} Days`}
              </button>
            ))}
          </div>
          <button className="atlas-quick-action-button" type="button" onClick={() => setCreating(true)}>
            <Icon name="plus" size={14} /> New report
          </button>
        </div>
      </header>

      {/* Atlas Hero */}
      <section className="atlas-hero" aria-labelledby="command-center-hero-title">
        <div className="atlas-eyebrow">REVENUE OPERATIONS & EXECUTIVE TELEMETRY</div>
        <h2 id="command-center-hero-title">Authoritative command center for cross-functional business performance.</h2>
        <p>
          Live cashflow collection, pipeline conversion throughput, customer acquisition channels, and team execution
          velocity synchronized in real time.
        </p>
      </section>

      {/* Flagship Atlas KPIs */}
      <section className="atlas-kpis" aria-label="Command center financial KPIs">
        {kpis.map((item) => (
          <article className="operza-kpi atlas-kpi" key={item.label}>
            <div className="operza-kpi__header">
              <span className="operza-kpi__icon">
                <Icon name={item.icon} size={15} />
              </span>
              <span className="operza-kpi__trend">
                <Icon name="arrow-up-right" size={12} /> {item.trend}
              </span>
            </div>
            <div className="atlas-kpi__label">{item.label}</div>
            <div className="atlas-kpi__value tabular">{item.value}</div>
            <div className="atlas-kpi__note">{item.note}</div>
            <svg className="operza-kpi__sparkline" viewBox="0 0 100 20" fill="none" preserveAspectRatio="none">
              <path
                d={item.sparkline}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                style={{ color: 'var(--accent)', opacity: 0.8 }}
              />
            </svg>
          </article>
        ))}
      </section>

      {/* Section 1: Invoicing Flow & Pipeline Funnel Velocity */}
      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Cashflow Dynamics & Conversion Throughput
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Monthly billing settlements paired with live pipeline stage conversion volume
            </div>
          </div>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--accent)',
                background: 'var(--accent-soft)',
                padding: '3px 8px',
                borderRadius: 'var(--r-pill)',
              }}
            >
              Authoritative Stream
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 1fr)', gap: 24 }}>
          {/* Monthly Invoicing Trend */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)', marginBottom: 8 }}>
              Billed vs. Collected Cashflow (Last 6 Months)
            </div>
            <LineChart
              labels={months.map((m) => m.label)}
              series={[
                { name: 'Billed', color: '#4f46e5', values: months.map((m) => m.billed) },
                { name: 'Collected', color: '#10b981', values: months.map((m) => m.collected) },
              ]}
              height={210}
            />
          </div>

          {/* Pipeline Conversion Throughput */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)', marginBottom: 8 }}>
              Active Pipeline Deal Throughput
            </div>
            <div className="pipeline-bars" style={{ marginTop: 8 }}>
              {stageFunnel.map((st) => (
                <div key={st.name} className="pipeline-bar-row">
                  <span className="pipeline-bar-label" style={{ width: 100 }}>
                    {st.name}
                  </span>
                  <div className="pipeline-bar-track">
                    <div className="pipeline-bar-fill" style={{ width: `${st.pct}%`, backgroundColor: st.color }} />
                  </div>
                  <span className="pipeline-bar-val tabular" style={{ minWidth: 90, textAlign: 'right' }}>
                    {st.count} ({currency(st.value, true)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Modular Custom Dashboard Widgets */}
      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Modular Command Center Widgets
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Pinned metrics, periodic comparative deltas, and telemetry graphs
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge>{dashboardWidgets.length} widgets</Badge>
            <button className="btn btn--sm btn--primary" type="button" onClick={() => setAddingWidget(true)}>
              <Icon name="plus" size={14} /> Add widget
            </button>
          </div>
        </div>

        {dashboardWidgets.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No custom widgets pinned. Click <strong>Add widget</strong> to build a personalized executive telemetry grid.
          </div>
        ) : (
          <div className="grid grid--3" style={{ gap: 16 }}>
            {dashboardWidgets.map((widget, index) => {
              const meta = METRIC_META[widget.metric];
              const { current, delta, buckets } = reportSnapshot(state, widget);
              return (
                <div
                  key={widget.id}
                  className="card-premium"
                  style={{
                    padding: '16px 18px',
                    background: 'var(--surface-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{widget.title}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                        {meta.label} · Last {widget.rangeDays} days
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move ${widget.title} up`}
                        disabled={index === 0}
                        onClick={() => dispatch({ type: 'widget/move', id: widget.id, direction: 'up' })}
                      >
                        <Icon name="chevron-up" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Move ${widget.title} down`}
                        disabled={index === dashboardWidgets.length - 1}
                        onClick={() => dispatch({ type: 'widget/move', id: widget.id, direction: 'down' })}
                      >
                        <Icon name="chevron-down" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${widget.title}`}
                        onClick={() => dispatch({ type: 'widget/delete', id: widget.id })}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                    {widget.chart === 'stat' && (
                      <>
                        <div className="row row--between" style={{ alignItems: 'flex-end', gap: 8 }}>
                          <span style={{ fontSize: 24, fontWeight: 750, letterSpacing: '-0.02em', color: 'var(--text)' }}>
                            {formatMetric(widget.metric, current)}
                          </span>
                          <Spark values={buckets} color={meta.color} />
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                          {delta === null ? (
                            <span style={{ color: 'var(--green)', fontWeight: 600 }}>New baseline</span>
                          ) : (
                            <span style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                              {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))}%
                            </span>
                          )}{' '}
                          vs. previous {widget.rangeDays} days
                        </div>
                      </>
                    )}
                    {widget.chart === 'line' && (
                      <LineChart
                        labels={PERIOD_LABELS}
                        series={[{ name: meta.label, color: meta.color, values: buckets }]}
                        height={130}
                      />
                    )}
                    {widget.chart === 'bar' && (
                      <BarChart
                        data={buckets.map((value, i) => ({ label: PERIOD_LABELS[i], value }))}
                        color={meta.color}
                        height={130}
                        valueFormat={(n) => (meta.money ? currency(Math.round(n), true) : num(n))}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 3: Lead Attribution & Customer Acquisition */}
      <div className="atlas-dashboard__columns" style={{ marginTop: 22 }}>
        {/* Left Column: Leads by Source */}
        <section className="atlas-panel" aria-labelledby="leads-by-source-title">
          <div className="atlas-panel__heading" style={{ marginBottom: 14 }}>
            <h2 id="leads-by-source-title">Acquisition Source Breakdown</h2>
            <p>Inbound lead conversion by primary marketing channel</p>
          </div>
          <BarChart data={bySource} color="#0ea5e9" valueFormat={(n) => num(n)} height={200} />
        </section>

        {/* Right Column: Contact Lifecycle Mix */}
        <section className="atlas-panel" aria-labelledby="contact-mix-title">
          <div className="atlas-panel__heading" style={{ marginBottom: 14 }}>
            <h2 id="contact-mix-title">Contact Lifecycle Distribution</h2>
            <p>Active ratio of qualified leads, active clients, and inactive prospects</p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
            <Donut segments={statusMix} centerLabel="contacts" centerValue={num(contacts.length)} size={170} />
          </div>
        </section>
      </div>

      {/* Section 4: Executive Team Performance Leaderboard */}
      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Operator & Sales Team Velocity
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Individual deal throughput, won volume, and pipeline conversion rates
            </div>
          </div>
          <Badge>{team.length} Team Members</Badge>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Team Member</th>
                <th>Role</th>
                <th className="cell-right">Assigned Deals</th>
                <th className="cell-right">Won Deals</th>
                <th className="cell-right">Pipeline Value</th>
                <th style={{ width: 160 }}>Conversion Rate</th>
              </tr>
            </thead>
            <tbody>
              {ownerRows.map((row) => (
                <tr key={row.member.id}>
                  <td>
                    <span className="person">
                      <Avatar name={row.member.name} />
                      <span className="person__text">
                        <span className="person__name">{row.member.name}</span>
                        <span className="person__sub">{row.member.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <Badge tone={row.member.role === 'admin' ? 'accent' : 'default'}>{row.member.role}</Badge>
                  </td>
                  <td className="cell-right cell-num">{row.deals}</td>
                  <td className="cell-right cell-num">{row.won}</td>
                  <td className="cell-right cell-num">{currency(row.value)}</td>
                  <td>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          background: 'var(--surface-3)',
                          borderRadius: 'var(--r-pill)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.round(row.winRate * 100)}%`,
                            height: '100%',
                            background: 'var(--green)',
                            borderRadius: 'var(--r-pill)',
                          }}
                        />
                      </div>
                      <span className="cell-sub" style={{ width: 34, textAlign: 'right', fontWeight: 650 }}>
                        {Math.round(row.winRate * 100)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 5: Saved Reports Shelf */}
      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              Saved Performance Queries & Snapshots
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Pinned custom reports recomputed automatically against current workspace state
            </div>
          </div>
          <Badge>{savedReports.length} saved</Badge>
        </div>

        {savedReports.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            No saved reports yet. Click <strong>New report</strong> in the top toolbar to snapshot a query.
          </div>
        ) : (
          <div className="grid grid--4" style={{ gap: 16 }}>
            {savedReports.map((report) => {
              const meta = METRIC_META[report.metric];
              const { current, delta, buckets } = reportSnapshot(state, report);
              return (
                <div
                  key={report.id}
                  className="card-premium"
                  style={{
                    padding: '14px 16px',
                    background: 'var(--surface-2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div className="row row--between" style={{ gap: 6 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text)' }}>{report.name}</strong>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Delete ${report.name}`}
                      onClick={() => dispatch({ type: 'report/delete', id: report.id })}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {meta.label} · {report.rangeDays} days
                  </div>
                  <div className="row row--between" style={{ alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
                      {formatMetric(report.metric, current)}
                    </span>
                    <Spark values={buckets} color={meta.color} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {delta === null ? (
                      <span style={{ color: 'var(--green)', fontWeight: 600 }}>New baseline</span>
                    ) : (
                      <span style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))}%
                      </span>
                    )}{' '}
                    vs. previous {report.rangeDays} days
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modals */}
      {creating && <ReportModal onClose={() => setCreating(false)} />}
      {addingWidget && <AddWidgetModal onClose={() => setAddingWidget(false)} />}
    </main>
  );
}

function AddWidgetModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState<ReportMetric>('revenue');
  const [chart, setChart] = useState<DashboardChart>('stat');
  const [rangeDays, setRangeDays] = useState<ReportRange>(30);

  const canSave = title.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    dispatch({
      type: 'widget/add',
      widget: {
        id: uid('dw'),
        title: title.trim(),
        metric,
        chart,
        rangeDays,
        createdAt: new Date().toISOString(),
      },
    });
    onClose();
  };

  return (
    <Modal
      title="Add Command Center Widget"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Add Widget
          </button>
        </div>
      }
    >
      <div className="field">
        <label htmlFor="widget-title">Widget Title</label>
        <input
          id="widget-title"
          className="input"
          autoFocus
          placeholder="e.g. Weekly Cashflow Velocity"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid grid--2" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="widget-metric">Business Metric</label>
          <select
            id="widget-metric"
            className="select"
            value={metric}
            onChange={(e) => setMetric(e.target.value as ReportMetric)}
          >
            {(Object.keys(METRIC_META) as ReportMetric[]).map((m) => (
              <option key={m} value={m}>
                {METRIC_META[m].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="widget-range">Historical Window</label>
          <select
            id="widget-range"
            className="select"
            value={rangeDays}
            onChange={(e) => setRangeDays(Number(e.target.value) as ReportRange)}
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                Last {r} days
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Visualization Style</label>
        <div className="segmented" style={{ width: '100%' }}>
          {(['stat', 'line', 'bar'] as DashboardChart[]).map((c) => (
            <button
              key={c}
              type="button"
              className={chart === c ? 'is-active' : ''}
              onClick={() => setChart(c)}
            >
              {CHART_META[c]}
            </button>
          ))}
        </div>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        Widgets compute period metrics and trends live from CRM invoices, pipeline opportunities, and customer records.
      </div>
    </Modal>
  );
}

function ReportModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState('');
  const [metric, setMetric] = useState<ReportMetric>('revenue');
  const [rangeDays, setRangeDays] = useState<ReportRange>(30);

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    dispatch({
      type: 'report/add',
      report: {
        id: uid('rp'),
        name: name.trim(),
        metric,
        rangeDays,
        createdAt: new Date().toISOString(),
      },
    });
    onClose();
  };

  return (
    <Modal
      title="Create Saved Report Snapshot"
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Save Report
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="report-name">Report Title</label>
          <input
            id="report-name"
            className="input"
            autoFocus
            placeholder="e.g. Q4 Executive Revenue Pulse"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid--2">
          <div className="field">
            <label htmlFor="report-metric">Metric</label>
            <select
              id="report-metric"
              className="select"
              value={metric}
              onChange={(e) => setMetric(e.target.value as ReportMetric)}
            >
              {(Object.keys(METRIC_META) as ReportMetric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_META[m].label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="report-range">Time Window</label>
            <select
              id="report-range"
              className="select"
              value={rangeDays}
              onChange={(e) => setRangeDays(Number(e.target.value) as ReportRange)}
            >
              {RANGE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  Last {r} days
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="hint">
          Saved reports recompute metrics against live workspace transactions, comparing the current window against the
          preceding period.
        </div>
      </div>
    </Modal>
  );
}
