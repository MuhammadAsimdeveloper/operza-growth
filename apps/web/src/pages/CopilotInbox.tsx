import { useEffect, useState, useMemo } from 'react';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { Badge, EmptyState, StatusBadge } from '../components/ui';
import { api } from '../lib/api';

interface CopilotProposal {
  id: string;
  agencyId: string;
  locationId: string;
  requesterId: string;
  action: string;
  category: 'crm_mutation' | 'workflow_mutation' | 'external_communication';
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected';
  params: Record<string, any>;
  diff?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
  reviewDecision?: {
    decision: 'approved' | 'rejected';
    decidedBy: string;
    decidedAt: string;
    reason?: string;
  };
  executionStatus: 'not_executed' | 'executed' | 'failed';
  createdAt: string;
}

export default function CopilotInbox() {
  const [proposals, setProposals] = useState<CopilotProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedProposal, setSelectedProposal] = useState<CopilotProposal | null>(null);
  
  // Action states
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [decisionFeedback, setDecisionFeedback] = useState<{ id: string; type: 'success' | 'info'; title: string; message: string } | null>(null);

  // Reject reason modal state
  const [rejectModalProposal, setRejectModalProposal] = useState<CopilotProposal | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchProposals = async () => {
    setLoading(true);
    try {
      const res = await api.copilot.getProposals();
      setProposals(res.data || []);
    } catch (err: any) {
      console.error('Failed to load proposals', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, []);

  const filteredProposals = useMemo(() => {
    return proposals.filter((p) => {
      if (statusTab !== 'all' && p.status !== statusTab) return false;
      if (riskFilter !== 'all' && p.riskLevel !== riskFilter) return false;
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
      return true;
    });
  }, [proposals, statusTab, riskFilter, categoryFilter]);

  const handleApprove = async (proposal: CopilotProposal) => {
    setActionInProgress(proposal.id);
    setDecisionFeedback(null);
    try {
      const res = await api.copilot.approveProposal(proposal.id);
      setDecisionFeedback({
        id: proposal.id,
        type: 'info',
        title: 'Decision Recorded: Approved (Execution Gated)',
        message: `Proposal ${proposal.id.slice(0, 8)} marked approved. Execution status is '${res.execution?.status || 'not_executed'}'. Operza governance prevents unverified side-effect mutations until a dedicated transactional executor runs.`,
      });
      await fetchProposals();
      if (selectedProposal?.id === proposal.id) {
        setSelectedProposal(res.proposal);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to approve proposal');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectModalProposal) return;

    setActionInProgress(rejectModalProposal.id);
    setDecisionFeedback(null);
    try {
      const res = await api.copilot.rejectProposal(rejectModalProposal.id);
      setDecisionFeedback({
        id: rejectModalProposal.id,
        type: 'success',
        title: 'Decision Recorded: Rejected',
        message: `Proposal ${rejectModalProposal.id.slice(0, 8)} rejected. No CRM mutations or side effects will occur.`,
      });
      setRejectModalProposal(null);
      setRejectReason('');
      await fetchProposals();
      if (selectedProposal?.id === rejectModalProposal.id) {
        setSelectedProposal(res.proposal);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to reject proposal');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleExecute = async (proposal: CopilotProposal) => {
    setActionInProgress(proposal.id);
    setDecisionFeedback(null);
    try {
      const res = await api.copilot.executeProposal(proposal.id);
      setDecisionFeedback({
        id: proposal.id,
        type: 'success',
        title: 'Proposal Executed',
        message: `Proposal ${proposal.id.slice(0, 8)} executed successfully. Action receipt: ${res.receipt?.id || 'generated'}.`,
      });
      await fetchProposals();
      if (selectedProposal?.id === proposal.id) {
        setSelectedProposal(res.proposal);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to execute proposal');
    } finally {
      setActionInProgress(null);
    }
  };

  const pendingCount = proposals.filter((p) => p.status === 'pending').length;
  const approvedCount = proposals.filter((p) => p.status === 'approved').length;
  const rejectedCount = proposals.filter((p) => p.status === 'rejected').length;

  return (
    <main className="operza-dashboard atlas-dashboard">
      <header className="atlas-dashboard__header">
        <div className="atlas-dashboard__crumbs" aria-label="Breadcrumb">
          <span className="atlas-dashboard__crumb">AI Workforce</span>
          <span className="atlas-dashboard__crumb-separator" aria-hidden="true">/</span>
          <span className="atlas-dashboard__crumb atlas-dashboard__crumb--current">Proposal Review Inbox</span>
        </div>
        <div className="atlas-dashboard__actions">
          <button
            onClick={fetchProposals}
            className="atlas-quick-action-button"
            type="button"
          >
            <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''} />
            Refresh Inbox
          </button>
        </div>
      </header>

      <section className="atlas-hero">
        <h1 className="atlas-hero__title">Copilot Proposal Review Inbox</h1>
        <p>Inspect, review, and govern autonomous Copilot proposals, workflow changes, and communication drafts.</p>
      </section>

      {/* Governance Banner */}
      <div className="callout callout--info" style={{ marginTop: 20, marginBottom: 20 }}>
        <strong>Three-Stage Human-in-the-Loop Governance:</strong> Operza enforces proposal drafting, explicit human review/decision, and governed action receipt execution before any mutation occurs.
      </div>

      {decisionFeedback && (
        <div className="callout callout--success" style={{ marginBottom: 20 }}>
          <strong>{decisionFeedback.title}:</strong> {decisionFeedback.message}
        </div>
      )}

      {/* Metrics */}
      <section className="atlas-kpis" aria-label="Proposal metrics">
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Pending Review</span>
            <span className={`atlas-status ${pendingCount > 0 ? 'atlas-status--warning' : 'atlas-status--healthy'}`}>
              {pendingCount > 0 ? 'Action Needed' : 'Clear'}
            </span>
          </div>
          <div className="atlas-kpi__value">{String(pendingCount)}</div>
          <div className="atlas-kpi__note">Awaiting human approval</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Decisions: Approved</span>
            <span className="atlas-status atlas-status--healthy">Validated</span>
          </div>
          <div className="atlas-kpi__value">{String(approvedCount)}</div>
          <div className="atlas-kpi__note">Passed human safety gate</div>
        </article>
        <article className="operza-kpi atlas-kpi">
          <div className="atlas-kpi__meta">
            <span className="atlas-kpi__label">Decisions: Rejected</span>
            <span className="atlas-status atlas-status--neutral">Declined</span>
          </div>
          <div className="atlas-kpi__value">{String(rejectedCount)}</div>
          <div className="atlas-kpi__note">Halted by operator</div>
        </article>
      </section>

      {/* Inbox Controls & Filter Tabs */}
      <div className="card-premium" style={{ marginTop: 24, padding: 20 }}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setStatusTab(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  statusTab === tab
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'pending' && pendingCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-red-500 text-white">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="input text-xs"
            >
              <option value="all">All Risk Levels</option>
              <option value="low">Low Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="high">High Risk</option>
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="input text-xs"
            >
              <option value="all">All Categories</option>
              <option value="crm_mutation">CRM Mutation</option>
              <option value="workflow_mutation">Workflow Mutation</option>
              <option value="external_communication">External Communication</option>
            </select>
          </div>
        </div>

        {/* Proposals List */}
        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading Copilot proposals...</div>
        ) : filteredProposals.length === 0 ? (
          <EmptyState
            icon={<Icon name="sparkles" size={32} />}
            title={`No ${statusTab === 'all' ? '' : statusTab} proposals found`}
            text="When Copilot detects natural-language write intents or proposes changes, they will appear here for human governance."
          />
        ) : (
          <div className="space-y-3">
            {filteredProposals.map((item) => (
              <div
                key={item.id}
                className={`border rounded-xl p-4 transition-all ${
                  selectedProposal?.id === item.id
                    ? 'border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/20'
                    : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900 dark:text-gray-100 font-mono">
                        {item.action}
                      </span>
                      <Badge
                        tone={
                          item.riskLevel === 'high'
                            ? 'red'
                            : item.riskLevel === 'medium'
                            ? 'amber'
                            : 'default'
                        }
                      >
                        {item.riskLevel.toUpperCase()} RISK
                      </Badge>
                      <Badge tone="default">
                        {item.category.replace('_', ' ')}
                      </Badge>
                      <StatusBadge
                        status={
                          item.status === 'approved'
                            ? 'confirmed'
                            : item.status === 'rejected'
                            ? 'cancelled'
                            : 'pending'
                        }
                      />
                    </div>
                    <p className="text-xs text-gray-500">
                      ID: <span className="font-mono">{item.id}</span> • Requester: {item.requesterId} • Created: {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedProposal(selectedProposal?.id === item.id ? null : item)}
                      className="btn btn--sm text-xs"
                    >
                      {selectedProposal?.id === item.id ? 'Hide Details' : 'Inspect Diff'}
                    </button>

                    {item.status === 'pending' && (
                      <>
                        <button
                          onClick={() => setRejectModalProposal(item)}
                          disabled={actionInProgress === item.id}
                          className="btn btn--danger btn--sm text-xs flex items-center gap-1"
                        >
                          <Icon name="x" size={12} />
                          Reject
                        </button>
                        <button
                          onClick={() => handleApprove(item)}
                          disabled={actionInProgress === item.id}
                          className="btn btn--primary btn--sm text-xs flex items-center gap-1"
                        >
                          {actionInProgress === item.id ? (
                            <Icon name="refresh" size={12} className="animate-spin" />
                          ) : (
                            <Icon name="check" size={12} />
                          )}
                          Approve
                        </button>
                      </>
                    )}

                    {item.status === 'approved' && item.executionStatus !== 'executed' && (
                      <button
                        onClick={() => handleExecute(item)}
                        disabled={actionInProgress === item.id}
                        className="btn btn--secondary btn--sm text-xs flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        {actionInProgress === item.id ? (
                          <Icon name="refresh" size={12} className="animate-spin" />
                        ) : (
                          <Icon name="play" size={12} />
                        )}
                        Execute Mutation
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Details & Diff */}
                {selectedProposal?.id === item.id && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-800 space-y-3">
                    <div className="bg-gray-50 dark:bg-gray-900/60 p-3 rounded-lg border border-gray-200 dark:border-gray-800">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Proposed Parameters & Payload:
                      </div>
                      <pre className="text-xs font-mono overflow-x-auto text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-950 p-3 rounded border border-gray-200 dark:border-gray-800">
                        {JSON.stringify(item.params, null, 2)}
                      </pre>
                    </div>

                    {item.reviewDecision && (
                      <div className="p-3 bg-gray-100 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 text-xs space-y-1">
                        <div className="font-semibold text-gray-700 dark:text-gray-300">
                          Review Decision Record:
                        </div>
                        <div>
                          Decision: <span className="font-semibold capitalize">{item.reviewDecision.decision}</span> by {item.reviewDecision.decidedBy} at {new Date(item.reviewDecision.decidedAt).toLocaleString()}
                        </div>
                        {item.reviewDecision.reason && (
                          <div>Reason: "{item.reviewDecision.reason}"</div>
                        )}
                        <div className="text-amber-600 dark:text-amber-400 font-mono mt-1">
                          execution.status: {item.executionStatus || 'not_executed'} (mutation safely held)
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rejection Modal */}
      {rejectModalProposal && (
        <Modal
          title="Reject Copilot Proposal"
          onClose={() => setRejectModalProposal(null)}
        >
          <form onSubmit={handleReject} className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Rejecting action <span className="font-mono font-semibold">{rejectModalProposal.action}</span> (Proposal {rejectModalProposal.id.slice(0, 8)}).
            </p>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Rejection Reason (Optional)
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this proposal is declined (e.g. invalid audience, unapproved deal stage)..."
                rows={3}
                className="input w-full text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => setRejectModalProposal(null)}
                className="btn btn--sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionInProgress === rejectModalProposal.id}
                className="btn btn--danger btn--sm flex items-center gap-1.5"
              >
                {actionInProgress === rejectModalProposal.id && (
                  <Icon name="refresh" size={14} className="animate-spin" />
                )}
                Confirm Rejection
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
