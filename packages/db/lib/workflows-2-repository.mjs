/**
 * ============================================================================
 * Operza Workflows 2.0 Repository — TenantTx & FORCE RLS Boundary
 * ============================================================================
 * Manages immutable workflow_versions, optimistic-concurrency publishing,
 * rollback, UTC/IANA workflow_schedules, redacted workflow_execution_logs,
 * and workflow observability metrics.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  normalizeGovernancePolicy,
  redactSensitivePayload,
  validateWorkflowGraphV2
} from '../../workflow-engine/src/graph-validator-v2.mjs';
import { computeNextRunAtUtc, isValidIanaTimezone } from '../../workflow-engine/src/scheduler-v2.mjs';

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseJson(val, fallback) {
  if (val == null) return fallback;
  return typeof val === 'string' ? JSON.parse(val) : val;
}

export function normalizeVersionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    workflowId: row.workflow_id,
    versionNumber: Number(row.version_number),
    status: row.status,
    triggerType: row.trigger_type,
    triggerConfig: parseJson(row.trigger_config, {}),
    nodes: parseJson(row.nodes, []),
    graphJson: parseJson(row.graph_json, { nodes: [], edges: [] }),
    governancePolicy: parseJson(row.governance_policy, {}),
    checksum: row.checksum,
    changeSummary: row.change_summary || '',
    publishedBy: row.published_by || null,
    publishedAt: row.published_at?.toISOString?.() || row.published_at
  };
}

export function normalizeScheduleRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    workflowId: row.workflow_id,
    scheduleType: row.schedule_type,
    timezone: row.timezone,
    cronExpression: row.cron_expression || null,
    intervalEvery: row.interval_every ? Number(row.interval_every) : null,
    intervalUnit: row.interval_unit || null,
    runAt: row.run_at?.toISOString?.() || row.run_at || null,
    nextRunAt: row.next_run_at?.toISOString?.() || row.next_run_at || null,
    lastRunAt: row.last_run_at?.toISOString?.() || row.last_run_at || null,
    catchupPolicy: row.catchup_policy,
    status: row.status,
    runCount: Number(row.run_count) || 0,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function createWorkflows2Repository() {
  return {
    async saveDraftGraph(tx, {
      workflowId,
      name,
      description,
      triggerType,
      triggerConfig,
      nodes,
      graphJson,
      governancePolicy,
      expectedVersion
    }) {
      const lockRes = await tx.query(
        `SELECT * FROM workflow_definitions WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, workflowId]
      );
      if (lockRes.rows.length === 0) {
        throw Object.assign(new Error('Workflow not found'), { code: 'WORKFLOW_NOT_FOUND', status: 404 });
      }
      const existing = lockRes.rows[0];
      if (expectedVersion !== undefined && Number(existing.version) !== Number(expectedVersion)) {
        throw Object.assign(new Error('Workflow version conflict'), { code: 'VERSION_CONFLICT', status: 409 });
      }

      const nextGraph = graphJson || parseJson(existing.graph_json, { nodes: [], edges: [] });
      const nextNodes = Array.isArray(nodes) ? nodes : (Array.isArray(nextGraph.nodes) ? nextGraph.nodes : parseJson(existing.nodes, []));
      const nextPolicy = normalizeGovernancePolicy(governancePolicy || parseJson(existing.governance_policy, {}));

      const sql = `
        UPDATE workflow_definitions
        SET name = COALESCE($1, name),
            description = COALESCE($2, description),
            trigger_type = COALESCE($3, trigger_type),
            trigger_config = COALESCE($4::jsonb, trigger_config),
            nodes = $5::jsonb,
            graph_json = $6::jsonb,
            governance_policy = $7::jsonb,
            draft_updated_at = now(),
            updated_at = now()
        WHERE agency_id = $8 AND location_id = $9 AND id = $10
        RETURNING *
      `;
      const res = await tx.query(sql, [
        name ?? null,
        description ?? null,
        triggerType ?? null,
        triggerConfig ? JSON.stringify(triggerConfig) : null,
        JSON.stringify(nextNodes),
        JSON.stringify(nextGraph),
        JSON.stringify(nextPolicy),
        tx.agencyId,
        tx.locationId,
        workflowId
      ]);
      return res.rows[0];
    },

    async publishWorkflowVersion(tx, { workflowId, expectedVersion, publishedBy = null, changeSummary = '' }) {
      const lockRes = await tx.query(
        `SELECT * FROM workflow_definitions WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, workflowId]
      );
      if (lockRes.rows.length === 0) {
        throw Object.assign(new Error('Workflow not found'), { code: 'WORKFLOW_NOT_FOUND', status: 404 });
      }
      const defRow = lockRes.rows[0];
      if (expectedVersion !== undefined && Number(defRow.version) !== Number(expectedVersion)) {
        throw Object.assign(
          new Error(`Version conflict: expected ${expectedVersion}, current ${defRow.version}`),
          { code: 'VERSION_CONFLICT', status: 409 }
        );
      }

      const graphJson = parseJson(defRow.graph_json, { nodes: [], edges: [] });
      const rawNodes = parseJson(defRow.nodes, []);
      const nodesToValidate = Array.isArray(graphJson.nodes) && graphJson.nodes.length > 0 ? graphJson.nodes : rawNodes;
      const edgesToValidate = Array.isArray(graphJson.edges) ? graphJson.edges : [];
      const triggerConfig = parseJson(defRow.trigger_config, {});
      const policy = normalizeGovernancePolicy(parseJson(defRow.governance_policy, {}));

      const validation = validateWorkflowGraphV2({
        nodes: nodesToValidate,
        edges: edgesToValidate,
        trigger: { kind: defRow.trigger_type, ...triggerConfig },
        governancePolicy: policy
      });
      if (!validation.valid) {
        throw Object.assign(new Error('Workflow validation failed before publish'), {
          code: 'WORKFLOW_VALIDATION_FAILED',
          status: 400,
          errors: validation.errors
        });
      }

      const maxVerRes = await tx.query(
        `SELECT COALESCE(MAX(version_number), 0)::int AS max_ver FROM workflow_versions WHERE agency_id = $1 AND location_id = $2 AND workflow_id = $3`,
        [tx.agencyId, tx.locationId, workflowId]
      );
      const nextVersionNumber = (maxVerRes.rows[0]?.max_ver || 0) + 1;

      await tx.query(
        `UPDATE workflow_versions SET status = 'superseded' WHERE agency_id = $1 AND location_id = $2 AND workflow_id = $3 AND status = 'published'`,
        [tx.agencyId, tx.locationId, workflowId]
      );

      const versionId = randomUUID();
      const checksum = sha256({
        triggerType: defRow.trigger_type,
        triggerConfig,
        nodes: rawNodes,
        graphJson,
        policy
      });

      const insertVer = await tx.query(
        `INSERT INTO workflow_versions (
          id, agency_id, location_id, workflow_id, version_number, status,
          trigger_type, trigger_config, nodes, graph_json, governance_policy,
          checksum, change_summary, published_by, published_at
        ) VALUES ($1, $2, $3, $4, $5, 'published', $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, now())
        RETURNING *`,
        [
          versionId,
          tx.agencyId,
          tx.locationId,
          workflowId,
          nextVersionNumber,
          defRow.trigger_type,
          JSON.stringify(triggerConfig),
          JSON.stringify(rawNodes),
          JSON.stringify(graphJson),
          JSON.stringify(policy),
          checksum,
          String(changeSummary || '').slice(0, 500),
          publishedBy ? String(publishedBy) : null
        ]
      );

      await tx.query(
        `UPDATE workflow_definitions
         SET status = 'published',
             version = $1,
             published_version_id = $2,
             updated_at = now()
         WHERE agency_id = $3 AND location_id = $4 AND id = $5`,
        [nextVersionNumber, versionId, tx.agencyId, tx.locationId, workflowId]
      );

      return {
        version: normalizeVersionRow(insertVer.rows[0]),
        warnings: validation.warnings
      };
    },

    async listWorkflowVersions(tx, workflowId) {
      const res = await tx.query(
        `SELECT * FROM workflow_versions
         WHERE agency_id = $1 AND location_id = $2 AND workflow_id = $3
         ORDER BY version_number DESC`,
        [tx.agencyId, tx.locationId, workflowId]
      );
      return res.rows.map(normalizeVersionRow);
    },

    async rollbackWorkflowVersion(tx, { workflowId, targetVersionNumber, actorId = null }) {
      const targetRes = await tx.query(
        `SELECT * FROM workflow_versions
         WHERE agency_id = $1 AND location_id = $2 AND workflow_id = $3 AND version_number = $4`,
        [tx.agencyId, tx.locationId, workflowId, Number(targetVersionNumber)]
      );
      if (targetRes.rows.length === 0) {
        throw Object.assign(new Error('Target version not found'), { code: 'VERSION_NOT_FOUND', status: 404 });
      }
      const target = targetRes.rows[0];

      await tx.query(
        `UPDATE workflow_definitions
         SET trigger_type = $1,
             trigger_config = $2::jsonb,
             nodes = $3::jsonb,
             graph_json = $4::jsonb,
             governance_policy = $5::jsonb,
             draft_updated_at = now(),
             updated_at = now()
         WHERE agency_id = $6 AND location_id = $7 AND id = $8`,
        [
          target.trigger_type,
          JSON.stringify(parseJson(target.trigger_config, {})),
          JSON.stringify(parseJson(target.nodes, [])),
          JSON.stringify(parseJson(target.graph_json, { nodes: [], edges: [] })),
          JSON.stringify(parseJson(target.governance_policy, {})),
          tx.agencyId,
          tx.locationId,
          workflowId
        ]
      );

      return this.publishWorkflowVersion(tx, {
        workflowId,
        publishedBy: actorId,
        changeSummary: `Rollback to version ${targetVersionNumber}`
      });
    },

    async createSchedule(tx, {
      workflowId,
      scheduleType = 'interval',
      timezone = 'UTC',
      cronExpression = null,
      intervalEvery = 1,
      intervalUnit = 'hours',
      runAt = null,
      catchupPolicy = 'skip'
    }) {
      if (!isValidIanaTimezone(timezone)) {
        throw Object.assign(new TypeError(`Invalid timezone: ${timezone}`), { code: 'INVALID_TIMEZONE', status: 400 });
      }
      const nextRunAt = computeNextRunAtUtc({
        scheduleType,
        timezone,
        cronExpression,
        intervalEvery,
        intervalUnit,
        runAt
      });
      const id = randomUUID();
      const res = await tx.query(
        `INSERT INTO workflow_schedules (
          id, agency_id, location_id, workflow_id, schedule_type, timezone,
          cron_expression, interval_every, interval_unit, run_at, next_run_at,
          catchup_policy, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
        RETURNING *`,
        [
          id,
          tx.agencyId,
          tx.locationId,
          workflowId,
          scheduleType,
          timezone,
          cronExpression,
          scheduleType === 'interval' ? Number(intervalEvery) : null,
          scheduleType === 'interval' ? intervalUnit : null,
          runAt ? new Date(runAt) : null,
          nextRunAt ? new Date(nextRunAt) : null,
          catchupPolicy
        ]
      );
      return normalizeScheduleRow(res.rows[0]);
    },

    async listSchedules(tx, workflowId) {
      const res = await tx.query(
        `SELECT * FROM workflow_schedules
         WHERE agency_id = $1 AND location_id = $2 AND workflow_id = $3
         ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId, workflowId]
      );
      return res.rows.map(normalizeScheduleRow);
    },

    async updateScheduleStatus(tx, scheduleId, status) {
      if (!['active', 'paused', 'completed'].includes(status)) {
        throw Object.assign(new TypeError('Invalid schedule status'), { code: 'INVALID_STATUS', status: 400 });
      }
      const res = await tx.query(
        `UPDATE workflow_schedules
         SET status = $1, updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND id = $4
         RETURNING *`,
        [status, tx.agencyId, tx.locationId, scheduleId]
      );
      return res.rows[0] ? normalizeScheduleRow(res.rows[0]) : null;
    },

    async appendExecutionLog(tx, {
      executionId,
      nodeId = null,
      level = 'info',
      eventType,
      message,
      metadata = {},
      correlationId = null
    }) {
      const redacted = redactSensitivePayload(metadata || {});
      const res = await tx.query(
        `INSERT INTO workflow_execution_logs (
          id, agency_id, location_id, execution_id, node_id, level,
          event_type, message, metadata_json, correlation_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
        RETURNING *`,
        [
          randomUUID(),
          tx.agencyId,
          tx.locationId,
          executionId,
          nodeId,
          level,
          String(eventType || 'step_event'),
          String(message || '').slice(0, 1000),
          JSON.stringify(redacted),
          correlationId
        ]
      );
      return res.rows[0];
    },

    async listExecutionLogs(tx, executionId) {
      const res = await tx.query(
        `SELECT id, execution_id, node_id, level, event_type, message, metadata_json, correlation_id, created_at
         FROM workflow_execution_logs
         WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
         ORDER BY created_at ASC`,
        [tx.agencyId, tx.locationId, executionId]
      );
      return res.rows.map(r => ({
        id: r.id,
        executionId: r.execution_id,
        nodeId: r.node_id,
        level: r.level,
        eventType: r.event_type,
        message: r.message,
        metadata: redactSensitivePayload(parseJson(r.metadata_json, {})),
        correlationId: r.correlation_id,
        createdAt: r.created_at?.toISOString?.() || r.created_at
      }));
    },

    async getWorkflowObservabilityMetrics(tx) {
      const execStats = await tx.query(
        `SELECT
           COUNT(*)::int AS total_executions,
           COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
           COUNT(*) FILTER (WHERE status = 'dead_letter')::int AS dead_letter_count,
           COUNT(*) FILTER (WHERE status IN ('pending', 'enqueued', 'running', 'resuming'))::int AS active_count,
           COUNT(*) FILTER (WHERE status IN ('waiting', 'waiting_approval', 'waiting_webhook'))::int AS waiting_count,
           COALESCE(SUM(attempts), 0)::int AS total_attempts,
           COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - created_at)) * 1000) FILTER (WHERE finished_at IS NOT NULL), 0)::float8 AS avg_duration_ms
         FROM workflow_executions
         WHERE agency_id = $1 AND location_id = $2`,
        [tx.agencyId, tx.locationId]
      );
      const approvalStats = await tx.query(
        `SELECT COUNT(*)::int AS pending_approvals
         FROM workflow_approvals
         WHERE agency_id = $1 AND location_id = $2 AND status = 'pending'`,
        [tx.agencyId, tx.locationId]
      );
      const s = execStats.rows[0] || {};
      const total = s.total_executions || 0;
      return {
        totalExecutions: total,
        completedCount: s.completed_count || 0,
        failedCount: s.failed_count || 0,
        deadLetterCount: s.dead_letter_count || 0,
        activeCount: s.active_count || 0,
        waitingCount: s.waiting_count || 0,
        totalAttempts: s.total_attempts || 0,
        avgDurationMs: Math.round(s.avg_duration_ms || 0),
        successRate: total > 0 ? Number(((s.completed_count || 0) / total).toFixed(4)) : 1,
        pendingApprovals: approvalStats.rows[0]?.pending_approvals || 0
      };
    }
  };
}
