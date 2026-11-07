import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Badge } from '../components/ui';
import { api } from '../lib/api';

interface PlanDefinition {
  id: string;
  name: string;
  pricing: null;
  features: string[];
  limits: {
    workflowRunsPerMonth: number;
    copilotRequestsPerMonth: number;
    locations: number;
    seats: number;
    messageAllowance: number;
  };
  capabilities: {
    liveMessaging: boolean;
    paymentProcessing: boolean;
    customDomain: boolean;
    whiteLabel: boolean;
    advancedWorkflows: boolean;
  };
}

interface Entitlements {
  planId: string;
  planName: string;
  limits: {
    workflowRunsPerMonth: number;
    copilotRequestsPerMonth: number;
    locations: number;
    seats: number;
    messageAllowance: number;
  };
  capabilities: {
    liveMessaging: boolean;
    paymentProcessing: boolean;
    customDomain: boolean;
    whiteLabel: boolean;
    advancedWorkflows: boolean;
  };
}

interface UsageSummary {
  period: string; // e.g. "2026-11"
  workflowRuns: number;
  copilotRequests: number;
  messagesSent: number;
}

export default function PlanUsage() {
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPlatformCommercials = async () => {
    setLoading(true);
    try {
      const [plansRes, entRes, usageRes] = await Promise.all([
        api.platform.getPlans(),
        api.platform.getEntitlements(),
        api.platform.getUsage(),
      ]);
      setPlans(plansRes.data || []);
      setEntitlements(entRes);
      setUsage(usageRes);
    } catch (err: any) {
      console.error('Failed to load commercial plan details', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlatformCommercials();
  }, []);

  const wfUsage = usage?.workflowRuns || 0;
  const wfLimit = entitlements?.limits?.workflowRunsPerMonth || 1000;
  const wfPercent = Math.min(100, Math.round((wfUsage / wfLimit) * 100));

  const copilotUsage = usage?.copilotRequests || 0;
  const copilotLimit = entitlements?.limits?.copilotRequestsPerMonth || 500;
  const copilotPercent = Math.min(100, Math.round((copilotUsage / copilotLimit) * 100));

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__crumbs" aria-label="Breadcrumb">
          <span className="atlas-dashboard__crumb">Control Plane</span>
          <span className="atlas-dashboard__crumb-separator" aria-hidden="true">/</span>
          <span className="atlas-dashboard__crumb atlas-dashboard__crumb--current">Plan & Quotas</span>
        </div>
        <div className="atlas-dashboard__actions">
          <button
            onClick={fetchPlatformCommercials}
            className="atlas-quick-action-button"
            type="button"
          >
            <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
            Refresh Quotas
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <h1 className="atlas-hero__title">Plan Entitlements & Resource Usage</h1>
        <p>Inspect active subscription capabilities, monthly quota consumption, and platform limits.</p>
      </section>

      {/* Honest Pricing & Billing Notice */}
      <div className="callout callout--info" style={{ marginTop: 20, marginBottom: 20 }}>
        <strong>Unpriced Beta & Development Entitlements Active:</strong> All commercial plans in this phase have pricing: null. No billing gateway, automated credit card capture, or subscription payments are activated. Live external messaging and payment processing remain explicitly disabled.
      </div>

      <section className="atlas-kpis" aria-label="Quota metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Workflow Executions</span>
            <span className="atlas-status atlas-status--healthy">{wfPercent}%</span>
          </div>
          <div className="atlas-kpi__value">{wfUsage} / {wfLimit}</div>
          <div className="atlas-kpi__note">Monthly engine quota</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Copilot AI Requests</span>
            <span className="atlas-status atlas-status--healthy">{copilotPercent}%</span>
          </div>
          <div className="atlas-kpi__value">{copilotUsage} / {copilotLimit}</div>
          <div className="atlas-kpi__note">Inference consumption</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Location Seats</span>
            <span className="atlas-status atlas-status--healthy">Provisioned</span>
          </div>
          <div className="atlas-kpi__value">{entitlements?.limits?.locations || 10} Locations</div>
          <div className="atlas-kpi__note">Multi-tenant accounts</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Active Tier</span>
            <span className="atlas-status atlas-status--healthy">Active</span>
          </div>
          <div className="atlas-kpi__value">{entitlements?.planName || 'Agency Partner'}</div>
          <div className="atlas-kpi__note">Evaluation entitlement</div>
        </article>
      </section>

      {loading ? (
        <div className="card-premium" style={{ marginTop: 24, padding: 40, textAlign: 'center' }}>
          <div className="text-gray-400">Loading entitlements and usage...</div>
        </div>
      ) : (
        <>
          {/* Active Plan Overview */}
          <div className="card-premium" style={{ marginTop: 24, padding: 24 }}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-4">
              <div>
                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Active Plan</span>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3 mt-1">
                  {entitlements?.planName || 'Beta Agency Partner'}
                  <Badge tone="green">Active</Badge>
                  <Badge tone="default">Unpriced (Internal / Evaluation)</Badge>
                </h2>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400 block">Current Usage Window</span>
                <span className="font-mono text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {usage?.period || new Date().toISOString().slice(0, 7)} (UTC)
                </span>
              </div>
            </div>

            {/* Quota Progress Meters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 p-4 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Icon name="zap" size={16} className="text-indigo-500" />
                    Workflow Executions
                  </span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {wfUsage} / {wfLimit} ({wfPercent}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      wfPercent > 90 ? 'bg-red-500' : wfPercent > 70 ? 'bg-amber-500' : 'bg-indigo-600'
                    }`}
                    style={{ width: `${wfPercent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Resets on the 1st of each month. Simulation runs are free and do not deduct quota.
                </p>
              </div>

              <div className="space-y-2 p-4 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-200 dark:border-gray-800">
                <div className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Icon name="sparkles" size={16} className="text-purple-500" />
                    Copilot & AI Requests
                  </span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">
                    {copilotUsage} / {copilotLimit} ({copilotPercent}%)
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      copilotPercent > 90 ? 'bg-red-500' : copilotPercent > 70 ? 'bg-amber-500' : 'bg-purple-600'
                    }`}
                    style={{ width: `${copilotPercent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400">
                  Grounded tool queries and mutation proposals counted per workspace.
                </p>
              </div>
            </div>

            {/* Feature Capability Status Matrix */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Capability Matrix & Gating
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Visual Workflow Canvas</span>
                  <Badge tone="green">Enabled</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Copilot Proposal Inbox</span>
                  <Badge tone="green">Enabled</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Durable Outbox Queue</span>
                  <Badge tone="green">Enabled</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Sub-Account Isolation</span>
                  <Badge tone="green">Enabled</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Live External Messaging</span>
                  <Badge tone="red">Disabled</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Payment Capture</span>
                  <Badge tone="red">Disabled</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>Custom White-Label</span>
                  <Badge tone="default">Beta Preview</Badge>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
                  <span>API Key Access</span>
                  <Badge tone="green">Enabled</Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Catalog of Platform Tiers */}
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              Platform Tiers Catalog
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {plans.map((p) => {
                const isCurrent = entitlements?.planId === p.id;
                return (
                  <div
                    key={p.id}
                    className={`card p-5 space-y-4 relative flex flex-col justify-between ${
                      isCurrent
                        ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                        : 'border-gray-200 dark:border-gray-800'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold text-gray-900 dark:text-white text-base">
                          {p.name}
                        </h4>
                        {isCurrent && <Badge tone="accent">Current</Badge>}
                      </div>
                      <div className="text-2xl font-extrabold text-gray-900 dark:text-white">
                        $0{' '}
                        <span className="text-xs font-normal text-gray-400">
                          / unpriced preview
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {p.limits?.workflowRunsPerMonth.toLocaleString()} workflow runs/mo • {p.limits?.copilotRequestsPerMonth.toLocaleString()} Copilot requests/mo
                      </p>
                      <ul className="text-xs space-y-1.5 pt-2 text-gray-600 dark:text-gray-300">
                        {p.features?.map((feat, idx) => (
                          <li key={idx} className="flex items-center gap-1.5">
                            <Icon name="check" size={12} className="text-green-500 flex-shrink-0" />
                            {feat}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-4 border-t border-gray-100 dark:border-gray-800">
                      <button
                        disabled
                        className="btn btn--secondary w-full text-xs opacity-60 cursor-not-allowed"
                      >
                        {isCurrent ? 'Current Plan' : 'Self-Serve Checkout Disabled'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
