import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { getDashboardMetrics } from '../lib/dashboardMetrics.mjs';

type AttentionItem = {
  label: string;
  detail: string;
  status: 'Review' | 'Healthy' | 'Setup' | 'Checking' | 'Unavailable';
  to: string;
};

function formatCount(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat().format(value);
}

function StatusPill({ status }: { status: AttentionItem['status'] }) {
  return <span className={`atlas-status atlas-status--${status.toLowerCase()}`}>{status}</span>;
}

export default function Dashboard() {
  const { state } = useStore();
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const [approvalStatusLoaded, setApprovalStatusLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    api.workflows.getRuns()
      .then((response: any) => {
        const runs = Array.isArray(response) ? response : Array.isArray(response?.data) ? response.data : [];
        if (active) {
          setPendingApprovals(runs.filter((run: any) => run?.status === 'waiting_approval').length);
          setApprovalStatusLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setPendingApprovals(null);
          setApprovalStatusLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const metrics = useMemo(() => getDashboardMetrics({
    contacts: state.contacts,
    opportunities: state.opportunities,
    conversations: state.conversations,
    workflows: state.workflows,
    workflowRuns: state.workflowRuns,
    integrations: state.integrations,
    pendingApprovals,
    now: Date.now()
  }), [
    state.contacts,
    state.opportunities,
    state.conversations,
    state.workflows,
    state.workflowRuns,
    state.integrations,
    pendingApprovals
  ]);

  const attentionItems: AttentionItem[] = [
    {
      label: metrics.unreadInbox === 1 ? '1 unread conversation' : `${formatCount(metrics.unreadInbox)} unread conversations`,
      detail: 'Messages that may need a response',
      status: metrics.unreadInbox > 0 ? 'Review' : 'Healthy',
      to: '/conversations'
    },
    {
      label: metrics.pendingApprovals === null ? 'Approval queue unavailable' :
        metrics.pendingApprovals === 1 ? '1 approval waiting' : `${formatCount(metrics.pendingApprovals)} approvals waiting`,
      detail: approvalStatusLoaded ? 'Human review before execution' : 'Checking approval status',
      status: metrics.pendingApprovals === null ? (approvalStatusLoaded ? 'Unavailable' : 'Checking') : metrics.pendingApprovals > 0 ? 'Review' : 'Healthy',
      to: '/workflows'
    },
    {
      label: metrics.disconnectedIntegrations === 1 ? '1 integration needs setup' :
        `${formatCount(metrics.disconnectedIntegrations)} integrations need setup`,
      detail: 'Available connections not yet connected',
      status: metrics.disconnectedIntegrations > 0 ? 'Setup' : 'Healthy',
      to: '/integrations'
    },
    {
      label: metrics.failedRuns24h === 1 ? '1 failed automation run' :
        `${formatCount(metrics.failedRuns24h)} failed automation runs`,
      detail: 'Execution failures in the last 24 hours',
      status: metrics.failedRuns24h > 0 ? 'Review' : 'Healthy',
      to: '/workflows'
    }
  ];

  const kpis = [
    { label: 'Contacts', value: formatCount(metrics.contacts), note: 'Customer records', icon: 'users', trend: '+14%' },
    { label: 'Open deals', value: formatCount(metrics.openDeals), note: 'Active pipeline', icon: 'kanban', trend: '+9%' },
    { label: 'Unread inbox', value: formatCount(metrics.unreadInbox), note: 'Needs response', icon: 'message', trend: metrics.unreadInbox > 0 ? 'Review' : 'Zero' },
    { label: 'AI runs', value: formatCount(metrics.aiRuns24h), note: 'Last 24 hours', icon: 'sparkles', trend: '+28%' },
    { label: 'Queue', value: formatCount(metrics.pendingApprovals), note: 'Pending approvals', icon: 'clock', trend: metrics.pendingApprovals && metrics.pendingApprovals > 0 ? 'Waiting' : 'Clear' }
  ];

  const stageStats = useMemo(() => {
    const opps = state.opportunities || [];
    const stages = [
      { name: 'Lead Capture', color: '#6366f1' },
      { name: 'Qualified', color: '#3b82f6' },
      { name: 'Proposal Sent', color: '#8b5cf6' },
      { name: 'Negotiation', color: '#ec4899' },
      { name: 'Closed Won', color: '#10b981' }
    ];
    const total = opps.length || 1;
    return stages.map((s) => {
      const count = opps.filter((o: any) => (o.stage || '').toLowerCase().includes(s.name.toLowerCase().split(' ')[0])).length;
      const pct = Math.max(8, Math.round((count / total) * 100));
      return { ...s, count, pct };
    });
  }, [state.opportunities]);

  const openOperzaCopilot = () => {
    window.dispatchEvent(new Event('operza:open-copilot'));
    window.dispatchEvent(new Event('atlas:open-copilot'));
  };

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Control plane</div>
          <h1>Overview</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <Link className="atlas-quick-action-button" to="/workflows">
            <Icon name="plus" size={14} /> Quick action
          </Link>
        </div>
      </header>

      <section className="atlas-hero" aria-labelledby="operza-hero-title">
        <div className="atlas-eyebrow">TODAY</div>
        <h2 id="operza-hero-title">Run the business from one unified control plane.</h2>
        <p>CRM, omnichannel conversations, automation, AI swarm, and revenue share one authoritative operational view.</p>
      </section>

      <section className="atlas-kpis" aria-label="Workspace metrics">
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
              <path d="M0 16 Q25 12 50 6 T100 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--accent)', opacity: 0.8 }} />
            </svg>
          </article>
        ))}
      </section>

      {/* Interactive Deal Velocity Funnel */}
      <section className="card-premium" style={{ marginTop: 22, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Pipeline Deal Velocity</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Conversion throughput across active CRM opportunity stages</div>
          </div>
          <div style={{ display: 'inline-flex', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '3px 8px', borderRadius: 'var(--r-pill)' }}>
              Live Stream
            </span>
          </div>
        </div>

        <div className="pipeline-bars">
          {stageStats.map((st) => (
            <div key={st.name} className="pipeline-bar-row">
              <span className="pipeline-bar-label">{st.name}</span>
              <div className="pipeline-bar-track">
                <div
                  className="pipeline-bar-fill"
                  style={{ width: `${st.pct}%`, backgroundColor: st.color }}
                />
              </div>
              <span className="pipeline-bar-val tabular">{st.count} {st.count === 1 ? 'deal' : 'deals'}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="atlas-dashboard__columns">
        <section className="atlas-panel atlas-operating-panel" aria-labelledby="operza-operating-title">
          <div className="atlas-panel__heading">
            <h2 id="operza-operating-title">Operating picture</h2>
            <p>What needs attention right now</p>
          </div>
          <div className="atlas-attention-list">
            {attentionItems.map((item) => (
              <Link className="atlas-attention-row" to={item.to} key={item.label}>
                <span className="atlas-attention-row__copy">
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </span>
                <StatusPill status={item.status} />
              </Link>
            ))}
          </div>
        </section>

        <section className="atlas-panel atlas-quick-panel" id="atlas-quick-actions" aria-labelledby="operza-quick-title">
          <div className="atlas-panel__heading">
            <h2 id="operza-quick-title">Quick actions</h2>
          </div>
          <div className="atlas-quick-list">
            <Link to="/contacts" state={{ openAddContact: true }}><Icon name="users" size={15} /> Add contact <Icon name="arrow-right" size={14} /></Link>
            <Link to="/opportunities"><Icon name="plus" size={15} /> Create opportunity <Icon name="arrow-up-right" size={14} /></Link>
            <Link to="/workflows"><Icon name="zap" size={15} /> Start automation <Icon name="arrow-up-right" size={14} /></Link>
            <button type="button" onClick={openOperzaCopilot}><Icon name="sparkles" size={15} /> Ask Operza Copilot <Icon name="arrow-up-right" size={14} /></button>
          </div>
        </section>
      </div>

      <p className="atlas-dashboard__footnote">Desktop-first workspace. Mobile keeps navigation, notifications and quick actions close at hand.</p>
    </main>
  );
}
