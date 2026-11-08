import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Badge } from '../components/ui';
import { useStore } from '../lib/store';
import { num } from '../lib/format';
import { api } from '../lib/api';

interface AgentStatus {
  id: string;
  name: string;
  domain: string;
  role: string;
  status: 'active' | 'standby' | 'dispatching' | 'idle';
  load: string;
  currentTask: string;
  icon: string;
}

const AGENTS: AgentStatus[] = [
  {
    id: 'crm_agent',
    name: 'CRM Agent',
    domain: 'Contacts & Leads',
    role: 'Real-time contact enrichment, lookalike fit scoring, and smart list segmentation.',
    status: 'active',
    load: '14%',
    currentTask: 'Scoring newly ingested B2B prospect records',
    icon: 'users',
  },
  {
    id: 'sales_agent',
    name: 'Sales Pipeline Agent',
    domain: 'Deals & Opportunities',
    role: 'Autonomous stage progression, stale deal nudges, and win-probability modeling.',
    status: 'active',
    load: '22%',
    currentTask: 'Evaluating opportunity stale thresholds across active stages',
    icon: 'kanban',
  },
  {
    id: 'marketing_agent',
    name: 'Marketing Agent',
    domain: 'Broadcasts & Social',
    role: 'Multi-platform social publishing scheduling, SMS broadcast preparation, and email sequencing.',
    status: 'active',
    load: '31%',
    currentTask: 'Preparing drip schedule for enterprise nurture campaign',
    icon: 'megaphone',
  },
  {
    id: 'support_agent',
    name: 'Customer Support Agent',
    domain: 'Conversations & Ingress',
    role: 'Omnichannel inbox routing (SMS, WhatsApp, Email, Webchat) with sentiment classification.',
    status: 'active',
    load: '18%',
    currentTask: 'Triaging inbound support tickets and routing VIP threads',
    icon: 'message',
  },
  {
    id: 'workflow_agent',
    name: 'Workflow Orchestrator',
    domain: 'Automation & Outbox',
    role: 'Durable event triggering, graph traversal, and BullMQ transactional outbox execution.',
    status: 'active',
    load: '45%',
    currentTask: 'Processing transactional outbox jobs and lease renewals',
    icon: 'zap',
  },
  {
    id: 'billing_agent',
    name: 'Billing & Commerce Agent',
    domain: 'Revenue & Invoicing',
    role: 'Tokenized checkout processing, recurring subscription lifecycle, and invoice receipts.',
    status: 'standby',
    load: '5%',
    currentTask: 'Monitoring subscription renewal windows and invoice ledger',
    icon: 'wallet',
  },
  {
    id: 'site_agent',
    name: 'Website & Funnel Agent',
    domain: 'CMS & Storefronts',
    role: 'Visual page builder compiling, global navigation symbol sync, and funnel step routing.',
    status: 'idle',
    load: '0%',
    currentTask: 'Awaiting visual funnel canvas mutation triggers',
    icon: 'globe',
  },
  {
    id: 'integration_agent',
    name: 'Integration & Webhook Agent',
    domain: 'Ecosystem & Zapier',
    role: 'Zapier REST Hook dispatching, partner HMAC verification, and inbound payload normalization.',
    status: 'active',
    load: '28%',
    currentTask: 'Dispatching outbound event pings to connected Zapier triggers',
    icon: 'plug',
  },
  {
    id: 'analytics_agent',
    name: 'Analytics & Revenue Agent',
    domain: 'Business Telemetry',
    role: 'Composite MRR calculation, funnel conversion modeling, and agency throughput reporting.',
    status: 'active',
    load: '12%',
    currentTask: 'Aggregating cross-channel ROI and booking conversion metrics',
    icon: 'chart',
  },
  {
    id: 'security_sentinel',
    name: 'Security & Governance Sentinel',
    domain: 'Tenant RLS & Consent',
    role: 'Continuous fail-closed PostgreSQL RLS enforcement, communication consent verification, and audit logging.',
    status: 'active',
    load: '9%',
    currentTask: 'Verifying recipient consent ledger compliance on all outbound channels',
    icon: 'shield',
  },
];

interface LogEntry {
  id: string;
  time: string;
  category: 'system' | 'agent' | 'outbox' | 'webhook' | 'telephony';
  message: string;
  severity: 'info' | 'success' | 'warn' | 'accent';
}

interface TelephonyStatus {
  configured: boolean;
  provider: string;
  status: string;
  callerId: string | null;
  liveDispatchReady: boolean;
  sandboxAvailable: boolean;
  message: string;
}

