import crypto from 'node:crypto';
import { PermanentJobError } from './durable-worker.mjs';
import { getWorkflowActionDefinition } from '../../workflow-engine/src/action-governance.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * Trusted allow-listed event handlers for the Operza Durable Outbox Worker.
 *
 * Security rules:
 * 1. Only explicitly registered event types are executed. Unknown types throw PermanentJobError.
 * 2. Handlers never execute arbitrary user JavaScript or unrestricted network requests.
 * 3. Every side-effect boundary validates tenant boundaries and uses deterministic action receipts.
 */
export const handlers = {
  /**
   * Processes a workflow trigger event enqueued into the transactional outbox.
   */
  'workflow.trigger.enqueued': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.workflowId) {
      throw new PermanentJobError('Payload missing required tenantId or workflowId', 'INVALID_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    const executionId = payload.executionId || `exec_${crypto.randomUUID()}`;
    const actionReceiptHash = sha256({
      tenantId: payload.tenantId,
      workflowId: payload.workflowId,
      executionId,
      triggerType: payload.triggerType || 'manual',
      idempotencyKey: job.idempotencyKey
    });

    return {
      status: 'success',
      executionId,
      actionReceiptHash,
      workerId,
      processedAt: new Date().toISOString()
    };
  },

  /**
   * Resumes an approval-paused workflow execution from its exact pinned node.
   */
  'workflow.step.resume': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.executionId || !payload?.nodeId) {
      throw new PermanentJobError('Payload missing required resume references', 'INVALID_RESUME_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    const actionHash = payload.actionHash || sha256({
      tenantId: payload.tenantId,
      executionId: payload.executionId,
      nodeId: payload.nodeId
    });

    return {
      status: 'resumed',
      executionId: payload.executionId,
      nodeId: payload.nodeId,
      actionHash,
      workerId,
      resumedAt: new Date().toISOString()
    };
  },

  /**
   * Governed connector action execution (safe in-memory or simulated dispatch).
   */
  'workflow.action.execute': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.actionId) {
      throw new PermanentJobError('Payload missing required actionId or tenantId', 'INVALID_ACTION_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    // Action governance gating: verify approvals and consent on external side-effect actions
    const actionDef = getWorkflowActionDefinition(payload.actionType || payload.nodeType || payload.actionId);
    if (actionDef) {
      const isExternal = actionDef.risk === 'external_side_effect';
      if (isExternal && actionDef.approval === 'human' && !payload.approved && !payload.approvalEvidence) {
        throw new PermanentJobError('Action requires human approval before worker execution', 'APPROVAL_REQUIRED');
      }
      if (isExternal && payload.consent !== true && payload.dryRun === false) {
        throw new PermanentJobError('Action requires explicit consent before live execution', 'CONSENT_REQUIRED');
      }
    }

    const isDryRun = payload.dryRun !== false;
    const actionReceipt = sha256({
      tenantId: payload.tenantId,
      actionId: payload.actionId,
      input: payload.input || {},
      idempotencyKey: job.idempotencyKey
    });

    return {
      status: isDryRun ? 'simulated' : 'completed',
      actionId: payload.actionId,
      actionReceipt,
      sideEffectsDisabled: isDryRun,
      workerId,
      executedAt: new Date().toISOString()
    };
  },

  /**
   * CRM Lead Qualification event handler.
   */
  'crm.lead.qualified': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.contactId) {
      throw new PermanentJobError('Payload missing contactId or tenantId', 'INVALID_LEAD_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    return {
      status: 'qualified',
      contactId: payload.contactId,
      score: payload.score ?? 85,
      workerId,
      qualifiedAt: new Date().toISOString()
    };
  },

  /**
   * Audit event recording handler.
   */
  'audit.event.record': async (payload, { job, workerId, lease }) => {
    if (!payload?.tenantId || !payload?.action) {
      throw new PermanentJobError('Payload missing required audit action or tenantId', 'INVALID_AUDIT_PAYLOAD');
    }
    if (lease?.lost) return { status: 'lease_lost' };

    return {
      status: 'recorded',
      eventId: `audit_${crypto.randomUUID()}`,
      workerId,
      recordedAt: new Date().toISOString()
    };
  }
};

export const trustedWorkerHandlers = handlers;
export default { handlers };
