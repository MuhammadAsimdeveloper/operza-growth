/**
 * ============================================================================
 * Operza Workflow Operations 2.0 Repository — TenantTx & FORCE RLS Boundary
 * ============================================================================
 * Provides tenant-isolated operational observability, execution timeline,
 * attempt lineage, safe retry/requeue, cooperative cancellation, workflow
 * pause/resume, dead-letter management, stuck-execution recovery, and metrics.
 */

import { randomUUID } from 'node:crypto';
import {
  classifyWorkflowFailure,
  computeRetryBackoffMs,
  detectStuckExecutions,
  evaluateCancellationContract,
  evaluateRetryEligibility,
  sanitizeExecutionPayload
} from '../../workflow-engine/src/operations-2-0.mjs';
import { redactSensitivePayload } from '../../workflow-engine/src/graph-validator-v2.mjs';
import { assertValidStateTransition, canOperatorRequeueState, EXECUTION_STATES } from '../../workflow-engine/src/execution-state.mjs';

function parseJson(val, fallback) {
  if (val == null) return fallback;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return val;
}

function iso(val) {
  return val?.toISOString?.() || val || null;
}

export function normalizeOpsExecutionRow(row) {
  if (!row) return null;
  const createdAt = iso(row.created_at);
  const finishedAt = iso(row.finished_at);
  const startedAt = iso(row.started_at) || createdAt;
  const computedDuration = row.duration_ms != null
    ? Number(row.duration_ms)
    : (finishedAt && startedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : 0);

  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name || row.def_name || 'Workflow',
    workflowVersion: Number(row.workflow_version) || 1,
    workflowSnapshot: parseJson(row.workflow_snapshot, null),
    status: row.status,
    triggerType: row.trigger_type || row.def_trigger_type || 'manual',
    triggerEvent: redactSensitivePayload(parseJson(row.trigger_event, {})),
    currentNodeId: row.current_node_id || null,
    resumeNodeId: row.resume_node_id || null,
    waitGeneration: Number(row.wait_generation) || 0,
    waitType: row.wait_type || null,
    workerLeaseId: row.worker_lease_id || row.leased_by || null,
    leaseExpiresAt: iso(row.lease_expires_at),
    heartbeatAt: iso(row.heartbeat_at),
    attemptCount: Number(row.attempt_count || row.attempts) || 0,
    maxAttempts: Number(row.max_attempts) || 3,
    lastErrorCode: row.last_error_code || null,
    failureCategory: row.failure_category || null,
    failureMessage: row.failure_message || null,
    retryable: Boolean(row.retryable),
    retryPolicy: parseJson(row.retry_policy, { maxAttempts: 3, baseDelayMs: 5000, maxDelayMs: 300000, jitter: true }),
    retryAt: iso(row.retry_at),
    nextRetryAt: iso(row.next_retry_at || row.retry_at),
    correlationId: row.correlation_id || null,
    traceId: row.trace_id || null,
    parentExecutionId: row.parent_execution_id || null,
    rootExecutionId: row.root_execution_id || null,
    totalNodesCount: Number(row.total_nodes_count) || 0,
    completedNodesCount: Number(row.completed_nodes_count) || 0,
    failedNodesCount: Number(row.failed_nodes_count) || 0,
    cancelRequestedAt: iso(row.cancel_requested_at),
    cancelRequestedBy: row.cancel_requested_by || null,
    canceledAt: iso(row.canceled_at),
    deadLetteredAt: iso(row.dead_lettered_at),
    deadLetterReason: row.dead_letter_reason || null,
    requeuedAt: iso(row.requeued_at),
    requeuedBy: row.requeued_by || null,
    requeueCount: Number(row.requeue_count) || 0,
    startedAt,
    finishedAt,
    durationMs: computedDuration,
    createdAt,
    updatedAt: iso(row.updated_at)
  };
}

