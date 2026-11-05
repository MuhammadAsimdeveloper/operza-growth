import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SearchBox } from '../components/AppShell';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { getDashboardMetrics } from '../lib/dashboardMetrics.mjs';

type AttentionItem = {
  label: string;
  detail: string;
  status: 'Review' | 'Healthy' | 'Setup' | 'Checking';
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
      status: metrics.pendingApprovals === null ? 'Checking' : metrics.pendingApprovals > 0 ? 'Review' : 'Healthy',
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
    { label: 'Contacts', value: formatCount(metrics.contacts), note: 'Customer records', icon: 'users' },
    { label: 'Open deals', value: formatCount(metrics.openDeals), note: 'Active pipeline', icon: 'kanban' },
    { label: 'Unread inbox', value: formatCount(metrics.unreadInbox), note: 'Needs response', icon: 'message' },
    { label: 'AI runs', value: formatCount(metrics.aiRuns24h), note: 'Last 24 hours', icon: 'sparkles' },
    { label: 'Queue', value: formatCount(metrics.pendingApprovals), note: 'Pending approvals', icon: 'clock' }
  ];

  const openAtlasCopilot = () => {
    window.dispatchEvent(new Event('atlas:open-copilot'));
  };

  return (
    <main className="atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__heading">
          <div className="atlas-dashboard__breadcrumb">Workspace <span>/</span> Control plane</div>
          <h1>Overview</h1>
        </div>
        <div className="atlas-dashboard__toolbar">
          <SearchBox />
          <Link className="atlas-quick-action-button" to="/workflows">
            <Icon name="plus" size={14} /> Quick action
          </Link>
        </div>
      </header>

      <section className="atlas-hero" aria-labelledby="atlas-hero-title">
        <div className="atlas-eyebrow">TODAY</div>
        <h2 id="atlas-hero-title">Run the business from one control plane.</h2>
        <p>CRM, conversations, automation, AI and revenue share one operational view.</p>
      </section>

      <section className="atlas-kpis" aria-label="Workspace metrics">
        {kpis.map((item) => (
          <article className="atlas-kpi" key={item.label}>
            <div className="atlas-kpi__label">{item.label}</div>
            <div className="atlas-kpi__value">{item.value}</div>
            <div className="atlas-kpi__note">{item.note}</div>
          </article>
        ))}
      </section>

      <div className="atlas-dashboard__columns">
        <section className="atlas-panel atlas-operating-panel" aria-labelledby="atlas-operating-title">
          <div className="atlas-panel__heading">
            <h2 id="atlas-operating-title">Operating picture</h2>
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

        <section className="atlas-panel atlas-quick-panel" id="atlas-quick-actions" aria-labelledby="atlas-quick-title">
          <div className="atlas-panel__heading">
            <h2 id="atlas-quick-title">Quick actions</h2>
          </div>
          <div className="atlas-quick-list">
            <Link to="/contacts"><Icon name="user-plus" size={15} /> Add contact <Icon name="arrow-up-right" size={14} /></Link>
            <Link to="/opportunities"><Icon name="plus-circle" size={15} /> Create opportunity <Icon name="arrow-up-right" size={14} /></Link>
            <Link to="/workflows"><Icon name="workflow" size={15} /> Start automation <Icon name="arrow-up-right" size={14} /></Link>
            <button type="button" onClick={openAtlasCopilot}><Icon name="sparkles" size={15} /> Ask Atlas <Icon name="arrow-up-right" size={14} /></button>
          </div>
        </section>
      </div>

      <p className="atlas-dashboard__footnote">Desktop-first workspace. Mobile keeps navigation, notifications and quick actions close at hand.</p>
    </main>
  );
}
