/**
 * ============================================================================
 * Operza Workflows Domain Router — TenantTx & WorkflowsRepository Boundary
 * ============================================================================
 * Handles all workflow definition, execution, approval, and lifecycle endpoints:
 * 1. CRM Workflows CRUD: /api/crm/workflows, /api/crm/workflows/:id, /api/workflows, /api/workflows/:id
 * 2. Workflow Executions: /api/workflows/runs, /api/workflows/runs/:runId/nodes, /api/workflows/:id/run
 * 3. Step Testing: /api/workflows/:id/nodes/:nodeId/test
 * 4. Execution Tick & Lease Advancement: /api/workflows/runs/:id/tick
 * 5. Approvals: /api/workflows/approvals, /api/workflows/runs/:id/approve, /api/workflows/runs/:id/reject
 *
 * For database-backed environments (pgPool present), PostgreSQL Row Level
 * Security via TenantTx is the sole authoritative persistence mechanism.
 * In-memory persistence is strictly isolated as a fallback for zero-config
 * local development and offline testing (!pgPool).
 */

import crypto, { randomUUID } from 'node:crypto';
import { createWorkflowsRepository } from '../../../packages/db/lib/workflows-repository.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createActionInvocation, getWorkflowActionDefinition } from '../../../packages/workflow-engine/src/action-governance.mjs';
import { createPendingApproval, resolvePendingApproval } from '../../../packages/workflow-engine/src/approval-lifecycle.mjs';
import { produceWorkflowResumeEvent } from '../../../packages/platform-core/src/outbox-producer.mjs';

const workflowsRepo = createWorkflowsRepository();

/**
 * Checks whether an actor API key possesses the required scope.
 *
 * @param {any} actor
 * @param {string} requiredScope
 * @param {string[]} [alternativeScopes]
 * @returns {boolean}
 */
function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function safeSha256(data) {
  return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
}

function safeWorkflowStepResult(result) {
  if (!result || typeof result !== 'object') return result ?? null;
  const output = {};
  for (const [key, val] of Object.entries(result)) {
    if (typeof val === 'string' && val.length > 500) {
      output[key] = val.slice(0, 497) + '...';
    } else {
      output[key] = val;
    }
  }
  return Object.keys(output).length ? output : null;
}

export function publicWorkflowExecution(execution) {
  if (!execution) return null;
  const sourceContact = execution.triggerContext?.contact;
  const contact = sourceContact ? {
    id: sourceContact.id,
    firstName: sourceContact.firstName || '',
    lastName: sourceContact.lastName || ''
  } : null;
  const pendingApproval = execution.pendingApproval ? {
    id: execution.pendingApproval.id,
    nodeId: execution.pendingApproval.nodeId,
    actionId: execution.pendingApproval.actionId,
    nodeType: execution.pendingApproval.nodeType,
    nodeLabel: execution.pendingApproval.nodeLabel,
    requestedAt: execution.pendingApproval.requestedAt,
    expiresAt: execution.pendingApproval.expiresAt
  } : null;

  return {
    id: execution.id,
    workflowId: execution.workflowId,
    workflowName: execution.workflowName,
    workflowVersion: execution.workflowVersion || 1,
    mode: execution.mode,
    status: execution.status,
    retryAt: execution.retryAt || null,
    resumeToken: execution.resumeToken || null,
    resumeUrl: execution.resumeUrl || null,
    triggerType: execution.triggerType,
    contactId: contact?.id || execution.contactId || null,
    triggerContext: {
      contact,
      manualTrigger: execution.triggerContext?.manualTrigger === true,
      triggeredBy: execution.triggerContext?.triggeredBy || null,
      scheduledAt: execution.triggerContext?.scheduledAt || null
    },
    createdAt: execution.createdAt,
    finishedAt: execution.finishedAt || null,
    durationMs: execution.durationMs || 0,
    outboxJobId: execution.outboxJobId || null,
    outboxStatus: execution.outboxStatus || 'delivered',
    attemptCount: execution.attemptCount || 1,
    currentNodeIndex: execution.currentNodeIndex || 0,
    pendingApproval,
    pendingApprovalId: pendingApproval?.id || null,
    lastErrorCode: execution.lastErrorCode || null,
    steps: (execution.steps || []).map(step => ({
      nodeId: step.nodeId,
      nodeName: step.nodeName,
      nodeType: step.nodeType,
      status: step.status,
      durationMs: step.durationMs || 0,
      errorCode: step.errorCode || null,
      result: safeWorkflowStepResult(step.result),
      executedAt: step.executedAt || null
    }))
  };
}

export function publicWorkflowApproval(approval) {
  if (!approval) return null;
  return {
    id: approval.id,
    tenantId: approval.tenantId || approval.agencyId,
    locationId: approval.locationId,
    workflowId: approval.workflowId,
    executionId: approval.executionId,
    nodeId: approval.nodeId,
    actionId: approval.actionId,
    nodeType: approval.nodeType,
    nodeLabel: approval.nodeLabel,
    status: approval.status,
    requestedAt: approval.requestedAt || approval.createdAt,
    expiresAt: approval.expiresAt || approval.request?.expiresAt || null,
    decidedAt: approval.decidedAt || null,
    decidedByActorId: approval.decidedBy || approval.decidedByActorId || null
  };
}

/**
 * Handles all workflow-related HTTP requests.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {any} ctx
 * @returns {Promise<boolean>} - true if request was handled, false if unhandled
 */