export function normalizeOpsStepRow(row, index = 0) {
  if (!row) return null;
  const startedAt = iso(row.started_at);
  const finishedAt = iso(row.finished_at);
  const durationMs = row.duration_ms != null
    ? Number(row.duration_ms)
    : (finishedAt && startedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : 0);

  return {
    id: row.id,
    executionId: row.execution_id,
    nodeId: row.node_id,
    nodeType: row.node_type || null,
    nodeName: row.node_name || row.node_id,
    executionOrder: Number(row.execution_order) || (index + 1),
    attempt: Number(row.attempt) || 1,
    status: row.status,
    durationMs,
    inputSummary: sanitizeExecutionPayload(parseJson(row.input_summary, {})),
    outputSummary: sanitizeExecutionPayload(parseJson(row.output_summary, parseJson(row.details, {}))),
    details: sanitizeExecutionPayload(parseJson(row.details, {})),
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    failureCategory: row.failure_category || null,
    precedingNodeIds: parseJson(row.preceding_node_ids, []),
    correlationId: row.correlation_id || null,
    startedAt,
    finishedAt
  };
}

export function normalizeAttemptRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    executionId: row.execution_id,
    attemptNumber: Number(row.attempt_number),
    status: row.status,
    failureCategory: row.failure_category || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    retryable: Boolean(row.retryable),
    workerLeaseId: row.worker_lease_id || null,
    triggeredBy: row.triggered_by || null,
    retryReason: row.retry_reason || null,
    correlationId: row.correlation_id || null,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    createdAt: iso(row.created_at)
  };
}

