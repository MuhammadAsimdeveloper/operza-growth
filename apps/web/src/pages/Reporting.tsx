import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Avatar, Badge, PageHeader, StatCard } from '../components/ui';
import { BarChart, Donut, LineChart, Spark } from '../components/Chart';
import { uid, useStore } from '../lib/store';
import { currency, num, pct } from '../lib/format';
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
  const [creating, setCreating] = useState(false);
  const [addingWidget, setAddingWidget] = useState(false);

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

  return (
    <div className="content">
      <PageHeader
        title="Reporting"
        subtitle="Revenue, pipeline and marketing performance in one place."
        actions={
          <>
            <button className="btn">
              <Icon name="filter" size={15} /> Last 6 months
            </button>
            <button className="btn btn--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" size={15} /> New report
            </button>
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 16 }}>
        <StatCard label="Collected revenue" value={currency(collected)} icon={<Icon name="wallet" size={15} />} trend={{ direction: 'up', value: '12.4%' }} meta="vs. prior period" />
        <StatCard label="Won value" value={currency(wonValue)} icon={<Icon name="check" size={15} />} trend={{ direction: 'up', value: '6.8%' }} meta={`${won.length} deals`} />
        <StatCard label="Win rate" value={pct(won.length, closed.length || 1)} icon={<Icon name="chart" size={15} />} meta={`${closed.length} closed deals`} />
        <StatCard label="Email open rate" value={pct(Math.round(openRate * 100), 100)} icon={<Icon name="mail" size={15} />} meta={`${sent.length} campaigns`} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Custom dashboard</div>
            <div className="card__sub">Arrange your own mix of metrics, charts and ranges</div>
          </div>
          <div className="card__actions">
            <Badge>{dashboardWidgets.length} widgets</Badge>
            <button className="btn btn--sm" onClick={() => setAddingWidget(true)}>
              <Icon name="plus" size={14} /> Add widget
            </button>
          </div>
        </div>
        <div className="card__body">
          {dashboardWidgets.length === 0 ? (
            <div className="hint">No widgets yet — add one to build a dashboard that fits your week.</div>
          ) : (
            <div className="grid grid--3">
              {dashboardWidgets.map((widget, index) => {
                const meta = METRIC_META[widget.metric];
                const { current, delta, buckets } = reportSnapshot(state, widget);
                return (
                  <div
                    key={widget.id}
                    className="card"
                    style={{ boxShadow: 'none', background: 'var(--surface-2)' }}
                  >
                    <div className="card__head">
                      <div style={{ minWidth: 0 }}>
                        <div className="card__title">{widget.title}</div>
                        <div className="card__sub">
                          {meta.label} · last {widget.rangeDays} days
                        </div>
                      </div>
                      <div className="card__actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${widget.title} up`}
                          disabled={index === 0}
                          onClick={() => dispatch({ type: 'widget/move', id: widget.id, direction: 'up' })}
                        >
                          <Icon name="chevron-up" size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${widget.title} down`}
                          disabled={index === dashboardWidgets.length - 1}
                          onClick={() => dispatch({ type: 'widget/move', id: widget.id, direction: 'down' })}
                        >
                          <Icon name="chevron-down" size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove ${widget.title}`}
                          onClick={() => dispatch({ type: 'widget/delete', id: widget.id })}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="card__body stack" style={{ gap: 8 }}>
                      {widget.chart === 'stat' && (
                        <>
                          <div className="row row--between" style={{ alignItems: 'flex-end', gap: 8 }}>
                            <span style={{ fontSize: 24, fontWeight: 680, letterSpacing: '-0.02em' }}>
                              {formatMetric(widget.metric, current)}
                            </span>
                            <Spark values={buckets} color={meta.color} />
                          </div>
                          <div className="cell-sub">
                            {delta === null ? (
                              <span style={{ color: 'var(--green)' }}>New in this period</span>
                            ) : (
                              <span style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
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
                          height={140}
                        />
                      )}
                      {widget.chart === 'bar' && (
                        <BarChart
                          data={buckets.map((value, i) => ({ label: PERIOD_LABELS[i], value }))}
                          color={meta.color}
                          height={140}
                          valueFormat={(n) => (meta.money ? currency(Math.round(n), true) : num(n))}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Saved reports</div>
            <div className="card__sub">Each card recomputes from live workspace data</div>
          </div>
          <div className="card__actions">
            <Badge>{savedReports.length} saved</Badge>
          </div>
        </div>
        <div className="card__body">
          {savedReports.length === 0 ? (
            <div className="hint">No saved reports yet — create one to pin a metric and range.</div>
          ) : (
            <div className="grid grid--4">
              {savedReports.map((report) => {
                const meta = METRIC_META[report.metric];
                const { current, delta, buckets } = reportSnapshot(state, report);
                return (
                  <div
                    key={report.id}
                    className="stack"
                    style={{
                      gap: 8,
                      border: '1px solid var(--line)',
                      borderRadius: 10,
                      padding: 12,
                      background: 'var(--surface-2)',
                    }}
                  >
                    <div className="row row--between" style={{ gap: 6 }}>
                      <strong style={{ fontSize: 13 }}>{report.name}</strong>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Delete ${report.name}`}
                        onClick={() => dispatch({ type: 'report/delete', id: report.id })}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                    <div className="cell-sub">
                      {meta.label} · {report.rangeDays} days
                    </div>
                    <div className="row row--between" style={{ alignItems: 'flex-end', gap: 6 }}>
                      <span style={{ fontSize: 20, fontWeight: 680, letterSpacing: '-0.02em' }}>
                        {formatMetric(report.metric, current)}
                      </span>
                      <Spark values={buckets} color={meta.color} />
                    </div>
                    <div className="cell-sub">
                      {delta === null ? (
                        <span style={{ color: 'var(--green)' }}>New in this period</span>
                      ) : (
                        <span style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
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
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">Billed vs. collected</div>
            <div className="card__sub">Monthly totals from invoices</div>
          </div>
        </div>
        <div className="card__body">
          <LineChart
            labels={months.map((m) => m.label)}
            series={[
              { name: 'Billed', color: '#4f46e5', values: months.map((m) => m.billed) },
              { name: 'Collected', color: '#10b981', values: months.map((m) => m.collected) },
            ]}
            height={230}
          />
        </div>
      </div>

      <div className="grid grid--3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Leads by source</div>
          </div>
          <div className="card__body">
            <BarChart data={bySource} color="#0ea5e9" valueFormat={(n) => num(n)} height={200} />
          </div>
        </div>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Contact mix</div>
          </div>
          <div className="card__body">
            <Donut segments={statusMix} centerLabel="contacts" centerValue={num(contacts.length)} size={160} />
          </div>
        </div>
        <div className="card">
          <div className="card__head">
            <div className="card__title">Pipeline health</div>
          </div>
          <div className="card__body stack" style={{ gap: 13 }}>
            {state.pipelines[0].stages.map((stage) => {
              const deals = state.opportunities.filter((o) => o.stageId === stage.id);
              const value = deals.reduce((s, d) => s + d.value, 0);
              const max = Math.max(
                ...state.pipelines[0].stages.map((s) =>
                  state.opportunities.filter((o) => o.stageId === s.id).reduce((a, d) => a + d.value, 0),
                ),
                1,
              );
              return (
                <div key={stage.id}>
                  <div className="row row--between" style={{ marginBottom: 4 }}>
                    <span className="hint">{stage.name}</span>
                    <strong style={{ fontSize: 12.5 }}>{currency(value)}</strong>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ width: `${(value / max) * 100}%`, height: '100%', background: stage.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__head">
          <div className="card__title">Team performance</div>
          <div className="card__actions">
            <Badge>{team.length} members</Badge>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th className="cell-right">Deals</th>
                <th className="cell-right">Won</th>
                <th className="cell-right">Pipeline value</th>
                <th style={{ width: 150 }}>Win rate</th>
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
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ flex: 1, height: 5, background: 'var(--surface-3)', borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ width: `${Math.round(row.winRate * 100)}%`, height: '100%', background: 'var(--green)' }} />
                      </div>
                      <span className="cell-sub" style={{ width: 30, textAlign: 'right' }}>
                        {Math.round(row.winRate * 100)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating && <ReportModal onClose={() => setCreating(false)} />}
      {addingWidget && <AddWidgetModal onClose={() => setAddingWidget(false)} />}
    </div>
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
      title="Add dashboard widget"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Add widget
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="widget-title">Widget title</label>
        <input
          id="widget-title"
          className="input"
          autoFocus
          placeholder="Weekly revenue"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid grid--2" style={{ marginTop: 12 }}>
        <div className="field">
          <label htmlFor="widget-metric">Metric</label>
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
          <label htmlFor="widget-range">Range</label>
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
        <label>Visualization</label>
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
        Trend and bar widgets split the range into six equal periods and recompute from live invoices,
        opportunities and contacts.
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
      title="New saved report"
      onClose={onClose}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="button" disabled={!canSave} onClick={save}>
            Save report
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="field">
          <label htmlFor="report-name">Report name</label>
          <input
            id="report-name"
            className="input"
            autoFocus
            placeholder="Q4 revenue pulse"
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
            <label htmlFor="report-range">Range</label>
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
          Values are computed from invoices, opportunities and contacts inside the selected window,
          with the previous window shown as a delta.
        </div>
      </div>
    </Modal>
  );
}