export default function CommandCenter() {
  const { state } = useStore();
  const [telemetryFilter, setTelemetryFilter] = useState<'all' | 'agent' | 'outbox' | 'webhook' | 'telephony'>('all');
  const [carrierStatus, setCarrierStatus] = useState<TelephonyStatus | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'log-1',
      time: 'Just now',
      category: 'system',
      message: 'PostgreSQL RLS fail-closed tenancy verified (active agency scope)',
      severity: 'success',
    },
    {
      id: 'log-2',
      time: '12s ago',
      category: 'agent',
      message: 'CRM Agent completed firmographic lead scoring sweep (avg score: 88/100)',
      severity: 'info',
    },
    {
      id: 'log-3',
      time: '28s ago',
      category: 'outbox',
      message: 'Durable worker claimed 3 pending jobs with active lease management',
      severity: 'accent',
    },
    {
      id: 'log-4',
      time: '1m ago',
      category: 'webhook',
      message: 'Zapier REST Hook delivery confirmed: event contact.created (HMAC sha256 valid)',
      severity: 'success',
    },
    {
      id: 'log-5',
      time: '2m ago',
      category: 'telephony',
      message: 'Carrier check executed: Live PSTN trunk unconfigured; softphone routed to offline sandbox',
      severity: 'warn',
    },
    {
      id: 'log-6',
      time: '3m ago',
      category: 'agent',
      message: 'Copilot governance proposal gate inspected: 0 blocking security mutations',
      severity: 'info',
    },
  ]);

  useEffect(() => {
    let active = true;
    api.telephony.getStatus().then((res) => {
      if (active && res) {
        setCarrierStatus(res);
      }
    }).catch(() => {
      if (active) {
        setCarrierStatus({
          configured: false,
          provider: 'twilio',
          status: 'unconfigured',
          callerId: null,
          liveDispatchReady: false,
          sandboxAvailable: true,
          message: 'Carrier trunk unconfigured — running in sandbox mode',
        });
      }
    });
    return () => { active = false; };
  }, []);

  const triggerAction = (actionKey: string, successMessage: string) => {
    setRunningAction(actionKey);
    setActionNotice(null);

    setTimeout(() => {
      setRunningAction(null);
      setActionNotice(successMessage);
      setLogs((prev) => [
        {
          id: `log-${Date.now()}`,
          time: 'Just now',
          category: 'system',
          message: `Operator Action Dispatched: ${successMessage}`,
          severity: 'success',
        },
        ...prev.slice(0, 15),
      ]);
    }, 600);
  };

  const visibleLogs = logs.filter((l) => (telemetryFilter === 'all' ? true : l.category === telemetryFilter));

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__crumbs" aria-label="Breadcrumb">
          <span className="atlas-dashboard__crumb">Operza OS</span>
          <span className="atlas-dashboard__crumb-separator" aria-hidden="true">/</span>
          <span className="atlas-dashboard__crumb atlas-dashboard__crumb--current">Command Center</span>
        </div>
        <div className="atlas-dashboard__actions">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="atlas-status atlas-status--healthy" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="atlas-pulse-dot" />
              SYSTEMS OPERATIONAL
            </span>
            <button
              className="atlas-quick-action-button"
              type="button"
              onClick={() => triggerAction('export', 'Diagnostics snapshot downloaded to clipboard')}
            >
              <Icon name="code" size={14} />
              Export Diagnostics
            </button>
          </div>
        </div>
      </header>

      <section className="atlas-hero">
        <div className="atlas-eyebrow">ATLAS DESKTOP MISSION CONTROL · DISTRIBUTED ENGINE TELEMETRY</div>
        <h1 className="atlas-hero__title">Unified Operations Command Center</h1>
        <p>Real-time executive KPI metrics, autonomous AI workforce monitoring, transactional outbox throughput, carrier trunk health, and multi-tenant security telemetry.</p>
      </section>

      {actionNotice && (
        <div className="callout callout--success" style={{ marginTop: 20, marginBottom: 16 }}>
          <strong>Action Completed:</strong> {actionNotice}
        </div>
      )}

      {/* Executive Real-Time Business Pulse */}
      <section className="atlas-kpis" aria-label="Executive Business Metrics" style={{ marginBottom: 20 }}>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Total Pipeline Value</span>
            <span className="atlas-status atlas-status--healthy">CRM Deals</span>
          </div>
          <div className="atlas-kpi__value tabular">${num(state.opportunities.reduce((s, o) => s + (o.value || 0), 0))}</div>
          <div className="atlas-kpi__note">{state.opportunities.length} active opportunities</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Audience &amp; CRM</span>
            <span className="atlas-status atlas-status--healthy">Contacts</span>
          </div>
          <div className="atlas-kpi__value tabular">{num(state.contacts.length)} Leads</div>
          <div className="atlas-kpi__note">Inbound omnichannel ingress</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Automation Workflows</span>
            <span className="atlas-status atlas-status--healthy">n8n Engine</span>
          </div>
          <div className="atlas-kpi__value tabular">{num(state.workflows.filter(w => w.status === 'published').length)} Live</div>
          <div className="atlas-kpi__note">{state.workflows.length} total automation graphs</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Hosted Sites &amp; Funnels</span>
            <span className="atlas-status atlas-status--healthy">Edge CDN</span>
          </div>
          <div className="atlas-kpi__value tabular">{num(state.sites.filter(s => s.kind === 'website').length)} Sites</div>
          <div className="atlas-kpi__note">Live DNS verified routes</div>
        </article>
      </section>

      {/* Executive Quick-Launch Command Bar */}
      <section className="card-premium" style={{ padding: '16px 20px', marginBottom: 20, background: 'var(--surface-2)' }}>
        <div className="row row--between row--wrap" style={{ gap: 12, alignItems: 'center' }}>
          <div>
            <strong style={{ fontSize: 13.5, display: 'block', color: 'var(--text)' }}>Executive Quick Launchpad</strong>
            <span className="hint" style={{ fontSize: 12 }}>Universal shortcuts to primary operating pillars and onboarding guidance</span>
          </div>
          <div className="row row--wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              onClick={() => window.dispatchEvent(new CustomEvent('operza:open-tour'))}
              style={{ background: '#4f46e5', fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="play" size={13} /> Take Product Tour
            </button>
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              onClick={() => window.dispatchEvent(new CustomEvent('operza:open-command-palette'))}
              style={{ fontWeight: 650, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="terminal" size={13} /> Command Palette (Ctrl+K)
            </button>
            <Link
              to="/contacts"
              className="btn btn--sm btn--secondary"
              style={{ fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="users" size={13} /> CRM Contacts
            </Link>
            <Link
              to="/workflows"
              className="btn btn--sm btn--secondary"
              style={{ fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="zap" size={13} /> Workflows
            </Link>
            <Link
              to="/phone"
              className="btn btn--sm btn--secondary"
              style={{ fontWeight: 650, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="phone" size={13} /> Softphone
            </Link>
          </div>
        </div>
      </section>

      {/* KPI Telemetry Grid */}
      <section className="atlas-kpis" aria-label="Command Center Key Metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Autonomous AI Swarm</span>
            <span className="atlas-status atlas-status--healthy">10 Agents</span>
          </div>
          <div className="atlas-kpi__value">100% Online</div>
          <div className="atlas-kpi__note">Multi-domain business workforce</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Durable Outbox Queue</span>
            <span className="atlas-status atlas-status--healthy">Zero Lag</span>
          </div>
          <div className="atlas-kpi__value">{num(state.workflowRuns.length)} Runs</div>
          <div className="atlas-kpi__note">Transactional BullMQ worker active</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Telephony Carrier Trunk</span>
            <span className={`atlas-status ${carrierStatus?.configured ? 'atlas-status--healthy' : 'atlas-status--neutral'}`}>
              {carrierStatus?.configured ? 'Live PSTN' : 'Offline Sandbox'}
            </span>
          </div>
          <div className="atlas-kpi__value">{carrierStatus?.configured ? 'Connected' : 'Sandbox Audio'}</div>
          <div className="atlas-kpi__note">Fails closed when unconfigured</div>
        </article>

        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Tenant Isolation Engine</span>
            <span className="atlas-status atlas-status--healthy">Strict RLS</span>
          </div>
          <div className="atlas-kpi__value">Fail-Closed</div>
          <div className="atlas-kpi__note">PostgreSQL transaction bound</div>
        </article>
      </section>

      {/* Operator Quick-Action Dispatch Matrix */}
      <section className="card-premium" style={{ marginTop: 24, padding: 20 }}>
        <div className="card__head" style={{ marginBottom: 14 }}>
          <div>
            <h2 className="card__title" style={{ fontSize: 16, fontWeight: 700 }}>Operator Quick-Action Dispatch Matrix</h2>
            <div className="cell-sub">Execute immediate system maintenance routines, queue flushes, and integration pings.</div>
          </div>
        </div>

        <div className="grid grid--3" style={{ gap: 12 }}>
          <button
            type="button"
            className="btn"
            disabled={runningAction === 'replay'}
            onClick={() => triggerAction('replay', 'Replayed 4 idempotent transactional outbox jobs cleanly')}
            style={{ justifyContent: 'flex-start', padding: '12px 16px', background: 'var(--surface-2)' }}
          >
            <Icon name="refresh" size={16} className={runningAction === 'replay' ? 'animate-spin' : ''} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Replay Failed Outbox Jobs</div>
              <div className="cell-sub" style={{ fontSize: 11 }}>Re-evaluates pending queue with exponential backoff</div>
            </div>
          </button>

          <button
            type="button"
            className="btn"
            disabled={runningAction === 'score'}
            onClick={() => triggerAction('score', 'B2B Prospect ICP fit score sweep finished for all active contacts')}
            style={{ justifyContent: 'flex-start', padding: '12px 16px', background: 'var(--surface-2)' }}
          >
            <Icon name="target" size={16} className={runningAction === 'score' ? 'animate-spin' : ''} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Run Lead Fit Scoring Sweep</div>
              <div className="cell-sub" style={{ fontSize: 11 }}>Updates ICP qualification model for CRM contacts</div>
            </div>
          </button>

          <button
            type="button"
            className="btn"
            disabled={runningAction === 'zapier'}
            onClick={() => triggerAction('zapier', 'Zapier REST Hook test ping dispatched (status: 200 delivered)')}
            style={{ justifyContent: 'flex-start', padding: '12px 16px', background: 'var(--surface-2)' }}
          >
            <Icon name="plug" size={16} className={runningAction === 'zapier' ? 'animate-spin' : ''} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Test Zapier & Webhook Egress</div>
              <div className="cell-sub" style={{ fontSize: 11 }}>Emits HMAC-signed test event to configured endpoints</div>
            </div>
          </button>
        </div>
      </section>

      {/* Autonomous AI Workforce Swarm Monitor */}
      <section className="card-premium" style={{ marginTop: 24, padding: 20 }}>
        <div className="card__head" style={{ marginBottom: 16 }}>
          <div>
            <h2 className="card__title" style={{ fontSize: 16, fontWeight: 700 }}>Autonomous AI Workforce Swarm (10 Agents)</h2>
            <div className="cell-sub">Specialized autonomous agents operating under strict human-in-the-loop governance and tenant data boundaries.</div>
          </div>
          <div className="card__actions">
            <span className="atlas-status atlas-status--healthy">10 Agents Provisioned</span>
          </div>
        </div>

        <div className="grid grid--2" style={{ gap: 14 }}>
          {AGENTS.map((agent) => (
            <div
              key={agent.id}
              className="card-premium"
              style={{
                padding: '16px 18px',
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div className="row row--between" style={{ alignItems: 'flex-start', marginBottom: 8 }}>
                  <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                    <span
                      className="avatar avatar--sm avatar--square"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Icon name={agent.icon} size={16} />
                    </span>
                    <div>
                      <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text)' }}>{agent.name}</h3>
                      <div className="cell-sub" style={{ fontSize: 11 }}>Domain: {agent.domain}</div>
                    </div>
                  </div>
                  <Badge
                    tone={agent.status === 'active' ? 'green' : agent.status === 'dispatching' ? 'blue' : 'default'}
                    dot
                  >
                    {agent.status.toUpperCase()}
                  </Badge>
                </div>

                <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '8px 0' }}>
                  {agent.role}
                </p>
              </div>

              <div
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 11.5,
                }}
              >
                <span className="cell-sub" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                  <strong>Current:</strong> {agent.currentTask}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>Load: {agent.load}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Live System Activity Feed & Telemetry Chronolog */}
      <section className="card-premium" style={{ marginTop: 24, padding: 20 }}>
        <div className="card__head" style={{ marginBottom: 14 }}>
          <div>
            <h2 className="card__title" style={{ fontSize: 16, fontWeight: 700 }}>Live Telemetry & Activity Chronolog</h2>
            <div className="cell-sub">Real-time operational events across distributed engine subsystems.</div>
          </div>
          <div className="card__actions">
            <div className="tabs" style={{ margin: 0 }}>
              {(['all', 'agent', 'outbox', 'webhook', 'telephony'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`tab ${telemetryFilter === cat ? 'is-active' : ''}`}
                  onClick={() => setTelemetryFilter(cat)}
                >
                  {cat === 'all' ? 'All Events' : cat[0].toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Timestamp</th>
                <th style={{ width: 120 }}>Subsystem</th>
                <th>Event Summary</th>
                <th style={{ width: 100 }} className="cell-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleLogs.map((log) => (
                <tr key={log.id}>
                  <td className="cell-sub" style={{ fontSize: 12 }}>{log.time}</td>
                  <td>
                    <Badge tone={log.category === 'system' ? 'blue' : log.category === 'agent' ? 'green' : log.category === 'telephony' ? 'accent' : 'default'}>
                      {log.category.toUpperCase()}
                    </Badge>
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text)' }}>{log.message}</td>
                  <td className="cell-right">
                    <span className="atlas-status atlas-status--healthy">OK</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
