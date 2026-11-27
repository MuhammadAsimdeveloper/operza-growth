import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { num, pct, relative } from '../lib/format';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { Badge, EmptyState } from './ui';
import type { Workflow } from '../lib/types';

interface WorkflowOperationsPanelProps {
  workflows: Workflow[];
  selectedWorkflowId?: string | null;
  fallbackRuns: any[];
  onRefreshParentRuns?: () => void;
}

const STATUS_TONE: Record<string, 'green' | 'red' | 'amber' | 'violet' | 'default'> = {
  completed: 'green',
  success: 'green',
  failed: 'red',
  dead_letter: 'red',
  canceled: 'default',
  retry_scheduled: 'amber',
  waiting: 'amber',
  waiting_approval: 'amber',
  waiting_webhook: 'amber',
  running: 'violet',
  resuming: 'violet',
  enqueued: 'default',
  pending: 'default',
};

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function WorkflowOperationsPanel({
  workflows,
  selectedWorkflowId,
  fallbackRuns,
  onRefreshParentRuns,
}: WorkflowOperationsPanelProps) {
  const [subTab, setSubTab] = useState<'overview' | 'executions' | 'dead_letter'>('executions');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [workflowFilter, setWorkflowFilter] = useState<string>('all');
  const [failureCategoryFilter, setFailureCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pageOffset, setPageOffset] = useState<number>(0);
  const pageLimit = 15;

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [runsData, setRunsData] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });
  const [dlqData, setDlqData] = useState<{ items: any[]; total: number }>({ items: [], total: 0 });

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailModal, setDetailModal] = useState<any | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ tone: 'green' | 'red' | 'amber'; text: string } | null>(null);
  const [confirmSideEffects, setConfirmSideEffects] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const loadOperationsData = async () => {
    setLoading(true);
    setErrorMsg(null);
    const wfParam = workflowFilter !== 'all' ? workflowFilter : undefined;
    const catParam = failureCategoryFilter !== 'all' ? failureCategoryFilter : undefined;
    try {
      const [mRes, rRes, dRes] = await Promise.all([
        api.workflows.getOpsMetrics({
          workflowId: wfParam,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          failureCategory: catParam,
        }),
        api.workflows.listOpsRuns({
          workflowId: wfParam,
          status: statusFilter !== 'all' ? statusFilter : undefined,
          failureCategory: catParam,
          search: searchQuery.trim() || undefined,
          limit: pageLimit,
          offset: pageOffset,
        }),
        api.workflows.listDeadLetters({
          workflowId: wfParam,
          failureCategory: catParam,
          search: searchQuery.trim() || undefined,
          limit: pageLimit,
          offset: 0,
        }),
      ]);
      setMetrics(mRes);
      setRunsData({ items: rRes.items || [], total: rRes.total ?? (rRes.items || []).length });
      setDlqData({ items: dRes.items || [], total: dRes.total ?? (dRes.items || []).length });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not load workflow operations data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOperationsData();
  }, [statusFilter, workflowFilter, failureCategoryFilter, pageOffset]);

  const openExecutionDetail = async (runId: string) => {
    setDetailLoading(true);
    setActionFeedback(null);
    setConfirmSideEffects(false);
    try {
      const detail = await api.workflows.getOpsRunDetail(runId);
      setDetailModal(detail);
    } catch (err: any) {
      const localRun = fallbackRuns.find(r => r.id === runId);
      if (localRun) {
        setDetailModal({
          execution: localRun,
          steps: localRun.steps || [],
          attempts: [],
          logs: [],
          receipts: [],
          retryEligibility: { eligible: false, reason: 'Offline/local simulation run cannot be retried via server.' },
          cancellationContract: { supported: false, mode: 'unsupported', reason: 'Local run' },
        });
      } else {
        setActionFeedback({ tone: 'red', text: err?.message || 'Failed to load execution detail' });
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRetryOrRequeue = async (mode: 'retry' | 'requeue') => {
    if (!detailModal?.execution?.id) return;
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const fn = mode === 'requeue' ? api.workflows.requeueDeadLetter : api.workflows.retryRun;
      const res = await fn(detailModal.execution.id, {
        reason: mode === 'requeue' ? 'Operator dead-letter requeue' : 'Operator retry',
        confirmSideEffectRetry: confirmSideEffects,
      });
      setActionFeedback({
        tone: 'green',
        text: `${mode === 'requeue' ? 'Dead-letter requeued' : 'Retry queued'} (Attempt #${res.execution?.attemptCount || '?'}) against pinned workflow v${res.execution?.workflowVersion || 1}.`,
      });
      await openExecutionDetail(detailModal.execution.id);
      await loadOperationsData();
      onRefreshParentRuns?.();
    } catch (err: any) {
      setActionFeedback({ tone: 'amber', text: err?.message || 'Retry was blocked by safety policy.' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancelExecution = async () => {
    if (!detailModal?.execution?.id) return;
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await api.workflows.cancelRun(detailModal.execution.id, { reason: 'Operator requested cancellation' });
      setActionFeedback({
        tone: res.mode === 'immediate' ? 'green' : 'amber',
        text:
          res.mode === 'immediate'
            ? 'Execution canceled before further steps ran.'
            : 'Cooperative cancellation requested. Waiting for active worker acknowledgement; any started external call may still finish.',
      });
      await openExecutionDetail(detailModal.execution.id);
      await loadOperationsData();
      onRefreshParentRuns?.();
    } catch (err: any) {
      setActionFeedback({ tone: 'red', text: err?.message || 'Cancellation failed.' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleRecoverStuck = async () => {
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const res = await api.workflows.recoverStuck();
      setActionFeedback({
        tone: 'green',
        text: `Scanned ${res.scanned ?? 0} active runs: ${res.stuckDetected ?? 0} stuck detected, ${res.recoveredCount ?? 0} scheduled for retry, ${res.deadLetteredCount ?? 0} dead-lettered.`,
      });
      await loadOperationsData();
    } catch (err: any) {
      setActionFeedback({ tone: 'red', text: err?.message || 'Stuck-execution scan failed.' });
    } finally {
      setActionBusy(false);
    }
  };

  const displayItems = runsData.items.length > 0 ? runsData.items : (pageOffset === 0 && statusFilter === 'all' && workflowFilter === 'all' ? fallbackRuns : []);

  return (
    <section className="card" style={{ marginTop: 16 }} aria-label="Workflow Execution Operations">
      <div className="card__head" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="card__title">Workflow Execution Operations</div>
          <div className="card__sub">
            Durable execution observability, node timelines, safe retries, dead-letter recovery, and queue health.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div role="tablist" aria-label="Operations views" style={{ display: 'inline-flex', background: 'var(--surface)', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'overview'}
              className={`btn btn--xs ${subTab === 'overview' ? 'btn--primary' : 'btn--subtle'}`}
              style={{ border: 'none' }}
              onClick={() => setSubTab('overview')}
            >
              Dashboard
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'executions'}
              className={`btn btn--xs ${subTab === 'executions' ? 'btn--primary' : 'btn--subtle'}`}
              style={{ border: 'none' }}
              onClick={() => setSubTab('executions')}
            >
              Executions ({runsData.total || displayItems.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={subTab === 'dead_letter'}
              className={`btn btn--xs ${subTab === 'dead_letter' ? 'btn--primary' : 'btn--subtle'}`}
              style={{ border: 'none' }}
              onClick={() => setSubTab('dead_letter')}
            >
              Dead-Letter ({dlqData.total})
            </button>
          </div>
          <button
            type="button"
            className="btn btn--sm btn--subtle"
            onClick={handleRecoverStuck}
            disabled={actionBusy}
            title="Scan for expired worker leases, stale heartbeats, or overdue retries"
          >
            <Icon name="refresh" size={13} /> Scan Stuck
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={loadOperationsData}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {actionFeedback && (
        <div style={{ marginBottom: 12 }}>
          <Badge tone={actionFeedback.tone}>{actionFeedback.text}</Badge>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', color: 'var(--red)' }}>
          {errorMsg}
        </div>
      )}

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select
          aria-label="Filter by workflow"
          className="input"
          style={{ minWidth: 160, flex: '1 1 160px' }}
          value={workflowFilter}
          onChange={(e) => {
            setPageOffset(0);
            setWorkflowFilter(e.target.value);
          }}
        >
          <option value="all">All Workflows</option>
          {selectedWorkflowId && !workflows.some(w => w.id === selectedWorkflowId) && (
            <option value={selectedWorkflowId}>Current Workflow</option>
          )}
          {workflows.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        {subTab !== 'dead_letter' && (
          <select
            aria-label="Filter by execution status"
            className="input"
            style={{ minWidth: 150, flex: '1 1 150px' }}
            value={statusFilter}
            onChange={(e) => {
              setPageOffset(0);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="all">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="enqueued">Queued</option>
            <option value="waiting">Waiting</option>
            <option value="waiting_approval">Waiting Approval</option>
            <option value="retry_scheduled">Retry Scheduled</option>
            <option value="failed">Failed</option>
            <option value="canceled">Canceled</option>
            <option value="dead_letter">Dead-Lettered</option>
          </select>
        )}

        <select
          aria-label="Filter by failure category"
          className="input"
          style={{ minWidth: 160, flex: '1 1 160px' }}
          value={failureCategoryFilter}
          onChange={(e) => {
            setPageOffset(0);
            setFailureCategoryFilter(e.target.value);
          }}
        >
          <option value="all">All Failure Categories</option>
          <option value="transient_network">Transient Network</option>
          <option value="rate_limit">Rate Limit</option>
          <option value="provider_outage">Provider Outage</option>
          <option value="lease_expired">Lease Expired</option>
          <option value="timeout">Timeout</option>
          <option value="invalid_config">Invalid Config</option>
          <option value="permission_denied">Permission Denied</option>
          <option value="validation_error">Validation Error</option>
          <option value="approval_rejected">Approval Rejected</option>
        </select>

        <input
          type="search"
          aria-label="Search executions"
          placeholder="Search ID, workflow, or error code..."
          className="input"
          style={{ minWidth: 200, flex: '2 1 220px' }}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setPageOffset(0);
              loadOperationsData();
            }
          }}
        />
      </div>

      {/* TAB 1: OPERATIONAL DASHBOARD */}
      {subTab === 'overview' && (
        <div className="stack" style={{ gap: 16 }}>
          {!metrics || metrics.totalExecutions === 0 ? (
            <EmptyState
              icon={<Icon name="activity" size={20} />}
              title="No operational metrics recorded yet"
              text="Run a workflow or trigger an automation to populate real execution success rates, durations, and failure trends."
            />
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Total Executions</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{num(metrics.totalExecutions)}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Success Rate</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{pct(metrics.completedCount || 0, metrics.totalExecutions || 1)}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Avg Duration</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{formatDuration(metrics.avgDurationMs)}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Active / Queued</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{num((metrics.runningCount || 0) + (metrics.queuedCount || 0))}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Retry Scheduled</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{num(metrics.retryScheduledCount || 0)}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Failed / Dead-Letter</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{num((metrics.failedCount || 0) + (metrics.deadLetterCount || 0))}</div>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="cell-sub">Stuck Detected</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{num(metrics.stuckCount || 0)}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                <div className="card" style={{ padding: 12 }}>
                  <div className="card__title" style={{ fontSize: 13, marginBottom: 8 }}>Failure Categories</div>
                  {(metrics.failureCategories || []).length === 0 ? (
                    <div className="cell-sub">No failures recorded in selected range.</div>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {metrics.failureCategories.map((c: any) => (
                        <div key={c.category} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span>{c.category}</span>
                          <Badge tone="red">{c.count}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="card__title" style={{ fontSize: 13, marginBottom: 8 }}>Most Failing Workflows</div>
                  {(metrics.topFailingWorkflows || []).length === 0 ? (
                    <div className="cell-sub">No failing workflows detected.</div>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {metrics.topFailingWorkflows.map((w: any) => (
                        <div key={w.workflowId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                          <span>{w.workflowName}</span>
                          <span className="cell-sub">{w.failureCount} / {w.totalCount} failed</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card" style={{ padding: 12 }}>
                  <div className="card__title" style={{ fontSize: 13, marginBottom: 8 }}>Daily Execution Trends</div>
                  {(metrics.executionTrends || []).length === 0 ? (
                    <div className="cell-sub">No trend buckets available yet.</div>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {metrics.executionTrends.slice(-7).map((t: any) => (
                        <div key={t.bucket} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span>{t.bucket}</span>
                          <span>{t.completed} ok · {t.failed} err · {t.total} total</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: EXECUTIONS TABLE */}
      {subTab === 'executions' && (
        <>
          {displayItems.length === 0 ? (
            <EmptyState
              icon={<Icon name="play" size={20} />}
              title="No matching workflow executions"
              text="Adjust filters or run a workflow to inspect its durable execution timeline."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Workflow / Version</th>
                    <th>Trigger</th>
                    <th>Attempts</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Failure / Error</th>
                    <th>Started</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((run: any) => (
                    <tr key={run.id} className="is-clickable" onClick={() => openExecutionDetail(run.id)}>
                      <td>
                        <div className="cell-main">{run.workflowName || 'Workflow'}</div>
                        <div className="cell-sub">v{run.workflowVersion || 1} · {String(run.id).slice(0, 8)}</div>
                      </td>
                      <td>{run.triggerType || 'manual'}</td>
                      <td className="cell-num">{run.attemptCount || 1}</td>
                      <td className="cell-num">{formatDuration(run.durationMs)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[run.status] || 'default'} dot>
                          {run.status}
                        </Badge>
                      </td>
                      <td className="cell-sub">
                        {run.failureCategory || run.lastErrorCode || '—'}
                      </td>
                      <td className="cell-sub">{relative(run.createdAt || new Date().toISOString())}</td>
                      <td className="cell-right">
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openExecutionDetail(run.id);
                          }}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {runsData.total > pageLimit && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <span className="cell-sub">
                Showing {pageOffset + 1}–{Math.min(pageOffset + pageLimit, runsData.total)} of {runsData.total}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={pageOffset === 0}
                  onClick={() => setPageOffset(Math.max(0, pageOffset - pageLimit))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={pageOffset + pageLimit >= runsData.total}
                  onClick={() => setPageOffset(pageOffset + pageLimit)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 3: DEAD-LETTER QUEUE */}
      {subTab === 'dead_letter' && (
        <>
          {dlqData.items.length === 0 ? (
            <EmptyState
              icon={<Icon name="shield" size={20} />}
              title="Dead-letter queue is clear"
              text="Exhausted or permanently failed executions appear here for root-cause inspection and safe requeuing."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Failure Category</th>
                    <th>Error Code</th>
                    <th>Attempts</th>
                    <th>Dead-Lettered</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {dlqData.items.map((run: any) => (
                    <tr key={run.id} className="is-clickable" onClick={() => openExecutionDetail(run.id)}>
                      <td>
                        <div className="cell-main">{run.workflowName || 'Workflow'}</div>
                        <div className="cell-sub">v{run.workflowVersion || 1} · {String(run.id).slice(0, 8)}</div>
                      </td>
                      <td><Badge tone="red">{run.failureCategory || 'unknown'}</Badge></td>
                      <td className="cell-sub">{run.lastErrorCode || '—'}</td>
                      <td className="cell-num">{run.attemptCount || 1}</td>
                      <td className="cell-sub">{relative(run.deadLetteredAt || run.finishedAt || run.createdAt)}</td>
                      <td className="cell-right">
                        <button
                          type="button"
                          className="btn btn--sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openExecutionDetail(run.id);
                          }}
                        >
                          Diagnose / Requeue
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* EXECUTION DETAIL & NODE TIMELINE MODAL */}
      {(detailModal || detailLoading) && (
        <Modal
          title={detailModal?.execution ? `Execution ${String(detailModal.execution.id).slice(0, 8)} — ${detailModal.execution.workflowName || 'Workflow'}` : 'Loading Execution...'}
          onClose={() => {
            setDetailModal(null);
            setActionFeedback(null);
          }}
        >
          {detailLoading || !detailModal?.execution ? (
            <div style={{ padding: 20 }}>Loading execution timeline and diagnostics...</div>
          ) : (
            <div className="stack" style={{ gap: 14 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Badge tone={STATUS_TONE[detailModal.execution.status] || 'default'} dot>
                    {detailModal.execution.status}
                  </Badge>
                  <Badge>v{detailModal.execution.workflowVersion || 1}</Badge>
                  <Badge>Attempt {detailModal.execution.attemptCount || 1}</Badge>
                  <Badge>{formatDuration(detailModal.execution.durationMs)}</Badge>
                </div>
                <div className="cell-sub">
                  Correlation: {detailModal.execution.correlationId || '—'}
                </div>
              </div>

              {(detailModal.execution.failureMessage || detailModal.execution.lastErrorCode) && (
                <div style={{ padding: 10, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Failure Diagnostic ({detailModal.execution.failureCategory || 'unknown'}) — {detailModal.execution.lastErrorCode || 'ERROR'}
                  </div>
                  <div className="cell-sub" style={{ marginTop: 4 }}>
                    {detailModal.execution.failureMessage || 'See failed node details below.'}
                  </div>
                </div>
              )}

              {/* Controls: Retry / Requeue / Cancel */}
              <div style={{ padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Execution Controls</div>
                {detailModal.retryEligibility?.requiresConfirmation && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={confirmSideEffects}
                      onChange={(e) => setConfirmSideEffects(e.target.checked)}
                    />
                    <span>
                      {detailModal.retryEligibility.reason} Confirm retrying against pinned workflow v{detailModal.execution.workflowVersion || 1}.
                    </span>
                  </label>
                )}
                {!detailModal.retryEligibility?.eligible && detailModal.retryEligibility?.reason && (
                  <div className="cell-sub" style={{ marginBottom: 8 }}>{detailModal.retryEligibility.reason}</div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {detailModal.retryEligibility?.eligible && detailModal.execution.status === 'dead_letter' && (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={actionBusy || (detailModal.retryEligibility.requiresConfirmation && !confirmSideEffects)}
                      onClick={() => handleRetryOrRequeue('requeue')}
                    >
                      Requeue Dead-Letter
                    </button>
                  )}
                  {detailModal.retryEligibility?.eligible && detailModal.execution.status !== 'dead_letter' && (
                    <button
                      type="button"
                      className="btn btn--sm btn--primary"
                      disabled={actionBusy || (detailModal.retryEligibility.requiresConfirmation && !confirmSideEffects)}
                      onClick={() => handleRetryOrRequeue('retry')}
                    >
                      Retry Execution
                    </button>
                  )}
                  {detailModal.cancellationContract?.supported ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={actionBusy}
                      onClick={handleCancelExecution}
                      title={detailModal.cancellationContract.reason}
                    >
                      {detailModal.cancellationContract.mode === 'immediate' ? 'Cancel Execution' : 'Request Cooperative Cancel'}
                    </button>
                  ) : (
                    <span className="cell-sub" style={{ alignSelf: 'center' }}>
                      {detailModal.cancellationContract?.reason}
                    </span>
                  )}
                </div>
              </div>

              {/* Node Timeline */}
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  Node Timeline ({(detailModal.steps || []).length})
                </div>
                {(detailModal.steps || []).length === 0 ? (
                  <div className="cell-sub">No node steps recorded yet.</div>
                ) : (
                  <div className="stack" style={{ gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                    {detailModal.steps.map((s: any, idx: number) => (
                      <div key={s.id || `${s.nodeId}_${idx}`} style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>
                            #{s.executionOrder || idx + 1} {s.nodeName || s.nodeId} {s.nodeType ? `(${s.nodeType})` : ''}
                          </span>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className="cell-sub">{formatDuration(s.durationMs)}</span>
                            <Badge tone={STATUS_TONE[s.status] || 'default'}>{s.status}</Badge>
                          </div>
                        </div>
                        {(s.errorCode || s.errorMessage) && (
                          <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
                            {s.errorCode}: {s.errorMessage || 'Step failed'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Attempt History */}
              {(detailModal.attempts || []).length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Attempt Lineage</div>
                  <div className="stack" style={{ gap: 4 }}>
                    {detailModal.attempts.map((a: any) => (
                      <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span>Attempt #{a.attemptNumber} ({a.triggeredBy || 'system'})</span>
                        <span>{a.status}{a.errorCode ? ` · ${a.errorCode}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Redacted Logs */}
              {(detailModal.logs || []).length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Structured Logs (Redacted)</div>
                  <div className="stack" style={{ gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                    {detailModal.logs.map((l: any) => (
                      <div key={l.id} style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        [{l.level}] {l.eventType}: {l.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
