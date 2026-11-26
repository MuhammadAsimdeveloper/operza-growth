/**
 * ============================================================================
 * Operza Workflows 2.0 Router — Registry, Validation, Immutable Versioning,
 * Timezone Schedules, Redacted Debugger & Observability Metrics
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createWorkflows2Repository } from '../../../packages/db/lib/workflows-2-repository.mjs';
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
    userId: actor?.id
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

  // 4. Workflow Observability Metrics
  if (method === 'GET' && subPath === '/metrics') {
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: workflows:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const metrics = await runInTenantTx(pgPool, tenantCtx, tx => workflows2Repo.getWorkflowObservabilityMetrics(tx));
      sendJson(res, 200, metrics);
      return true;
    }
    const runs = (state?.records?.workflowRuns || []).filter(r => r.agencyId === agency?.id);
    const completedCount = runs.filter(r => r.status === 'completed').length;
    const failedCount = runs.filter(r => r.status === 'failed').length;
    sendJson(res, 200, {
      totalExecutions: runs.length,
      completedCount,
      failedCount,
      deadLetterCount: runs.filter(r => r.status === 'dead_letter').length,
      activeCount: runs.filter(r => ['pending', 'running', 'enqueued', 'resuming'].includes(r.status)).length,
      waitingCount: runs.filter(r => ['waiting', 'waiting_approval', 'waiting_webhook'].includes(r.status)).length,
      totalAttempts: runs.reduce((acc, r) => acc + (r.attemptCount || 1), 0),
      avgDurationMs: runs.length ? Math.round(runs.reduce((a, r) => a + (r.durationMs || 0), 0) / runs.length) : 0,
      successRate: runs.length ? Number((completedCount / runs.length).toFixed(4)) : 1,
      pendingApprovals: (state?.records?.workflowApprovals || []).filter(a => a.status === 'pending').length
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

  // 7. Workflow-scoped V2 routes: /:id/(draft|publish|versions|rollback|schedules)
  const wfMatch = subPath.match(/^\/([^/]+)\/(draft|publish|versions|rollback|schedules)$/);
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

  return false;
}