export async function handleWorkflowsRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    actor,
    agency,
    activeLocation,
    pgPool,
    triggerWorkflowExecution,
    executeWorkflowInstance,
    executeStep,
    checkTenantUsageLimit,
    recordTenantUsage,
    expirePendingWorkflowApprovals,
    isStagingOrProd,
    platformDbEnabled
  } = ctx;

  const isWorkflowRoute =
    pathname.startsWith('/api/crm/workflows') ||
    pathname.startsWith('/api/workflows');

  if (!isWorkflowRoute) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  const tenantCtx = (agency && activeLocation) ? {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.user?.id || actor?.keyId || 'system'
  } : null;

  function requireTenantContext() {
    if (!tenantCtx || !tenantCtx.agencyId || !tenantCtx.locationId) {
      sendJson(res, 400, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
      return false;
    }
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 1. WORKFLOW RUNS & NODES TIMELINE
  // ═════════════════════════════════════════════════════════════════════════

  // GET /api/workflows/runs — list execution runs
  if (method === 'GET' && pathname === '/api/workflows/runs') {
    if (!requireTenantContext()) return true;
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (expirePendingWorkflowApprovals) {
      await expirePendingWorkflowApprovals(agency.id, activeLocation.id).catch(() => {});
    }

    if (pgPool) {
      try {
        const runs = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return workflowsRepo.listExecutions(tx);
        });
        sendJson(res, 200, runs.map(publicWorkflowExecution));
      } catch (err) {
        console.error('[WORKFLOW-RUNS] Error listing executions:', err.message);
        if (isStagingOrProd || platformDbEnabled) {
          sendJson(res, 500, { error: 'Failed to retrieve workflow executions: ' + err.message, code: 'DATABASE_WORKFLOW_RUNS_FAILED' });
        } else {
          sendJson(res, 500, { error: err.message });
        }
      }
      return true;
    }

    const runs = (state.workflowExecutions || []).filter(
      w => w.agencyId === agency.id && w.locationId === activeLocation.id
    );
    sendJson(res, 200, runs.slice().reverse().map(publicWorkflowExecution));
    return true;
  }

  // GET /api/workflows/runs/:runId/nodes — inspect steps and execution timeline
  if (method === 'GET' && pathname.startsWith('/api/workflows/runs/') && pathname.endsWith('/nodes')) {
    if (!requireTenantContext()) return true;
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const runId = pathname.replace('/api/workflows/runs/', '').replace('/nodes', '').trim();

    if (pgPool) {
      try {
        const details = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          const run = await workflowsRepo.getExecutionById(tx, runId);
          if (!run) return null;
          const steps = await workflowsRepo.listExecutionSteps(tx, runId);
          return { run, steps };
        });

        if (!details) {
          sendJson(res, 404, { error: 'Workflow execution not found' });
          return true;
        }

        sendJson(res, 200, {
          executionId: details.run.id,
          workflowId: details.run.workflowId,
          status: details.run.status,
          retryAt: details.run.retryAt,
          resumeNodeId: details.run.resumeNodeId,
          waitGeneration: details.run.waitGeneration,
          waitType: details.run.waitType,
          steps: details.steps.map(s => ({
            nodeId: s.nodeId,
            status: s.status,
            details: s.details,
            errorCode: s.errorCode,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt
          })),
          createdAt: details.run.createdAt,
          finishedAt: details.run.finishedAt
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to inspect execution steps: ' + err.message });
      }
      return true;
    }

    const run = (state.workflowExecutions || []).find(
      w => w.id === runId && w.agencyId === agency.id && w.locationId === activeLocation.id
    );
    if (!run) {
      sendJson(res, 404, { error: 'Workflow execution not found' });
      return true;
    }
    sendJson(res, 200, {
      executionId: run.id,
      workflowId: run.workflowId,
      workflowName: run.workflowName,
      status: run.status,
      mode: run.mode,
      outboxJobId: run.outboxJobId || null,
      outboxStatus: run.outboxStatus || 'delivered',
      attemptCount: run.attemptCount || 1,
      steps: run.steps || [],
      durationMs: run.durationMs || 0,
      createdAt: run.createdAt
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. APPROVAL GATES
  // ═════════════════════════════════════════════════════════════════════════

  // GET /api/workflows/approvals — list pending approvals
  if (method === 'GET' && pathname === '/api/workflows/approvals') {
    if (!requireTenantContext()) return true;
    if (!checkScope(actor, 'workflows:read')) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (expirePendingWorkflowApprovals) {
      await expirePendingWorkflowApprovals(agency.id, activeLocation.id).catch(() => {});
    }

    if (pgPool) {
      try {
        const approvals = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return workflowsRepo.listPendingApprovals(tx);
        });
        sendJson(res, 200, approvals.map(publicWorkflowApproval));
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve workflow approvals: ' + err.message });
      }
      return true;
    }

    state.workflowApprovals = state.workflowApprovals || [];
    const approvals = state.workflowApprovals.filter(
      item => item.agencyId === agency.id && item.locationId === activeLocation.id && item.status === 'pending'
    );
    sendJson(res, 200, approvals.map(publicWorkflowApproval));
    return true;
  }

  // POST /api/workflows/runs/:id/approve or /reject
  if (method === 'POST' && pathname.startsWith('/api/workflows/runs/') && (pathname.endsWith('/approve') || pathname.endsWith('/reject'))) {
    if (!requireTenantContext()) return true;
    if (!checkScope(actor, 'workflows:write')) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const runId = pathname.split('/')[4];
    const pathDecision = pathname.endsWith('/reject') ? 'rejected' : 'approved';
    const body = await readBody(req);
    if (body.decision && body.decision !== pathDecision) {
      sendJson(res, 400, { error: 'Decision does not match the requested approval route' });
      return true;
    }

    if (pgPool) {
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          const execRes = await tx.query(`
            SELECT id, agency_id, location_id, workflow_id, status, current_node_id, state, trigger_event
            FROM workflow_executions
            WHERE agency_id = $1 AND location_id = $2 AND id = $3
            FOR UPDATE
          `, [agency.id, activeLocation.id, runId]);

          if (execRes.rows.length === 0) {
            return { notFound: true, error: 'Workflow execution not found' };
          }
          const dbRun = execRes.rows[0];
          if (dbRun.status !== 'waiting_approval') {
            return { conflict: true, error: 'Workflow execution is not awaiting an approval', code: 'EXECUTION_NOT_WAITING' };
          }

          const appRes = await tx.query(`
            SELECT id, agency_id, location_id, execution_id, workflow_id, node_id, action_id, action_hash, status, requested_at, expires_at
            FROM workflow_approvals
            WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3 AND status = 'pending'
            ORDER BY requested_at DESC
            LIMIT 1
            FOR UPDATE
          `, [agency.id, activeLocation.id, runId]);

          if (appRes.rows.length === 0) {
            return { notFound: true, error: 'Pending approval not found' };
          }
          const dbApproval = appRes.rows[0];

          if (new Date(dbApproval.expires_at).getTime() <= Date.now()) {
            await tx.query(`
              UPDATE workflow_approvals
              SET status = 'expired', updated_at = now()
              WHERE agency_id = $1 AND location_id = $2 AND id = $3
            `, [agency.id, activeLocation.id, dbApproval.id]);
            return { expired: true, error: 'Approval request has expired', code: 'APPROVAL_EXPIRED' };
          }

          const actionHash = dbApproval.action_hash;
          const decisionChecksum = safeSha256({
            agencyId: agency.id,
            locationId: activeLocation.id,
            executionId: runId,
            nodeId: dbApproval.node_id,
            actionHash,
            decision: pathDecision,
            decidedBy: actor.user?.id || 'system',
            decidedAt: new Date().toISOString()
          });

          const updateAppRes = await tx.query(`
            UPDATE workflow_approvals
            SET status = $1, decided_at = now(), decided_by = $2,
                decision_checksum = $3, updated_at = now()
            WHERE agency_id = $4 AND location_id = $5 AND id = $6 AND status = 'pending'
            RETURNING *
          `, [
            pathDecision, actor.user?.id || null, decisionChecksum,
            agency.id, activeLocation.id, dbApproval.id
          ]);

          if (updateAppRes.rowCount === 0) {
            return { conflict: true, error: 'Approval was already decided or expired', code: 'APPROVAL_ALREADY_DECIDED' };
          }

          if (pathDecision === 'rejected') {
            await tx.query(`
              UPDATE workflow_executions
              SET status = 'failed', last_error_code = 'APPROVAL_REJECTED', finished_at = now(), updated_at = now()
              WHERE agency_id = $1 AND location_id = $2 AND id = $3
            `, [agency.id, activeLocation.id, runId]);

            await tx.query(`
              INSERT INTO workflow_execution_steps (
                id, agency_id, location_id, execution_id, node_id, attempt, status, error_code, started_at, finished_at
              ) VALUES ($1, $2, $3, $4, $5, 1, 'failed', 'APPROVAL_REJECTED', now(), now())
            `, [randomUUID(), agency.id, activeLocation.id, runId, dbApproval.node_id]);

            return {
              success: true,
              approval: {
                id: dbApproval.id,
                status: 'rejected',
                decidedAt: new Date().toISOString(),
                decidedByActorId: actor.user?.id || null
              },
              run: {
                id: runId,
                status: 'failed',
                lastErrorCode: 'APPROVAL_REJECTED'
              }
            };
          }

          // pathDecision === 'approved'
          await tx.query(`
            UPDATE workflow_executions
            SET status = 'resuming', updated_at = now()
            WHERE agency_id = $1 AND location_id = $2 AND id = $3
          `, [agency.id, activeLocation.id, runId]);

          const resumePayload = {
            tenantId: agency.id,
            locationId: activeLocation.id,
            workflowId: dbRun.workflow_id,
            executionId: runId,
            nodeId: dbApproval.node_id,
            actionHash,
            approvedBy: actor.user?.id || 'system',
            evidence: {
              approverActorId: actor.user?.id || 'system',
              approvedAt: new Date().toISOString(),
              actionHash
            }
          };
          const idempotencyKey = safeSha256({
            type: 'workflow.step.resume',
            tenantId: agency.id,
            executionId: runId,
            nodeId: dbApproval.node_id,
            actionHash
          });

          await tx.query(`
            INSERT INTO workflow_outbox (
              id, agency_id, location_id, event_type, payload, idempotency_key, status, max_attempts, created_at, updated_at
            ) VALUES ($1, $2, $3, 'workflow.step.resume', $4::jsonb, $5, 'pending', 5, now(), now())
            ON CONFLICT (agency_id, location_id, idempotency_key) DO NOTHING
          `, [randomUUID(), agency.id, activeLocation.id, JSON.stringify(resumePayload), idempotencyKey]);

          return {
            success: true,
            approval: {
              id: dbApproval.id,
              status: 'approved',
              decidedAt: new Date().toISOString(),
              decidedByActorId: actor.user?.id || null
            },
            run: {
              id: runId,
              status: 'resuming'
            }
          };
        });

        if (result.notFound) {
          sendJson(res, 404, { error: result.error });
          return true;
        }
        if (result.conflict) {
          sendJson(res, 409, { error: result.error, code: result.code });
          return true;
        }
        if (result.expired) {
          sendJson(res, 409, { error: result.error, code: result.code });
          return true;
        }

        auditLog('workflow.approval.decided', actor, {
          approvalId: result.approval.id,
          executionId: runId,
          decision: pathDecision
        });

        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to process approval decision: ' + err.message });
      }
      return true;
    }

    // In-memory fallback
    if (isStagingOrProd || platformDbEnabled) {
      sendJson(res, 500, { error: 'PostgreSQL database connection required for workflow approval' });
      return true;
    }

    const run = (state.workflowExecutions || []).find(
      item => item.id === runId && item.agencyId === agency.id && item.locationId === activeLocation.id
    );
    if (!run) {
      sendJson(res, 404, { error: 'Workflow execution not found' });
      return true;
    }
    if (run.status !== 'waiting_approval' || !run.pendingApprovalId) {
      sendJson(res, 409, { error: 'Workflow execution is not awaiting an approval', code: 'EXECUTION_NOT_WAITING' });
      return true;
    }

    state.workflowApprovals = state.workflowApprovals || [];
    const approvalId = body.approvalId || run.pendingApprovalId;
    const approval = state.workflowApprovals.find(
      item => item.id === approvalId &&
        item.agencyId === agency.id &&
        item.locationId === activeLocation.id &&
        item.executionId === run.id
    );
    if (!approval) {
      sendJson(res, 404, { error: 'Pending approval not found' });
      return true;
    }

    const pinnedFlow = run.workflowSnapshot;
    const pausedNode = pinnedFlow?.nodes?.[run.currentNodeIndex];
    if (!pausedNode || pausedNode.id !== approval.nodeId) {
      sendJson(res, 409, { error: 'Paused workflow node no longer matches the approval request', code: 'ACTION_MISMATCH' });
      return true;
    }
    const definition = getWorkflowActionDefinition(pausedNode.type);
    if (!definition) {
      sendJson(res, 409, { error: 'The approved workflow action is no longer registered', code: 'ACTION_NOT_REGISTERED' });
      return true;
    }

    let currentInvocation;
    try {
      currentInvocation = createActionInvocation({
        tenantId: agency.id,
        workflowId: run.workflowId,
        executionId: run.id,
        actorId: run.actorId,
        node: pausedNode,
        input: pausedNode.config || {},
        mode: 'live',
        providerStatus: run.providerStatuses?.[definition.providerKey] || 'unconfigured',
        consent: run.consent === true
      });
    } catch (error) {
      sendJson(res, 409, { error: 'Pinned workflow action could not be verified', code: error.code || 'ACTION_MISMATCH' });
      return true;
    }
    if (currentInvocation.actionHash !== approval.actionHash) {
      sendJson(res, 409, { error: 'Pinned workflow action has changed since approval was requested', code: 'ACTION_MISMATCH' });
      return true;
    }

    const transition = resolvePendingApproval({
      approval,
      execution: run,
      tenantId: agency.id,
      locationId: activeLocation.id,
      approverActorId: actor.user?.id || 'system',
      decision: pathDecision
    });
    if (!transition.ok) {
      const status = transition.code === 'TENANT_MISMATCH' || transition.code === 'LOCATION_MISMATCH' ? 403 : 409;
      sendJson(res, status, { error: transition.message, code: transition.code });
      return true;
    }

    approval.status = transition.approvalStatus;
    approval.decision = transition.evidence;
    approval.decidedAt = transition.decidedAt;
    approval.decidedByActorId = transition.decidedByActorId;
    auditLog('workflow.approval.decided', actor, {
      approvalId: approval.id,
      executionId: run.id,
      workflowId: run.workflowId,
      nodeId: approval.nodeId,
      decision: transition.approvalStatus,
      actionHash: approval.actionHash
    });

    if (transition.approvalStatus === 'rejected') {
      run.status = 'failed';
      run.lastErrorCode = 'APPROVAL_REJECTED';
      run.finishedAt = new Date().toISOString();
      run.pendingApprovalId = null;
      run.pendingApproval = null;
      const pausedStep = [...(run.steps || [])].reverse().find(step => step.nodeId === approval.nodeId);
      if (pausedStep) {
        pausedStep.status = 'failed';
        pausedStep.errorCode = 'APPROVAL_REJECTED';
      }
      await saveState();
      broadcast('workflow.execution.approval_rejected', { executionId: run.id, approvalId: approval.id });
      sendJson(res, 200, {
        success: true,
        approval: publicWorkflowApproval(approval),
        run: publicWorkflowExecution(run)
      });
      return true;
    }

    run.status = 'resuming';
    run.approvedNodeId = approval.nodeId;
    run.approvalEvidence = transition.evidence;
    run.approvedBy = actor.user?.id || 'system';
    run.consent = true;
    run.providerStatuses = run.providerStatuses || {};
    const isZapierActive = (Array.isArray(state.zapierHookSubscriptions) && state.zapierHookSubscriptions.some(s => s.status === 'active' && (!run.agencyId || s.agencyId === run.agencyId))) ||
      Boolean(state.records?.integrations?.some?.(i => i.id === 'zapier' && (i.status === 'connected' || i.connected === true)));
    if (isZapierActive) {
      run.providerStatuses.zapier = 'verified';
    }
    run.pendingApprovalId = null;
    run.pendingApproval = null;
    await saveState();
    broadcast('workflow.execution.resuming', { executionId: run.id, approvalId: approval.id });

    try {
      if (ctx.getOutboxRepo) {
        await produceWorkflowResumeEvent({
          repository: ctx.getOutboxRepo(),
          tenantId: run.agencyId,
          locationId: run.locationId,
          workflowId: run.workflowId,
          executionId: run.id,
          nodeId: approval.nodeId,
          actionHash: approval.actionHash,
          approvedBy: actor.user?.id || 'system'
        });
      }
    } catch (err) {
      if (isStagingOrProd || platformDbEnabled) {
        throw Object.assign(new Error(`Failed to enqueue durable workflow resume event: ${err.message}`), {
          code: 'OUTBOX_RESUME_FAILED'
        });
      }
    }

    if (executeWorkflowInstance) {
      const resumed = await executeWorkflowInstance({
        flow: structuredClone(pinnedFlow),
        agencyId: run.agencyId,
        locationId: run.locationId,
        triggerType: run.triggerType,
        triggerContext: run.triggerContext,
        mode: run.mode,
        execution: run
      });
      sendJson(res, 200, {
        success: true,
        approval: publicWorkflowApproval(approval),
        run: publicWorkflowExecution(resumed)
      });
      return true;
    }

    sendJson(res, 200, {
      success: true,
      approval: publicWorkflowApproval(approval),
      run: publicWorkflowExecution(run)
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. EXECUTION TICK & ADVANCEMENT
  // ═════════════════════════════════════════════════════════════════════════

  // POST /api/workflows/runs/:id/tick
  if (method === 'POST' && pathname.startsWith('/api/workflows/runs/') && pathname.endsWith('/tick')) {
    if (!requireTenantContext()) return true;
    const runId = pathname.replace('/api/workflows/runs/', '').replace('/tick', '').trim();

    if (pgPool) {
      try {
        const tickRes = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          const execRes = await tx.query(
            `SELECT id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
                    wait_generation, wait_type, retry_at, resume_lease_owner, resume_lease_until,
                    (clock_timestamp() < resume_lease_until) AS is_lease_active,
                    created_at, updated_at
             FROM workflow_executions
             WHERE agency_id = $1 AND location_id = $2 AND id = $3
             FOR UPDATE`,
            [agency.id, activeLocation.id, runId]
          );

          if (execRes.rows.length === 0) {
            return { notFound: true, error: 'Workflow execution not found' };
          }
          const row = execRes.rows[0];

          if (['completed', 'failed', 'canceled', 'dead_letter'].includes(row.status)) {
            return { conflict: true, error: `Cannot tick terminal execution in status "${row.status}".` };
          }

          if (row.status === 'resuming' && row.is_lease_active) {
            return { conflict: true, error: 'Execution is currently resuming under an active worker lease', status: 'resume_in_progress' };
          }

          if (row.status !== 'waiting' && !(row.status === 'resuming' && !row.is_lease_active)) {
            return { conflict: true, error: `Cannot tick execution in status "${row.status}". Must be "waiting".` };
          }

          const waitGen = Number(row.wait_generation) || 0;
          const waitNode = row.current_node_id || 'wait';
          const resumeNode = row.resume_node_id || null;

          const outboxRes = await tx.query(`
            SELECT id, status, available_at, lease_until, lease_owner, attempts,
                   (available_at <= clock_timestamp()) AS is_due,
                   (lease_until IS NOT NULL AND lease_until > clock_timestamp()) AS is_job_leased
            FROM workflow_outbox
            WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
              AND event_type = 'workflow.wait.resume'
              AND (payload->>'resumeGeneration')::int = $4
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
          `, [agency.id, activeLocation.id, runId, waitGen]);

          let resultStatus = 'resume_enqueued';

          if (outboxRes.rows.length > 0) {
            const existingJob = outboxRes.rows[0];
            if (['pending', 'retryable'].includes(existingJob.status)) {
              if (existingJob.is_due) {
                resultStatus = 'resume_already_requested';
              } else {
                await tx.query(`
                  UPDATE workflow_outbox
                  SET available_at = now(),
                      payload = jsonb_set(
                        jsonb_set(payload, '{requestType}', '"manual"'),
                        '{expeditedAt}',
                        to_jsonb(now()::text)
                      ),
                      updated_at = now()
                  WHERE id = $1
                `, [existingJob.id]);
                resultStatus = 'resume_enqueued';
              }
            } else if (['delivered', 'dead_letter', 'failed'].includes(existingJob.status)) {
              await tx.query(`
                UPDATE workflow_outbox
                SET status = 'pending',
                    available_at = now(),
                    lease_until = NULL,
                    lease_owner = NULL,
                    attempts = 0,
                    last_error_code = NULL,
                    payload = jsonb_set(
                      jsonb_set(payload, '{requestType}', '"manual"'),
                      '{reDrivenAt}',
                      to_jsonb(now()::text)
                    ),
                    updated_at = now()
                WHERE id = $1
              `, [existingJob.id]);
              resultStatus = 'resume_enqueued';
            } else {
              resultStatus = 'resume_already_requested';
            }
          } else {
            const idemKey = `idem_${crypto.createHash('sha256').update(JSON.stringify([
              agency.id,
              activeLocation.id,
              'workflow_wait_resume',
              `${runId}_${waitNode}_gen_${waitGen}`
            ])).digest('hex')}`;

            const outboxPayload = {
              tenantId: agency.id,
              locationId: activeLocation.id,
              workflowId: row.workflow_id,
              executionId: runId,
              waitNodeId: waitNode,
              resumeNodeId: resumeNode,
              resumeGeneration: waitGen,
              requestType: 'manual',
              correlationId: `corr_${randomUUID()}`,
              enqueuedAt: new Date().toISOString()
            };

            await tx.query(`
              INSERT INTO workflow_outbox (
                id, agency_id, location_id, execution_id, event_type, payload,
                idempotency_key, priority, max_attempts, available_at
              ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, now())
              ON CONFLICT (agency_id, location_id, idempotency_key) DO UPDATE
                SET status = 'pending',
                    available_at = now(),
                    lease_until = NULL,
                    lease_owner = NULL,
                    attempts = 0,
                    last_error_code = NULL,
                    payload = jsonb_set(
                      jsonb_set(workflow_outbox.payload, '{requestType}', '"manual"'),
                      '{reDrivenAt}',
                      to_jsonb(now()::text)
                    ),
                    updated_at = now()
            `, [randomUUID(), agency.id, activeLocation.id, runId, JSON.stringify(outboxPayload), idemKey]);

            resultStatus = 'resume_enqueued';
          }

          return {
            success: true,
            status: resultStatus,
            message: resultStatus === 'resume_already_requested'
              ? 'Execution continuation already requested and pending processing'
              : 'Execution continuation enqueued for worker execution',
            execution: publicWorkflowExecution({
              id: runId,
              agencyId: agency.id,
              locationId: activeLocation.id,
              workflowId: row.workflow_id,
              status: row.status,
              currentNodeId: waitNode,
              resumeNodeId: resumeNode,
              waitGeneration: waitGen,
              createdAt: row.created_at,
              updatedAt: row.updated_at
            })
          };
        });

        if (tickRes.notFound) {
          sendJson(res, 404, { error: tickRes.error });
          return true;
        }
        if (tickRes.conflict) {
          sendJson(res, 409, { error: tickRes.error, status: tickRes.status });
          return true;
        }

        sendJson(res, 200, tickRes);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to advance execution: ' + err.message });
      }
      return true;
    }

    // In-memory fallback
    const run = (state.workflowExecutions || []).find(
      w => w.id === runId && w.agencyId === agency.id && w.locationId === activeLocation.id
    );
    if (!run) {
      sendJson(res, 404, { error: 'Workflow execution not found' });
      return true;
    }
    if (run.status !== 'waiting') {
      sendJson(res, 409, { error: `Cannot tick execution in status "${run.status}". Must be "waiting".` });
      return true;
    }

    run.status = 'resuming';
    run.currentNodeIndex = (run.currentNodeIndex || 0) + 1;
    await saveState();

    const flow = run.workflowSnapshot || (state.records.workflows || []).find(w => w.id === run.workflowId);
    if (!flow) {
      sendJson(res, 404, { error: 'Workflow definition snapshot not found' });
      return true;
    }

    let resumedRun = run;
    if (executeWorkflowInstance) {
      resumedRun = await executeWorkflowInstance({
        flow: structuredClone(flow),
        agencyId: run.agencyId,
        locationId: run.locationId,
        triggerType: run.triggerType,
        triggerContext: run.triggerContext,
        existingExecution: run,
        approvalEvidence: run.approvalEvidence || null
      });
    }

    sendJson(res, 200, {
      success: true,
      status: 'resume_enqueued',
      execution: publicWorkflowExecution(resumedRun)
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. WORKFLOW EXECUTION TRIGGER & TESTING
  // ═════════════════════════════════════════════════════════════════════════

  // POST /api/workflows/:id/run — on-demand execution trigger
  if (method === 'POST' && pathname.startsWith('/api/workflows/') && pathname.endsWith('/run')) {
    if (!requireTenantContext()) return true;
    if (!checkScope(actor, 'workflows:trigger', ['workflows:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:trigger'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const workflowId = pathname.replace('/api/workflows/', '').replace('/run', '').trim();
    let flow = null;

    if (pgPool) {
      try {
        flow = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return workflowsRepo.getWorkflowById(tx, workflowId);
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve workflow: ' + err.message });
        return true;
      }
    } else {
      flow = (state.records.workflows || []).find(
        w => w.id === workflowId && w.agencyId === agency.id && w.locationId === activeLocation.id
      );
    }

    if (!flow) {
      sendJson(res, 404, { error: 'Workflow not found' });
      return true;
    }

    if (checkTenantUsageLimit) {
      const runLimit = await checkTenantUsageLimit(agency.id, 'monthlyWorkflowRuns', 1);
      if (!runLimit.allowed) {
        sendJson(res, 429, { error: 'Monthly workflow run allowance has been reached', code: runLimit.code, limit: runLimit.limit, consumed: runLimit.consumed });
        return true;
      }
    }
    if (recordTenantUsage) {
      await recordTenantUsage({
        agencyId: agency.id,
        locationId: activeLocation.id,
        metric: 'monthlyWorkflowRuns',
        source: 'workflow.manual_run'
      });
    }

    const body = await readBody(req);
    let contact = null;
    if (body.contactId) {
      contact = (state.records.contacts || []).find(c => c.id === body.contactId && c.agencyId === agency.id);
    }
    if (!contact && (state.records.contacts || []).length > 0) {
      contact = (state.records.contacts || []).find(c => c.agencyId === agency.id && c.locationId === activeLocation.id) || state.records.contacts[0];
    }

    let execution = null;
    if (executeWorkflowInstance) {
      execution = await executeWorkflowInstance({
        flow,
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'manual',
        mode: body.mode || 'dry_run',
        triggerContext: {
          contact,
          manualTrigger: true,
          triggeredBy: body.triggeredBy || actor?.user?.name || 'user',
          actorId: body.actorId || 'agent_automation_runner',
          payload: body.payload || {},
          ...(body.triggerContext || {})
        }
      });
    } else {
      execution = {
        id: randomUUID(),
        workflowId: flow.id,
        workflowName: flow.name,
        agencyId: agency.id,
        locationId: activeLocation.id,
        status: 'running',
        triggerType: 'manual',
        mode: body.mode || 'dry_run',
        createdAt: new Date().toISOString()
      };
      if (pgPool) {
        await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return workflowsRepo.createExecution(tx, execution);
        });
      } else {
        state.workflowExecutions = state.workflowExecutions || [];
        state.workflowExecutions.push(execution);
      }
    }

    const pubExec = publicWorkflowExecution(execution);
    sendJson(res, 201, { success: true, execution: pubExec, run: pubExec });
    return true;
  }

  // POST /api/workflows/:id/nodes/:nodeId/test — interactive single-node step test
  if (method === 'POST' && pathname.startsWith('/api/workflows/') && pathname.endsWith('/test') && pathname.includes('/nodes/')) {
    if (!requireTenantContext()) return true;
    const parts = pathname.replace('/api/workflows/', '').split('/');
    const workflowId = parts[0];
    const nodeId = parts[2];

    let flow = null;
    if (pgPool) {
      try {
        flow = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return workflowsRepo.getWorkflowById(tx, workflowId);
        });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve workflow: ' + err.message });
        return true;
      }
    } else {
      flow = (state.records.workflows || []).find(
        w => w.id === workflowId && w.agencyId === agency.id && w.locationId === activeLocation.id
      );
    }

    if (!flow) {
      sendJson(res, 404, { error: 'Workflow not found' });
      return true;
    }

    const node = (flow.nodes || []).find(n => n.id === nodeId);
    if (!node) {
      sendJson(res, 404, { error: 'Node not found in workflow' });
      return true;
    }

    const body = await readBody(req);
    const triggerContext = {
      contact: body.contact || { id: 'test-contact-1', firstName: 'Test', lastName: 'Contact', email: 'test@example.com' },
      payload: body.payload || {},
      ...(body.inputData || body.triggerContext || {})
    };

    const testExecution = {
      id: `test-exec-${randomUUID().slice(0, 8)}`,
      agencyId: agency.id,
      locationId: activeLocation.id,
      workflowId: flow.id,
      mode: 'dry_run',
      status: 'running',
      actorId: actor?.user?.id || 'system'
    };

    const stepStart = Date.now();
    let stepRes = { status: 'completed', result: { message: 'Test execution simulated' } };

    if (executeStep) {
      stepRes = await executeStep({
        node,
        execution: testExecution,
        triggerContext,
        crmActions: {
          sendEmail: async () => {},
          sendSms: async () => {},
          sendWhatsApp: async () => {},
          addContactTag: async () => {},
          createTask: async () => {},
          updateOpportunityStage: async () => {},
          updateContact: async () => {},
          createOpportunity: async () => {},
          assignContact: async () => {},
          sendReviewRequest: async () => {},
          updateLeadScore: async ({ points }) => ({ points }),
          sendInternalNotification: async ({ title, message }) => ({ id: `test-notif-${Date.now()}`, title, message })
        },
        aiHandler: async ({ prompt, context }) => {
          const lowerText = ((context && (context.text || context.prompt)) || prompt || '').toLowerCase();
          if (Array.isArray(context?.categories)) {
            const matched = context.categories.find(c => lowerText.includes(c.toLowerCase()));
            if (matched) return { category: matched };
          }
          if (Array.isArray(context?.schema)) {
            const extracted = {};
            for (const key of context.schema) {
              const regex = new RegExp(`${key}[:\\s]+([^,\\n]+)`, 'i');
              const m = lowerText.match(regex);
              if (m) extracted[key] = m[1].trim();
            }
            return extracted;
          }
          return `[Operza AI Test Step]: Analyzed input successfully for ${node.type}.`;
        }
      });
    }

    const durationMs = Date.now() - stepStart;
    sendJson(res, 200, {
      success: stepRes.status !== 'failed',
      nodeId: node.id,
      nodeType: node.type,
      status: stepRes.status,
      durationMs,
      result: stepRes.result || null,
      selectedBranch: stepRes.selectedBranch || null,
      setVariable: stepRes.setVariable || null,
      errorCode: stepRes.errorCode || null,
      error: stepRes.error || null,
      testedAt: new Date().toISOString()
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 5. WORKFLOW DEFINITIONS CRUD
  // ═════════════════════════════════════════════════════════════════════════

  const isDefinitionsPath =
    pathname === '/api/crm/workflows' ||
    pathname === '/api/workflows' ||
    pathname.startsWith('/api/crm/workflows/') ||
    (pathname.startsWith('/api/workflows/') && !pathname.includes('/run') && !pathname.includes('/test') && !pathname.includes('/runs') && !pathname.includes('/approvals') && !pathname.includes('/webhook') && !pathname.includes('/callbacks'));

  if (isDefinitionsPath) {
    if (!requireTenantContext()) return true;

    // GET — List Workflows
    if (method === 'GET' && (pathname === '/api/crm/workflows' || pathname === '/api/workflows')) {
      if (!checkScope(actor, 'workflows:read')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }

      if (pgPool) {
        try {
          const list = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return workflowsRepo.listWorkflows(tx);
          });
          if (pathname.startsWith('/api/crm/workflows')) {
            sendJson(res, 200, { data: list, count: list.length });
          } else {
            sendJson(res, 200, list);
          }
        } catch (err) {
          sendJson(res, 500, { error: 'Failed to retrieve workflows: ' + err.message });
        }
        return true;
      }

      state.records.workflows = state.records.workflows || [];
      const list = state.records.workflows.filter(
        w => w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
      );
      if (pathname.startsWith('/api/crm/workflows')) {
        sendJson(res, 200, { data: list, count: list.length });
      } else {
        sendJson(res, 200, list);
      }
      return true;
    }

    // POST — Create Workflow
    if (method === 'POST' && (pathname === '/api/crm/workflows' || pathname === '/api/workflows')) {
      if (!checkScope(actor, 'workflows:write')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }

      const body = await readBody(req);
      if (!body.name || !body.name.trim()) {
        sendJson(res, 400, { error: 'Workflow name is required', code: 'WORKFLOW_NAME_REQUIRED' });
        return true;
      }

      if (pgPool) {
        try {
          const created = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return workflowsRepo.createWorkflow(tx, body);
          });
          auditLog('crm.workflows.created', actor, { id: created.id });
          broadcast('crm.workflows.created', created);
          sendJson(res, 201, created);
        } catch (err) {
          sendJson(res, 500, { error: 'Failed to create workflow: ' + err.message });
        }
        return true;
      }

      state.records.workflows = state.records.workflows || [];
      const newWf = {
        id: randomUUID(),
        agencyId: agency.id,
        locationId: activeLocation.id,
        name: body.name.trim(),
        status: body.status || 'draft',
        triggerType: body.triggerType || 'manual',
        triggerConfig: body.triggerConfig || {},
        trigger: body.triggerConfig || { kind: body.triggerType || 'manual' },
        nodes: body.nodes || [],
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.records.workflows.push(newWf);
      await saveState();
      auditLog('crm.workflows.created', actor, { id: newWf.id });
      broadcast('crm.workflows.created', newWf);
      sendJson(res, 201, newWf);
      return true;
    }

    const workflowId = pathname.replace('/api/crm/workflows/', '').replace('/api/workflows/', '').trim();

    // GET — Get Single Workflow
    if (method === 'GET') {
      if (!checkScope(actor, 'workflows:read')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }

      if (pgPool) {
        try {
          const wf = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return workflowsRepo.getWorkflowById(tx, workflowId);
          });
          if (!wf) {
            sendJson(res, 404, { error: 'Workflow not found' });
            return true;
          }
          sendJson(res, 200, wf);
        } catch (err) {
          sendJson(res, 500, { error: 'Failed to retrieve workflow: ' + err.message });
        }
        return true;
      }

      state.records.workflows = state.records.workflows || [];
      const wf = state.records.workflows.find(
        w => w.id === workflowId && w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
      );
      if (!wf) {
        sendJson(res, 404, { error: 'Workflow not found' });
        return true;
      }
      sendJson(res, 200, wf);
      return true;
    }

    // PUT — Update Workflow
    if (method === 'PUT' || method === 'PATCH') {
      if (!checkScope(actor, 'workflows:write')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }

      const body = await readBody(req);

      if (pgPool) {
        try {
          const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return workflowsRepo.updateWorkflow(tx, workflowId, body);
          });
          if (!updated) {
            sendJson(res, 404, { error: 'Workflow not found' });
            return true;
          }
          auditLog('crm.workflows.updated', actor, { id: workflowId });
          broadcast('crm.workflows.updated', updated);
          sendJson(res, 200, updated);
        } catch (err) {
          sendJson(res, 500, { error: 'Failed to update workflow: ' + err.message });
        }
        return true;
      }

      state.records.workflows = state.records.workflows || [];
      const idx = state.records.workflows.findIndex(
        w => w.id === workflowId && w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
      );
      if (idx === -1) {
        sendJson(res, 404, { error: 'Workflow not found' });
        return true;
      }
      const existing = state.records.workflows[idx];
      const updated = {
        ...existing,
        ...body,
        id: workflowId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        version: (existing.version || 1) + 1,
        updatedAt: new Date().toISOString()
      };
      state.records.workflows[idx] = updated;
      await saveState();
      auditLog('crm.workflows.updated', actor, { id: workflowId });
      broadcast('crm.workflows.updated', updated);
      sendJson(res, 200, updated);
      return true;
    }

    // DELETE — Delete Workflow
    if (method === 'DELETE') {
      if (!checkScope(actor, 'workflows:write')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'workflows:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }

      if (pgPool) {
        try {
          const deleted = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return workflowsRepo.deleteWorkflow(tx, workflowId);
          });
          if (!deleted) {
            sendJson(res, 404, { error: 'Workflow not found' });
            return true;
          }
          auditLog('crm.workflows.deleted', actor, { id: workflowId });
          broadcast('crm.workflows.deleted', { id: workflowId });
          sendJson(res, 200, { success: true, id: workflowId });
        } catch (err) {
          sendJson(res, 500, { error: 'Failed to delete workflow: ' + err.message });
        }
        return true;
      }

      state.records.workflows = state.records.workflows || [];
      const delIdx = state.records.workflows.findIndex(
        w => w.id === workflowId && w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
      );
      if (delIdx === -1) {
        sendJson(res, 404, { error: 'Workflow not found' });
        return true;
      }
      state.records.workflows.splice(delIdx, 1);
      await saveState();
      auditLog('crm.workflows.deleted', actor, { id: workflowId });
      broadcast('crm.workflows.deleted', { id: workflowId });
      sendJson(res, 200, { success: true, id: workflowId });
      return true;
    }
  }

  return false;
}