function buildFilterWhere(tx, filters = {}, alias = 'e') {
  const clauses = [`${alias}.agency_id = $1`, `${alias}.location_id = $2`];
  const params = [tx.agencyId, tx.locationId];
  let idx = 3;

  if (filters.workflowId) {
    clauses.push(`${alias}.workflow_id = $${idx++}`);
    params.push(filters.workflowId);
  }
  if (filters.status && filters.status !== 'all') {
    clauses.push(`${alias}.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.triggerType && filters.triggerType !== 'all') {
    clauses.push(`COALESCE(${alias}.trigger_type, 'manual') = $${idx++}`);
    params.push(filters.triggerType);
  }
  if (filters.failureCategory && filters.failureCategory !== 'all') {
    clauses.push(`${alias}.failure_category = $${idx++}`);
    params.push(filters.failureCategory);
  }
  if (filters.dateFrom) {
    clauses.push(`${alias}.created_at >= $${idx++}`);
    params.push(new Date(filters.dateFrom));
  }
  if (filters.dateTo) {
    clauses.push(`${alias}.created_at <= $${idx++}`);
    params.push(new Date(filters.dateTo));
  }
  if (filters.search) {
    const q = `%${String(filters.search).trim()}%`;
    clauses.push(`(CAST(${alias}.id AS text) ILIKE $${idx} OR COALESCE(${alias}.workflow_name, '') ILIKE $${idx} OR COALESCE(${alias}.last_error_code, '') ILIKE $${idx})`);
    params.push(q);
    idx++;
  }

  return { whereSql: clauses.join(' AND '), params, nextIdx: idx };
}

export function createWorkflowOperationsRepository() {
  return {
    async listOperationalRuns(tx, filters = {}) {
      const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
      const offset = Math.max(0, Number(filters.offset) || 0);
      const { whereSql, params, nextIdx } = buildFilterWhere(tx, filters, 'e');

      const countRes = await tx.query(
        `SELECT COUNT(*)::int AS total FROM workflow_executions e WHERE ${whereSql}`,
        params
      );
      const total = countRes.rows[0]?.total || 0;

      const listRes = await tx.query(
        `SELECT e.*, d.name AS def_name, d.trigger_type AS def_trigger_type
         FROM workflow_executions e
         LEFT JOIN workflow_definitions d
           ON d.agency_id = e.agency_id AND d.location_id = e.location_id AND d.id = e.workflow_id
         WHERE ${whereSql}
         ORDER BY e.created_at DESC
         LIMIT $${nextIdx} OFFSET $${nextIdx + 1}`,
        [...params, limit, offset]
      );

      return {
        items: listRes.rows.map(r => {
          const item = normalizeOpsExecutionRow(r);
          // Keep list payload compact (omit large snapshot)
          delete item.workflowSnapshot;
          return item;
        }),
        total,
        limit,
        offset
      };
    },

    async getOperationalRunDetail(tx, executionId) {
      const execRes = await tx.query(
        `SELECT e.*, d.name AS def_name, d.trigger_type AS def_trigger_type
         FROM workflow_executions e
         LEFT JOIN workflow_definitions d
           ON d.agency_id = e.agency_id AND d.location_id = e.location_id AND d.id = e.workflow_id
         WHERE e.agency_id = $1 AND e.location_id = $2 AND e.id = $3`,
        [tx.agencyId, tx.locationId, executionId]
      );
      if (execRes.rows.length === 0) return null;

      const execution = normalizeOpsExecutionRow(execRes.rows[0]);
      const stepsRes = await tx.query(
        `SELECT * FROM workflow_execution_steps
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
         ORDER BY execution_order ASC, started_at ASC`,
        [tx.agencyId, tx.locationId, executionId]
      );
      const attemptsRes = await tx.query(
        `SELECT * FROM workflow_execution_attempts
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
         ORDER BY attempt_number ASC`,
        [tx.agencyId, tx.locationId, executionId]
      );
      const logsRes = await tx.query(
        `SELECT id, execution_id, node_id, level, event_type, message, metadata_json, correlation_id, created_at
         FROM workflow_execution_logs
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
         ORDER BY created_at ASC
         LIMIT 200`,
        [tx.agencyId, tx.locationId, executionId]
      );
      const receiptsRes = await tx.query(
        `SELECT id, node_id, action_hash, status, last_error_code, started_at, completed_at
         FROM workflow_action_receipts
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3`,
        [tx.agencyId, tx.locationId, executionId]
      );

      const steps = stepsRes.rows.map((r, i) => normalizeOpsStepRow(r, i));
      const attempts = attemptsRes.rows.map(normalizeAttemptRow);
      const logs = logsRes.rows.map(r => ({
        id: r.id,
        executionId: r.execution_id,
        nodeId: r.node_id,
        level: r.level,
        eventType: r.event_type,
        message: r.message,
        metadata: sanitizeExecutionPayload(parseJson(r.metadata_json, {})),
        correlationId: r.correlation_id,
        createdAt: iso(r.created_at)
      }));

      const retryEligibility = evaluateRetryEligibility({
        execution,
        steps,
        receipts: receiptsRes.rows,
        confirmSideEffectRetry: false
      });
      const cancellationContract = evaluateCancellationContract(execution);

      // Strip raw snapshot from detail response while keeping version metadata
      const { workflowSnapshot: _snap, ...safeExecution } = execution;
      return {
        execution: {
          ...safeExecution,
          nodeCounts: {
            total: execution.totalNodesCount || steps.length,
            completed: execution.completedNodesCount || steps.filter(s => s.status === 'completed').length,
            failed: execution.failedNodesCount || steps.filter(s => s.status === 'failed').length
          }
        },
        steps,
        attempts,
        logs,
        receipts: receiptsRes.rows.map(r => ({
          id: r.id,
          nodeId: r.node_id,
          actionHash: r.action_hash,
          actionKey: r.node_id,
          status: r.status,
          lastErrorCode: r.last_error_code || null,
          startedAt: iso(r.started_at),
          completedAt: iso(r.completed_at)
        })),
        retryEligibility,
        cancellationContract
      };
    },

    async retryOrRequeueExecution(tx, {
      executionId,
      actorId = 'system',
      reason = 'Operator retry',
      confirmSideEffectRetry = false,
      targetMode = 'retry'
    }) {
      const lockRes = await tx.query(
        `SELECT * FROM workflow_executions
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         FOR UPDATE`,
        [tx.agencyId, tx.locationId, executionId]
      );
      if (lockRes.rows.length === 0) {
        return { notFound: true, error: 'Workflow execution not found', code: 'EXECUTION_NOT_FOUND' };
      }

      const execution = normalizeOpsExecutionRow(lockRes.rows[0]);
      if (targetMode === 'requeue' && execution.status !== EXECUTION_STATES.DEAD_LETTER) {
        return {
          conflict: true,
          code: 'NOT_DEAD_LETTERED',
          error: `Execution is in '${execution.status}' state and cannot be requeued from dead-letter queue.`
        };
      }
      if (!canOperatorRequeueState(execution.status) && execution.status !== EXECUTION_STATES.RETRY_SCHEDULED) {
        return {
          conflict: true,
          code: 'INVALID_RETRY_STATE',
          error: `Execution in state '${execution.status}' cannot be retried.`
        };
      }

      const stepsRes = await tx.query(
        `SELECT * FROM workflow_execution_steps
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
         ORDER BY execution_order ASC, started_at ASC`,
        [tx.agencyId, tx.locationId, executionId]
      );
      const receiptsRes = await tx.query(
        `SELECT id, node_id, action_hash, status FROM workflow_action_receipts
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3`,
        [tx.agencyId, tx.locationId, executionId]
      );

      const steps = stepsRes.rows.map((r, i) => normalizeOpsStepRow(r, i));
      const eligibility = evaluateRetryEligibility({
        execution,
        steps,
        receipts: receiptsRes.rows,
        confirmSideEffectRetry
      });

      if (!eligibility.eligible) {
        return { conflict: true, code: eligibility.code, error: eligibility.reason, eligibility };
      }
      if (eligibility.requiresConfirmation && !confirmSideEffectRetry) {
        return {
          confirmationRequired: true,
          code: eligibility.code,
          error: eligibility.reason,
          eligibility
        };
      }

      const nextAttempt = (execution.attemptCount || 0) + 1;
      const nextStatus = EXECUTION_STATES.ENQUEUED;
      const correlationId = execution.correlationId || `corr_${randomUUID().slice(0, 12)}`;

      const updateRes = await tx.query(
        `UPDATE workflow_executions
         SET status = $1,
             attempts = $2,
             attempt_count = $2,
             worker_lease_id = NULL,
             leased_by = NULL,
             lease_expires_at = NULL,
             retry_at = NULL,
             next_retry_at = NULL,
             finished_at = NULL,
             dead_lettered_at = NULL,
             requeued_at = CASE WHEN $3 = 'requeue' THEN now() ELSE requeued_at END,
             requeued_by = CASE WHEN $3 = 'requeue' THEN $4 ELSE requeued_by END,
             requeue_count = CASE WHEN $3 = 'requeue' THEN requeue_count + 1 ELSE requeue_count END,
             correlation_id = COALESCE(correlation_id, $5),
             updated_at = now()
         WHERE agency_id = $6 AND location_id = $7 AND id = $8 AND status = $9
         RETURNING *`,
        [
          nextStatus,
          nextAttempt,
          targetMode,
          actorId,
          correlationId,
          tx.agencyId,
          tx.locationId,
          executionId,
          execution.status
        ]
      );

      if (updateRes.rowCount === 0) {
        return { conflict: true, code: 'CONCURRENT_STATE_CHANGE', error: 'Execution state changed concurrently.' };
      }

      await tx.query(
        `INSERT INTO workflow_execution_attempts (
          id, agency_id, location_id, execution_id, attempt_number, status,
          triggered_by, retry_reason, correlation_id, started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        ON CONFLICT (agency_id, location_id, execution_id, attempt_number) DO UPDATE
        SET status = EXCLUDED.status, triggered_by = EXCLUDED.triggered_by, retry_reason = EXCLUDED.retry_reason`,
        [randomUUID(), tx.agencyId, tx.locationId, executionId, nextAttempt, nextStatus, actorId, reason, correlationId]
      );

      await tx.query(
        `INSERT INTO workflow_execution_logs (
          id, agency_id, location_id, execution_id, level, event_type, message, metadata_json, correlation_id
        ) VALUES ($1, $2, $3, $4, 'info', $5, $6, $7::jsonb, $8)`,
        [
          randomUUID(),
          tx.agencyId,
          tx.locationId,
          executionId,
          targetMode === 'requeue' ? 'dlq_requeued' : 'execution_retried',
          `${targetMode === 'requeue' ? 'Dead-letter requeued' : 'Retry scheduled'} for attempt #${nextAttempt} against pinned workflow v${execution.workflowVersion}`,
          JSON.stringify(sanitizeExecutionPayload({
            actorId,
            reason,
            attemptNumber: nextAttempt,
            preservedWorkflowVersion: execution.workflowVersion,
            confirmSideEffectRetry
          })),
          correlationId
        ]
      );

      return {
        success: true,
        execution: normalizeOpsExecutionRow(updateRes.rows[0]),
        eligibility
      };
    },

    async cancelExecution(tx, { executionId, actorId = 'system', reason = 'Operator canceled' }) {
      const lockRes = await tx.query(
        `SELECT * FROM workflow_executions
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         FOR UPDATE`,
        [tx.agencyId, tx.locationId, executionId]
      );
      if (lockRes.rows.length === 0) {
        return { notFound: true, code: 'EXECUTION_NOT_FOUND', error: 'Workflow execution not found' };
      }

      const execution = normalizeOpsExecutionRow(lockRes.rows[0]);
      const contract = evaluateCancellationContract(execution);
      if (!contract.supported) {
        return { conflict: true, code: 'CANCELLATION_UNSUPPORTED', error: contract.reason, contract };
      }

      if (contract.mode === 'immediate') {
        assertValidStateTransition(execution.status, EXECUTION_STATES.CANCELED);
        const upd = await tx.query(
          `UPDATE workflow_executions
           SET status = 'canceled',
               cancel_requested_at = COALESCE(cancel_requested_at, now()),
               cancel_requested_by = COALESCE(cancel_requested_by, $1),
               canceled_at = now(),
               finished_at = now(),
               worker_lease_id = NULL,
               leased_by = NULL,
               lease_expires_at = NULL,
               updated_at = now()
           WHERE agency_id = $2 AND location_id = $3 AND id = $4 AND status = $5
           RETURNING *`,
          [actorId, tx.agencyId, tx.locationId, executionId, execution.status]
        );
        if (upd.rowCount === 0) {
          return { conflict: true, code: 'CONCURRENT_STATE_CHANGE', error: 'Execution state changed concurrently.' };
        }
        await tx.query(
          `INSERT INTO workflow_execution_logs (
            id, agency_id, location_id, execution_id, level, event_type, message, metadata_json, correlation_id
          ) VALUES ($1, $2, $3, $4, 'warn', 'execution_canceled', $5, $6::jsonb, $7)`,
          [
            randomUUID(),
            tx.agencyId,
            tx.locationId,
            executionId,
            `Execution canceled before completion (${reason})`,
            JSON.stringify({ actorId, reason, mode: 'immediate' }),
            execution.correlationId
          ]
        );
        return { success: true, mode: 'immediate', execution: normalizeOpsExecutionRow(upd.rows[0]), contract };
      }

      // Cooperative cancellation request for running / resuming executions
      const upd = await tx.query(
        `UPDATE workflow_executions
         SET cancel_requested_at = COALESCE(cancel_requested_at, now()),
             cancel_requested_by = COALESCE(cancel_requested_by, $1),
             updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND id = $4 AND status = $5
         RETURNING *`,
        [actorId, tx.agencyId, tx.locationId, executionId, execution.status]
      );
      await tx.query(
        `INSERT INTO workflow_execution_logs (
          id, agency_id, location_id, execution_id, level, event_type, message, metadata_json, correlation_id
        ) VALUES ($1, $2, $3, $4, 'warn', 'cancellation_requested', $5, $6::jsonb, $7)`,
        [
          randomUUID(),
          tx.agencyId,
          tx.locationId,
          executionId,
          `Cooperative cancellation requested (${reason}); waiting for worker acknowledgement`,
          JSON.stringify({ actorId, reason, mode: 'cooperative_requested' }),
          execution.correlationId
        ]
      );
      return {
        success: true,
        mode: 'cooperative_requested',
        execution: normalizeOpsExecutionRow(upd.rows[0]),
        contract
      };
    },

    async setWorkflowStatus(tx, { workflowId, targetStatus, actorId = 'system' }) {
      if (!['paused', 'published'].includes(targetStatus)) {
        return { badRequest: true, code: 'INVALID_STATUS', error: 'Target workflow status must be paused or published.' };
      }
      const lockRes = await tx.query(
        `SELECT * FROM workflow_definitions
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         FOR UPDATE`,
        [tx.agencyId, tx.locationId, workflowId]
      );
      if (lockRes.rows.length === 0) {
        return { notFound: true, code: 'WORKFLOW_NOT_FOUND', error: 'Workflow not found.' };
      }
      const wf = lockRes.rows[0];
      if (wf.status === 'archived') {
        return { conflict: true, code: 'WORKFLOW_ARCHIVED', error: 'Archived workflows cannot be paused or resumed.' };
      }
      const upd = await tx.query(
        `UPDATE workflow_definitions
         SET status = $1, updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND id = $4
         RETURNING id, name, status, version, updated_at`,
        [targetStatus, tx.agencyId, tx.locationId, workflowId]
      );
      return { success: true, workflow: upd.rows[0], previousStatus: wf.status, actorId };
    },

    async listDeadLetterExecutions(tx, filters = {}) {
      return this.listOperationalRuns(tx, { ...filters, status: EXECUTION_STATES.DEAD_LETTER });
    },

    async getOperationalMetrics(tx, filters = {}) {
      const { whereSql, params } = buildFilterWhere(tx, filters, 'e');
      const statsRes = await tx.query(
        `SELECT
           COUNT(*)::int AS total_executions,
           COUNT(*) FILTER (WHERE e.status = 'completed')::int AS completed_count,
           COUNT(*) FILTER (WHERE e.status = 'failed')::int AS failed_count,
           COUNT(*) FILTER (WHERE e.status = 'running' OR e.status = 'resuming')::int AS running_count,
           COUNT(*) FILTER (WHERE e.status = 'pending' OR e.status = 'enqueued')::int AS queued_count,
           COUNT(*) FILTER (WHERE e.status = 'retry_scheduled')::int AS retry_scheduled_count,
           COUNT(*) FILTER (WHERE e.status = 'dead_letter')::int AS dead_letter_count,
           COUNT(*) FILTER (WHERE e.status = 'canceled')::int AS canceled_count,
           COUNT(*) FILTER (WHERE e.status IN ('waiting', 'waiting_approval', 'waiting_webhook'))::int AS waiting_count,
           COALESCE(SUM(e.attempts), 0)::int AS total_attempts,
           COALESCE(AVG(COALESCE(e.duration_ms, EXTRACT(EPOCH FROM (e.finished_at - e.created_at)) * 1000)) FILTER (WHERE e.finished_at IS NOT NULL OR e.duration_ms IS NOT NULL), 0)::float8 AS avg_duration_ms
         FROM workflow_executions e
         WHERE ${whereSql}`,
        params
      );

      const categoriesRes = await tx.query(
        `SELECT COALESCE(e.failure_category, 'unknown') AS category, COUNT(*)::int AS count
         FROM workflow_executions e
         WHERE ${whereSql} AND e.status IN ('failed', 'dead_letter', 'retry_scheduled')
         GROUP BY COALESCE(e.failure_category, 'unknown')
         ORDER BY count DESC
         LIMIT 10`,
        params
      );

      const topFailingRes = await tx.query(
        `SELECT e.workflow_id, COALESCE(MAX(e.workflow_name), MAX(d.name), 'Workflow') AS workflow_name,
                COUNT(*) FILTER (WHERE e.status IN ('failed', 'dead_letter'))::int AS failure_count,
                COUNT(*)::int AS total_count
         FROM workflow_executions e
         LEFT JOIN workflow_definitions d
           ON d.agency_id = e.agency_id AND d.location_id = e.location_id AND d.id = e.workflow_id
         WHERE ${whereSql}
         GROUP BY e.workflow_id
         HAVING COUNT(*) FILTER (WHERE e.status IN ('failed', 'dead_letter')) > 0
         ORDER BY failure_count DESC, total_count DESC
         LIMIT 5`,
        params
      );

      const trendsRes = await tx.query(
        `SELECT to_char(date_trunc('day', e.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE e.status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE e.status IN ('failed', 'dead_letter'))::int AS failed
         FROM workflow_executions e
         WHERE ${whereSql}
         GROUP BY 1
         ORDER BY 1 DESC
         LIMIT 14`,
        params
      );

      const recentFailuresRes = await tx.query(
        `SELECT e.*, d.name AS def_name, d.trigger_type AS def_trigger_type
         FROM workflow_executions e
         LEFT JOIN workflow_definitions d
           ON d.agency_id = e.agency_id AND d.location_id = e.location_id AND d.id = e.workflow_id
         WHERE ${whereSql} AND e.status IN ('failed', 'dead_letter')
         ORDER BY e.created_at DESC
         LIMIT 8`,
        params
      );

      const stuckCandidatesRes = await tx.query(
        `SELECT id, workflow_id, status, worker_lease_id, lease_expires_at, heartbeat_at, started_at, created_at, next_retry_at
         FROM workflow_executions e
         WHERE ${whereSql} AND e.status IN ('running', 'resuming', 'retry_scheduled')
         LIMIT 200`,
        params
      );
      const stuckSummary = detectStuckExecutions({
        executions: stuckCandidatesRes.rows.map(normalizeOpsExecutionRow)
      });

      const approvalStats = await tx.query(
        `SELECT COUNT(*)::int AS pending_approvals
         FROM workflow_approvals
         WHERE agency_id = $1 AND location_id = $2 AND status = 'pending'`,
        [tx.agencyId, tx.locationId]
      );

      const s = statsRes.rows[0] || {};
      const total = s.total_executions || 0;
      const completed = s.completed_count || 0;
      return {
        totalExecutions: total,
        completedCount: completed,
        failedCount: s.failed_count || 0,
        runningCount: s.running_count || 0,
        queuedCount: s.queued_count || 0,
        retryScheduledCount: s.retry_scheduled_count || 0,
        deadLetterCount: s.dead_letter_count || 0,
        canceledCount: s.canceled_count || 0,
        activeCount: (s.running_count || 0) + (s.queued_count || 0),
        waitingCount: s.waiting_count || 0,
        totalAttempts: s.total_attempts || 0,
        avgDurationMs: Math.round(s.avg_duration_ms || 0),
        successRate: total > 0 ? Number((completed / total).toFixed(4)) : 1,
        pendingApprovals: approvalStats.rows[0]?.pending_approvals || 0,
        stuckCount: stuckSummary.stuckCount,
        failureCategories: categoriesRes.rows,
        topFailingWorkflows: topFailingRes.rows.map(r => ({
          workflowId: r.workflow_id,
          workflowName: r.workflow_name,
          failureCount: r.failure_count,
          totalCount: r.total_count
        })),
        executionTrends: trendsRes.rows.reverse(),
        recentFailures: recentFailuresRes.rows.map(r => {
          const item = normalizeOpsExecutionRow(r);
          delete item.workflowSnapshot;
          return item;
        })
      };
    },

    async recoverStuckExecutionsInDb(tx, {
      runningTimeoutMs = 300_000,
      heartbeatStaleMs = 60_000,
      actorId = 'system_recovery',
      now = Date.now()
    } = {}) {
      const candidatesRes = await tx.query(
        `SELECT * FROM workflow_executions
         WHERE agency_id = $1 AND location_id = $2
           AND status IN ('running', 'resuming', 'retry_scheduled')
         ORDER BY created_at ASC
         LIMIT 50
         FOR UPDATE SKIP LOCKED`,
        [tx.agencyId, tx.locationId]
      );

      const normalized = candidatesRes.rows.map(normalizeOpsExecutionRow);
      const detected = detectStuckExecutions({
        executions: normalized,
        now,
        runningTimeoutMs,
        heartbeatStaleMs
      });

      const byId = new Map(normalized.map(e => [e.id, e]));
      const recovered = [];
      const deadLettered = [];

      for (const item of detected.stuckExecutions) {
        const exec = byId.get(item.executionId);
        if (!exec) continue;
        const attempts = exec.attemptCount || 1;
        const maxAttempts = exec.maxAttempts || 3;
        const classification = classifyWorkflowFailure({ errorCode: item.stuckReason });

        if (attempts >= maxAttempts) {
          const upd = await tx.query(
            `UPDATE workflow_executions
             SET status = 'dead_letter',
                 last_error_code = $1,
                 failure_category = $2,
                 failure_message = $3,
                 retryable = false,
                 worker_lease_id = NULL,
                 leased_by = NULL,
                 lease_expires_at = NULL,
                 dead_lettered_at = now(),
                 dead_letter_reason = $3,
                 finished_at = now(),
                 updated_at = now()
             WHERE agency_id = $4 AND location_id = $5 AND id = $6 AND status = $7
             RETURNING id, status`,
            [
              item.stuckReason,
              classification.category,
              `Stuck execution (${item.stuckReason}) exhausted max attempts (${attempts}/${maxAttempts})`,
              tx.agencyId,
              tx.locationId,
              exec.id,
              exec.status
            ]
          );
          if (upd.rowCount > 0) {
            deadLettered.push({ executionId: exec.id, stuckReason: item.stuckReason });
          }
        } else {
          const backoffMs = computeRetryBackoffMs({ attempt: attempts, policy: exec.retryPolicy });
          const nextRetryAt = new Date(now + backoffMs);
          const upd = await tx.query(
            `UPDATE workflow_executions
             SET status = 'retry_scheduled',
                 last_error_code = $1,
                 failure_category = $2,
                 failure_message = $3,
                 retryable = true,
                 worker_lease_id = NULL,
                 leased_by = NULL,
                 lease_expires_at = NULL,
                 retry_at = $4,
                 next_retry_at = $4,
                 updated_at = now()
             WHERE agency_id = $5 AND location_id = $6 AND id = $7 AND status = $8
             RETURNING id, status`,
            [
              item.stuckReason,
              classification.category,
              `Stuck execution (${item.stuckReason}) recovered for retry`,
              nextRetryAt,
              tx.agencyId,
              tx.locationId,
              exec.id,
              exec.status
            ]
          );
          if (upd.rowCount > 0) {
            recovered.push({ executionId: exec.id, stuckReason: item.stuckReason, nextRetryAt: nextRetryAt.toISOString(), backoffMs });
          }
        }

        await tx.query(
          `INSERT INTO workflow_execution_logs (
            id, agency_id, location_id, execution_id, level, event_type, message, metadata_json, correlation_id
          ) VALUES ($1, $2, $3, $4, 'warn', 'stuck_execution_recovered', $5, $6::jsonb, $7)`,
          [
            randomUUID(),
            tx.agencyId,
            tx.locationId,
            exec.id,
            `Detected stuck execution (${item.stuckReason}) and transitioned safely`,
            JSON.stringify({ actorId, stuckReason: item.stuckReason, attempts, maxAttempts }),
            exec.correlationId
          ]
        );
      }

      return {
        scanned: candidatesRes.rows.length,
        stuckDetected: detected.stuckCount,
        recoveredCount: recovered.length,
        deadLetteredCount: deadLettered.length,
        recovered,
        deadLettered
      };
    }
  };
}
