/**
 * ============================================================================
 * Operza Workflows 2.0 Router — Registry, Validation, Immutable Versioning,
 * Timezone Schedules, Redacted Debugger & Observability Metrics
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createWorkflows2Repository } from '../../../packages/db/lib/workflows-2-repository.mjs';
import { createWorkflowOperationsRepository } from '../../../packages/db/lib/workflow-operations-repository.mjs';
import {
  classifyWorkflowFailure,
  detectStuckExecutions,
  evaluateCancellationContract,
  evaluateRetryEligibility,
  sanitizeExecutionPayload
} from '../../../packages/workflow-engine/src/operations-2-0.mjs';
import { listNodeDefinitionsV2 } from '../../../packages/workflow-engine/src/node-registry-v2.mjs';
import {
  redactSensitivePayload,
  validateWorkflowGraphV2
} from '../../../packages/workflow-engine/src/graph-validator-v2.mjs';
import {
  computeNextRunAtUtc,
  isValidIanaTimezone
} from '../../../packages/workflow-engine/src/scheduler-v2.mjs';

const workflows2Repo = createWorkflows2Repository();
const workflowOpsRepo = createWorkflowOperationsRepository();

function checkScope(actor, requiredScope) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  return scopes.includes('*') || scopes.includes('all') || scopes.includes(requiredScope);
}

export async function handleWorkflows2Routes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    actor,
    agency,
    activeLocation,
    pgPool,
    readJson,
    sendJson,
    auditLog,
    state,
    saveState
  } = ctx;

  if (!pathname.startsWith('/api/workflows/v2/') && !pathname.startsWith('/api/crm/workflows/v2/')) {
    return false;
  }

  const subPath = pathname
    .replace(/^\/api\/crm\/workflows\/v2/, '')
    .replace(/^\/api\/workflows\/v2/, '');

  const tenantCtx = {
    agencyId: agency?.id,
    locationId: activeLocation?.id,
    userId: actor?.id,
    actorId: actor?.user?.id || actor?.id || 'system'
  };

  // 1. Node Registry V2
  if (method === 'GET' && subPath === '/registry') {
    const category = url.searchParams.get('category') || 'all';
    const search = url.searchParams.get('search') || '';
    const nodes = listNodeDefinitionsV2({ category, search });
    sendJson(res, 200, { count: nodes.length, nodes });
    return true;
  }

  // 2. Graph Validation
  if (method === 'POST' && subPath === '/validate') {
    const body = await readJson(req);
    const result = validateWorkflowGraphV2({
      nodes: body?.nodes || [],
      edges: body?.edges || [],
      trigger: body?.trigger || null,
      governancePolicy: body?.governancePolicy || {}
    });
    sendJson(res, 200, result);
    return true;
  }

  // 3. Schedule Next-Run Preview
  if (method === 'POST' && subPath === '/schedules/preview') {
    const body = await readJson(req);
    const timezone = body?.timezone || 'UTC';
    if (!isValidIanaTimezone(timezone)) {
      sendJson(res, 400, { error: `Invalid IANA timezone: ${timezone}`, code: 'INVALID_TIMEZONE' });
      return true;
    }
    try {
      const nextRunAtUtc = computeNextRunAtUtc({
        scheduleType: body?.scheduleType || 'interval',
        timezone,
        intervalEvery: body?.intervalEvery ?? 1,
        intervalUnit: body?.intervalUnit || 'hours',
        cronExpression: body?.cronExpression || null,
        runAt: body?.runAt || null
      });
      sendJson(res, 200, { timezone, nextRunAtUtc });
    } catch (err) {
      sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_SCHEDULE' });
    }
    return true;
  }

  // 4. Workflow Observability & Operations Metrics
  if (method === 'GET' && subPath === '/metrics') {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const filters = {
      workflowId: url.searchParams.get('workflowId') || undefined,
      status: url.searchParams.get('status') || undefined,
      triggerType: url.searchParams.get('triggerType') || undefined,
      failureCategory: url.searchParams.get('failureCategory') || undefined,
      dateFrom: url.searchParams.get('dateFrom') || undefined,
      dateTo: url.searchParams.get('dateTo') || undefined
    };
    if (pgPool) {
      const metrics = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.getOperationalMetrics(tx, filters)
      );
      sendJson(res, 200, metrics);
      return true;
    }
    const allRuns = [
      ...(state?.workflowExecutions || []),
      ...(state?.records?.workflowRuns || [])
    ].filter(r => (!r.agencyId || r.agencyId === agency?.id) && (!r.locationId || r.locationId === activeLocation?.id));
    const filtered = allRuns.filter(r => {
      if (filters.workflowId && r.workflowId !== filters.workflowId) return false;
      if (filters.status && filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.triggerType && filters.triggerType !== 'all' && (r.triggerType || 'manual') !== filters.triggerType) return false;
      if (filters.failureCategory && filters.failureCategory !== 'all' && r.failureCategory !== filters.failureCategory) return false;
      if (filters.dateFrom && new Date(r.createdAt) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(r.createdAt) > new Date(filters.dateTo)) return false;
      return true;
    });
    const completedCount = filtered.filter(r => r.status === 'completed' || r.status === 'success').length;
    const failedCount = filtered.filter(r => r.status === 'failed').length;
    const deadLetterCount = filtered.filter(r => r.status === 'dead_letter').length;
    const runningCount = filtered.filter(r => ['running', 'resuming'].includes(r.status)).length;
    const queuedCount = filtered.filter(r => ['pending', 'enqueued'].includes(r.status)).length;
    const retryScheduledCount = filtered.filter(r => r.status === 'retry_scheduled').length;
    const canceledCount = filtered.filter(r => r.status === 'canceled').length;
    const waitingCount = filtered.filter(r => ['waiting', 'waiting_approval', 'waiting_webhook'].includes(r.status)).length;
    const catMap = new Map();
    const wfFailMap = new Map();
    const trendMap = new Map();
    for (const r of filtered) {
      const day = String(r.createdAt || new Date().toISOString()).slice(0, 10);
      const t = trendMap.get(day) || { bucket: day, total: 0, completed: 0, failed: 0 };
      t.total += 1;
      if (r.status === 'completed' || r.status === 'success') t.completed += 1;
      if (r.status === 'failed' || r.status === 'dead_letter') {
        t.failed += 1;
        const cat = r.failureCategory || classifyWorkflowFailure({ errorCode: r.lastErrorCode }).category;
        catMap.set(cat, (catMap.get(cat) || 0) + 1);
        const wfEntry = wfFailMap.get(r.workflowId) || { workflowId: r.workflowId, workflowName: r.workflowName || 'Workflow', failureCount: 0, totalCount: 0 };
        wfEntry.failureCount += 1;
        wfFailMap.set(r.workflowId, wfEntry);
      }
      if (wfFailMap.has(r.workflowId)) wfFailMap.get(r.workflowId).totalCount += 1;
      trendMap.set(day, t);
    }
    const stuck = detectStuckExecutions({ executions: filtered });
    sendJson(res, 200, {
      totalExecutions: filtered.length,
      completedCount,
      failedCount,
      runningCount,
      queuedCount,
      retryScheduledCount,
      deadLetterCount,
      canceledCount,
      activeCount: runningCount + queuedCount,
      waitingCount,
      totalAttempts: filtered.reduce((acc, r) => acc + (r.attemptCount || 1), 0),
      avgDurationMs: filtered.length ? Math.round(filtered.reduce((a, r) => a + (r.durationMs || 0), 0) / filtered.length) : 0,
      successRate: filtered.length ? Number((completedCount / filtered.length).toFixed(4)) : 1,
      pendingApprovals: (state?.workflowApprovals || state?.records?.workflowApprovals || []).filter(a => a.status === 'pending').length,
      stuckCount: stuck.stuckCount,
      failureCategories: Array.from(catMap.entries()).map(([category, count]) => ({ category, count })),
      topFailingWorkflows: Array.from(wfFailMap.values()).sort((a, b) => b.failureCount - a.failureCount).slice(0, 5),
      executionTrends: Array.from(trendMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)).slice(-14),
      recentFailures: filtered.filter(r => r.status === 'failed' || r.status === 'dead_letter').slice(0, 8)
    });
    return true;
  }

  // 4b. Paginated Operational Executions List
  if (method === 'GET' && subPath === '/runs') {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const filters = {
      workflowId: url.searchParams.get('workflowId') || undefined,
      status: url.searchParams.get('status') || undefined,
      triggerType: url.searchParams.get('triggerType') || undefined,
      failureCategory: url.searchParams.get('failureCategory') || undefined,
      dateFrom: url.searchParams.get('dateFrom') || undefined,
      dateTo: url.searchParams.get('dateTo') || undefined,
      search: url.searchParams.get('search') || undefined,
      limit: Number(url.searchParams.get('limit')) || 25,
      offset: Number(url.searchParams.get('offset')) || 0
    };
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx => workflowOpsRepo.listOperationalRuns(tx, filters));
      sendJson(res, 200, result);
      return true;
    }
    const allRuns = [
      ...(state?.workflowExecutions || []),
      ...(state?.records?.workflowRuns || [])
    ].filter(r => (!r.agencyId || r.agencyId === agency?.id) && (!r.locationId || r.locationId === activeLocation?.id));
    const filtered = allRuns.filter(r => {
      if (filters.workflowId && r.workflowId !== filters.workflowId) return false;
      if (filters.status && filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.triggerType && filters.triggerType !== 'all' && (r.triggerType || 'manual') !== filters.triggerType) return false;
      if (filters.failureCategory && filters.failureCategory !== 'all' && r.failureCategory !== filters.failureCategory) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!String(r.id).toLowerCase().includes(q) && !String(r.workflowName || '').toLowerCase().includes(q) && !String(r.lastErrorCode || '').toLowerCase().includes(q)) return false;
      }
      return true;
    }).slice().reverse();
    const limit = Math.min(100, Math.max(1, filters.limit));
    const offset = Math.max(0, filters.offset);
    sendJson(res, 200, {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset
    });
    return true;
  }

  // 4c. Execution Detail (Timeline + Attempts + Logs + Retry Eligibility + Cancellation Contract)
  const runDetailMatch = subPath.match(/^\/runs\/([^/]+)$/);
  if (method === 'GET' && runDetailMatch) {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const runId = runDetailMatch[1];
    if (pgPool) {
      const detail = await runInTenantTx(pgPool, tenantCtx, tx => workflowOpsRepo.getOperationalRunDetail(tx, runId));
      if (!detail) {
        sendJson(res, 404, { error: 'Execution not found', code: 'EXECUTION_NOT_FOUND' });
        return true;
      }
      sendJson(res, 200, detail);
      return true;
    }
    const allRuns = [...(state?.workflowExecutions || []), ...(state?.records?.workflowRuns || [])];
    const run = allRuns.find(r => r.id === runId && (!r.agencyId || r.agencyId === agency?.id));
    if (!run) {
      sendJson(res, 404, { error: 'Execution not found', code: 'EXECUTION_NOT_FOUND' });
      return true;
    }
    const steps = (run.steps || []).map((s, idx) => ({
      id: s.id || `${run.id}_step_${idx}`,
      executionId: run.id,
      nodeId: s.nodeId,
      nodeType: s.nodeType || s.kind || null,
      nodeName: s.nodeName || s.nodeId,
      executionOrder: s.executionOrder || idx + 1,
      attempt: s.attempt || 1,
      status: s.status,
      durationMs: s.durationMs || 0,
      inputSummary: sanitizeExecutionPayload(s.inputSummary || {}),
      outputSummary: sanitizeExecutionPayload(s.outputSummary || s.result || {}),
      errorCode: s.errorCode || null,
      errorMessage: s.errorMessage || null,
      precedingNodeIds: s.precedingNodeIds || [],
      startedAt: s.startedAt || s.executedAt || run.createdAt,
      finishedAt: s.finishedAt || s.executedAt || null
    }));
    const retryEligibility = evaluateRetryEligibility({ execution: run, steps, receipts: [], confirmSideEffectRetry: false });
    const cancellationContract = evaluateCancellationContract(run);
    sendJson(res, 200, {
      execution: {
        ...run,
        triggerEvent: sanitizeExecutionPayload(run.triggerEvent || run.triggerContext || {}),
        nodeCounts: {
          total: steps.length,
          completed: steps.filter(s => s.status === 'completed' || s.status === 'done').length,
          failed: steps.filter(s => s.status === 'failed').length
        }
      },
      steps,
      attempts: run.attemptsHistory || [{
        id: `${run.id}_att_1`,
        executionId: run.id,
        attemptNumber: run.attemptCount || 1,
        status: run.status,
        failureCategory: run.failureCategory || null,
        errorCode: run.lastErrorCode || null,
        startedAt: run.createdAt,
        finishedAt: run.finishedAt || null,
        durationMs: run.durationMs || 0
      }],
      logs: run.logs || [],
      receipts: [],
      retryEligibility,
      cancellationContract
    });
    return true;
  }

  // 4d. Retry Execution
  const retryMatch = subPath.match(/^\/runs\/([^/]+)\/retry$/);
  if (method === 'POST' && retryMatch) {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const runId = retryMatch[1];
    const body = await readJson(req);
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.retryOrRequeueExecution(tx, {
          executionId: runId,
          actorId: actor?.user?.id || actor?.id || 'system',
          reason: body?.reason || 'Operator retry',
          confirmSideEffectRetry: body?.confirmSideEffectRetry === true,
          targetMode: 'retry'
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: result.error, code: result.code });
        return true;
      }
      if (result.confirmationRequired || result.conflict) {
        sendJson(res, 409, result);
        return true;
      }
      auditLog?.('workflow.execution.retried', actor, { executionId: runId, attempt: result.execution.attemptCount });
      sendJson(res, 200, result);
      return true;
    }
    const allRuns = [...(state?.workflowExecutions || []), ...(state?.records?.workflowRuns || [])];
    const run = allRuns.find(r => r.id === runId && (!r.agencyId || r.agencyId === agency?.id));
    if (!run) {
      sendJson(res, 404, { error: 'Execution not found', code: 'EXECUTION_NOT_FOUND' });
      return true;
    }
    const eligibility = evaluateRetryEligibility({
      execution: run,
      steps: run.steps || [],
      receipts: [],
      confirmSideEffectRetry: body?.confirmSideEffectRetry === true
    });
    if (!eligibility.eligible) {
      sendJson(res, 409, { conflict: true, code: eligibility.code, error: eligibility.reason, eligibility });
      return true;
    }
    if (eligibility.requiresConfirmation && body?.confirmSideEffectRetry !== true) {
      sendJson(res, 409, { confirmationRequired: true, code: eligibility.code, error: eligibility.reason, eligibility });
      return true;
    }
    run.status = 'enqueued';
    run.attemptCount = (run.attemptCount || 1) + 1;
    run.finishedAt = null;
    await saveState?.();
    auditLog?.('workflow.execution.retried', actor, { executionId: runId, attempt: run.attemptCount });
    sendJson(res, 200, { success: true, execution: run, eligibility });
    return true;
  }

  // 4e. Cancel Execution
  const cancelMatch = subPath.match(/^\/runs\/([^/]+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const runId = cancelMatch[1];
    const body = await readJson(req);
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.cancelExecution(tx, {
          executionId: runId,
          actorId: actor?.user?.id || actor?.id || 'system',
          reason: body?.reason || 'Operator canceled'
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: result.error, code: result.code });
        return true;
      }
      if (result.conflict) {
        sendJson(res, 409, result);
        return true;
      }
      auditLog?.('workflow.execution.cancel_requested', actor, { executionId: runId, mode: result.mode });
      sendJson(res, 200, result);
      return true;
    }
    const allRuns = [...(state?.workflowExecutions || []), ...(state?.records?.workflowRuns || [])];
    const run = allRuns.find(r => r.id === runId && (!r.agencyId || r.agencyId === agency?.id));
    if (!run) {
      sendJson(res, 404, { error: 'Execution not found', code: 'EXECUTION_NOT_FOUND' });
      return true;
    }
    const contract = evaluateCancellationContract(run);
    if (!contract.supported) {
      sendJson(res, 409, { conflict: true, code: 'CANCELLATION_UNSUPPORTED', error: contract.reason, contract });
      return true;
    }
    if (contract.mode === 'immediate') {
      run.status = 'canceled';
      run.canceledAt = new Date().toISOString();
      run.finishedAt = run.canceledAt;
    } else {
      run.cancelRequestedAt = new Date().toISOString();
    }
    await saveState?.();
    auditLog?.('workflow.execution.cancel_requested', actor, { executionId: runId, mode: contract.mode });
    sendJson(res, 200, { success: true, mode: contract.mode, execution: run, contract });
    return true;
  }

  // 4f. Dead-Letter Queue List & Safe Requeue
  if (method === 'GET' && subPath === '/dead-letters') {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const filters = {
      workflowId: url.searchParams.get('workflowId') || undefined,
      failureCategory: url.searchParams.get('failureCategory') || undefined,
      dateFrom: url.searchParams.get('dateFrom') || undefined,
      dateTo: url.searchParams.get('dateTo') || undefined,
      search: url.searchParams.get('search') || undefined,
      limit: Number(url.searchParams.get('limit')) || 25,
      offset: Number(url.searchParams.get('offset')) || 0
    };
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx => workflowOpsRepo.listDeadLetterExecutions(tx, filters));
      sendJson(res, 200, result);
      return true;
    }
    const dlq = [...(state?.workflowExecutions || []), ...(state?.records?.workflowRuns || [])]
      .filter(r => r.status === 'dead_letter' && (!r.agencyId || r.agencyId === agency?.id))
      .reverse();
    sendJson(res, 200, { items: dlq.slice(0, filters.limit), total: dlq.length, limit: filters.limit, offset: filters.offset });
    return true;
  }

  const dlqRequeueMatch = subPath.match(/^\/dead-letters\/([^/]+)\/requeue$/);
  if (method === 'POST' && dlqRequeueMatch) {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const runId = dlqRequeueMatch[1];
    const body = await readJson(req);
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.retryOrRequeueExecution(tx, {
          executionId: runId,
          actorId: actor?.user?.id || actor?.id || 'system',
          reason: body?.reason || 'Dead-letter operator requeue',
          confirmSideEffectRetry: body?.confirmSideEffectRetry === true,
          targetMode: 'requeue'
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: result.error, code: result.code });
        return true;
      }
      if (result.confirmationRequired || result.conflict) {
        sendJson(res, 409, result);
        return true;
      }
      auditLog?.('workflow.dead_letter.requeued', actor, { executionId: runId, requeueCount: result.execution.requeueCount });
      sendJson(res, 200, result);
      return true;
    }
    const allRuns = [...(state?.workflowExecutions || []), ...(state?.records?.workflowRuns || [])];
    const run = allRuns.find(r => r.id === runId && r.status === 'dead_letter');
    if (!run) {
      sendJson(res, 404, { error: 'Dead-letter execution not found', code: 'NOT_DEAD_LETTERED' });
      return true;
    }
    const eligibility = evaluateRetryEligibility({
      execution: run,
      steps: run.steps || [],
      receipts: [],
      confirmSideEffectRetry: body?.confirmSideEffectRetry === true
    });
    if (!eligibility.eligible) {
      sendJson(res, 409, { conflict: true, code: eligibility.code, error: eligibility.reason, eligibility });
      return true;
    }
    if (eligibility.requiresConfirmation && body?.confirmSideEffectRetry !== true) {
      sendJson(res, 409, { confirmationRequired: true, code: eligibility.code, error: eligibility.reason, eligibility });
      return true;
    }
    run.status = 'enqueued';
    run.requeueCount = (run.requeueCount || 0) + 1;
    await saveState?.();
    auditLog?.('workflow.dead_letter.requeued', actor, { executionId: runId, requeueCount: run.requeueCount });
    sendJson(res, 200, { success: true, execution: run, eligibility });
    return true;
  }

  // 4g. Stuck Execution Detection & Safe Recovery
  if (method === 'POST' && subPath === '/operations/recover-stuck') {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.recoverStuckExecutionsInDb(tx, {
          actorId: actor?.user?.id || actor?.id || 'system'
        })
      );
      auditLog?.('workflow.operations.stuck_recovered', actor, {
        recoveredCount: result.recoveredCount,
        deadLetteredCount: result.deadLetteredCount
      });
      sendJson(res, 200, result);
      return true;
    }
    const allRuns = [...(state?.workflowExecutions || []), ...(state?.records?.workflowRuns || [])];
    const detected = detectStuckExecutions({ executions: allRuns });
    sendJson(res, 200, {
      scanned: allRuns.length,
      stuckDetected: detected.stuckCount,
      recoveredCount: 0,
      deadLetteredCount: 0,
      recovered: [],
      deadLettered: [],
      stuckExecutions: detected.stuckExecutions
    });
    return true;
  }

  // 5. Execution Debugger (Redacted Step I/O + Logs)
  const debugMatch = subPath.match(/^\/runs\/([^/]+)\/debug$/);
  if (method === 'GET' && debugMatch) {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const runId = debugMatch[1];
    if (pgPool) {
      const data = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        const execRes = await tx.query(
          `SELECT * FROM workflow_executions WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
          [tx.agencyId, tx.locationId, runId]
        );
        if (execRes.rows.length === 0) return null;
        const stepsRes = await tx.query(
          `SELECT * FROM workflow_execution_steps WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3 ORDER BY started_at ASC`,
          [tx.agencyId, tx.locationId, runId]
        );
        const logs = await workflows2Repo.listExecutionLogs(tx, runId);
        const exec = execRes.rows[0];
        return {
          execution: {
            id: exec.id,
            workflowId: exec.workflow_id,
            workflowVersion: exec.workflow_version,
            status: exec.status,
            attempts: exec.attempts,
            lastErrorCode: exec.last_error_code,
            createdAt: exec.created_at,
            finishedAt: exec.finished_at
          },
          steps: stepsRes.rows.map(s => ({
            id: s.id,
            nodeId: s.node_id,
            attempt: s.attempt,
            status: s.status,
            errorCode: s.error_code,
            details: redactSensitivePayload(typeof s.details === 'string' ? JSON.parse(s.details) : (s.details || {})),
            startedAt: s.started_at,
            finishedAt: s.finished_at
          })),
          logs
        };
      });
      if (!data) {
        sendJson(res, 404, { error: 'Execution not found' });
        return true;
      }
      sendJson(res, 200, data);
      return true;
    }
    const run = (state?.records?.workflowRuns || []).find(r => r.id === runId && r.agencyId === agency?.id);
    if (!run) {
      sendJson(res, 404, { error: 'Execution not found' });
      return true;
    }
    sendJson(res, 200, {
      execution: {
        id: run.id,
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion || 1,
        status: run.status,
        attempts: run.attemptCount || 1,
        lastErrorCode: run.lastErrorCode || null,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt || null
      },
      steps: (run.steps || []).map(s => ({
        ...s,
        result: redactSensitivePayload(s.result)
      })),
      logs: []
    });
    return true;
  }

  // 6. Schedule Status Update
  const schedPatchMatch = subPath.match(/^\/schedules\/([^/]+)$/);
  if (method === 'PATCH' && schedPatchMatch) {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const scheduleId = schedPatchMatch[1];
    const body = await readJson(req);
    if (pgPool) {
      const updated = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflows2Repo.updateScheduleStatus(tx, scheduleId, body?.status)
      );
      if (!updated) {
        sendJson(res, 404, { error: 'Schedule not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }
    sendJson(res, 404, { error: 'Schedule not found' });
    return true;
  }

  // 7. Workflow-scoped V2 routes: /:id/(draft|publish|versions|rollback|schedules|pause|resume)
  const wfMatch = subPath.match(/^\/([^/]+)\/(draft|publish|versions|rollback|schedules|pause|resume)$/);
  if (!wfMatch) return false;

  const [, workflowId, action] = wfMatch;

  if (action === 'draft' && method === 'POST') {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const body = await readJson(req);
    if (pgPool) {
      try {
        const saved = await runInTenantTx(pgPool, tenantCtx, tx =>
          workflows2Repo.saveDraftGraph(tx, {
            workflowId,
            name: body?.name,
            description: body?.description,
            triggerType: body?.triggerType,
            triggerConfig: body?.triggerConfig,
            nodes: body?.nodes,
            graphJson: body?.graphJson,
            governancePolicy: body?.governancePolicy,
            expectedVersion: body?.expectedVersion
          })
        );
        sendJson(res, 200, saved);
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.message, code: err.code || 'DRAFT_SAVE_FAILED' });
      }
      return true;
    }
    const wf = (state?.records?.workflows || []).find(w => w.id === workflowId && w.agencyId === agency?.id);
    if (!wf) {
      sendJson(res, 404, { error: 'Workflow not found' });
      return true;
    }
    Object.assign(wf, {
      name: body?.name ?? wf.name,
      actions: body?.nodes ?? wf.actions,
      graphJson: body?.graphJson ?? wf.graphJson,
      updatedAt: new Date().toISOString()
    });
    await saveState();
    sendJson(res, 200, wf);
    return true;
  }

  if (action === 'publish' && method === 'POST') {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const body = await readJson(req);
    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, tx =>
          workflows2Repo.publishWorkflowVersion(tx, {
            workflowId,
            expectedVersion: body?.expectedVersion,
            publishedBy: actor?.id || null,
            changeSummary: body?.changeSummary || ''
          })
        );
        auditLog?.('crm.workflows.published', actor, { id: workflowId, version: result.version.versionNumber });
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.status || 400, {
          error: err.message,
          code: err.code || 'PUBLISH_FAILED',
          errors: err.errors || undefined
        });
      }
      return true;
    }
    const wf = (state?.records?.workflows || []).find(w => w.id === workflowId && w.agencyId === agency?.id);
    if (!wf) {
      sendJson(res, 404, { error: 'Workflow not found' });
      return true;
    }
    const validation = validateWorkflowGraphV2({
      nodes: wf.actions || [],
      edges: wf.graphJson?.edges || [],
      trigger: wf.trigger || null
    });
    if (!validation.valid) {
      sendJson(res, 400, { error: 'Workflow validation failed', code: 'WORKFLOW_VALIDATION_FAILED', errors: validation.errors });
      return true;
    }
    wf.version = (wf.version || 1) + 1;
    wf.status = 'published';
    wf.versions = wf.versions || [];
    const ver = {
      id: randomUUID(),
      workflowId,
      versionNumber: wf.version,
      status: 'published',
      publishedAt: new Date().toISOString()
    };
    wf.versions.unshift(ver);
    await saveState();
    sendJson(res, 200, { version: ver, warnings: validation.warnings });
    return true;
  }

  if (action === 'versions' && method === 'GET') {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const versions = await runInTenantTx(pgPool, tenantCtx, tx => workflows2Repo.listWorkflowVersions(tx, workflowId));
      sendJson(res, 200, { versions });
      return true;
    }
    const wf = (state?.records?.workflows || []).find(w => w.id === workflowId && w.agencyId === agency?.id);
    sendJson(res, 200, { versions: wf?.versions || [] });
    return true;
  }

  if (action === 'rollback' && method === 'POST') {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const body = await readJson(req);
    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, tx =>
          workflows2Repo.rollbackWorkflowVersion(tx, {
            workflowId,
            targetVersionNumber: body?.targetVersionNumber,
            actorId: actor?.id || null
          })
        );
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.status || 400, { error: err.message, code: err.code || 'ROLLBACK_FAILED' });
      }
      return true;
    }
    sendJson(res, 200, { rolledBackTo: body?.targetVersionNumber || 1 });
    return true;
  }

  if (action === 'schedules') {
    if (method === 'GET') {
      if (!checkScope(actor, 'workflows:read')) {
        sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        const schedules = await runInTenantTx(pgPool, tenantCtx, tx => workflows2Repo.listSchedules(tx, workflowId));
        sendJson(res, 200, { schedules });
        return true;
      }
      sendJson(res, 200, { schedules: [] });
      return true;
    }
    if (method === 'POST') {
      if (!checkScope(actor, 'workflows:write')) {
        sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const body = await readJson(req);
      if (pgPool) {
        try {
          const schedule = await runInTenantTx(pgPool, tenantCtx, tx =>
            workflows2Repo.createSchedule(tx, { workflowId, ...body })
          );
          sendJson(res, 201, schedule);
        } catch (err) {
          sendJson(res, err.status || 400, { error: err.message, code: err.code || 'SCHEDULE_CREATE_FAILED' });
        }
        return true;
      }
      sendJson(res, 201, { id: randomUUID(), workflowId, ...body, status: 'active' });
      return true;
    }
  }

  if (action === 'pause' && method === 'POST') {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.setWorkflowStatus(tx, {
          workflowId,
          targetStatus: 'paused',
          actorId: actor?.user?.id || actor?.id || 'system'
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: result.error, code: result.code });
        return true;
      }
      if (result.conflict || result.badRequest) {
        sendJson(res, 409, { error: result.error, code: result.code });
        return true;
      }
      auditLog?.('crm.workflows.paused', actor, { id: workflowId });
      sendJson(res, 200, result);
      return true;
    }
    const wf = (state?.workflows || state?.records?.workflows || []).find(w => w.id === workflowId && (!w.agencyId || w.agencyId === agency?.id));
    if (!wf) {
      sendJson(res, 404, { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' });
      return true;
    }
    wf.status = 'paused';
    await saveState?.();
    auditLog?.('crm.workflows.paused', actor, { id: workflowId });
    sendJson(res, 200, { success: true, workflow: wf });
    return true;
  }

  if (action === 'resume' && method === 'POST') {
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        workflowOpsRepo.setWorkflowStatus(tx, {
          workflowId,
          targetStatus: 'published',
          actorId: actor?.user?.id || actor?.id || 'system'
        })
      );
      if (result.notFound) {
        sendJson(res, 404, { error: result.error, code: result.code });
        return true;
      }
      if (result.conflict || result.badRequest) {
        sendJson(res, 409, { error: result.error, code: result.code });
        return true;
      }
      auditLog?.('crm.workflows.resumed', actor, { id: workflowId });
      sendJson(res, 200, result);
      return true;
    }
    const wf = (state?.workflows || state?.records?.workflows || []).find(w => w.id === workflowId && (!w.agencyId || w.agencyId === agency?.id));
    if (!wf) {
      sendJson(res, 404, { error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' });
      return true;
    }
    wf.status = 'published';
    await saveState?.();
    auditLog?.('crm.workflows.resumed', actor, { id: workflowId });
    sendJson(res, 200, { success: true, workflow: wf });
    return true;
  }

  return false;
}
