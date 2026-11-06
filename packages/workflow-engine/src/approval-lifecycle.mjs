import { createApprovalRequest, decideApproval } from './action-governance.mjs';

const HASH = /^[a-f0-9]{64}$/;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function invalid(code, message) {
  return { ok: false, code, message };
}

function isReference(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/.test(value);
}

/**
 * Create a durable, tenant-scoped approval record for one exact workflow action.
 * The returned record contains no provider credentials; its request checksum
 * protects the request metadata while actionHash binds the decision to the action.
 */
export function createPendingApproval({
  execution,
  tenantId,
  requestedByActorId,
  nodeId,
  actionHash,
  actionId = null,
  nodeType = null,
  nodeLabel = null,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  if (!execution || execution.status !== 'running') {
    throw Object.assign(new TypeError('Execution must be running before an approval is requested'), { code: 'EXECUTION_NOT_RUNNING' });
  }
  if (!isReference(tenantId) || !isReference(execution.workflowId) || !isReference(execution.id) ||
      !isReference(requestedByActorId) || !isReference(nodeId)) {
    throw Object.assign(new TypeError('Approval references are invalid'), { code: 'INVALID_REFERENCE' });
  }
  if (!HASH.test(actionHash || '')) {
    throw Object.assign(new TypeError('actionHash must be a SHA-256 digest'), { code: 'INVALID_ACTION_HASH' });
  }
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs < 60_000 || ttlMs > MAX_TTL_MS) {
    throw Object.assign(new TypeError('Approval expiry must be between one minute and 24 hours'), { code: 'INVALID_EXPIRY' });
  }
  if (!isReference(execution.locationId)) {
    throw Object.assign(new TypeError('Execution location is invalid'), { code: 'INVALID_REFERENCE' });
  }

  const requestedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlMs).toISOString();
  const request = createApprovalRequest({
    tenantId,
    workflowId: execution.workflowId,
    executionId: execution.id,
    nodeId,
    requestedByActorId,
    actionHash,
    expiresAt
  });

  return Object.freeze({
    id: request.id,
    tenantId,
    agencyId: tenantId,
    locationId: execution.locationId,
    workflowId: execution.workflowId,
    executionId: execution.id,
    nodeId,
    actionHash,
    actionId,
    nodeType,
    nodeLabel,
    requestedByActorId,
    status: 'pending',
    requestedAt,
    decidedAt: null,
    decidedByActorId: null,
    request,
    decision: null
  });
}

/**
 * Resolve a pending request exactly once. A successful approval yields a
 * resuming execution state; it never marks the execution completed.
 */
export function resolvePendingApproval({
  approval,
  execution,
  tenantId,
  locationId,
  approverActorId,
  decision,
  now = Date.now()
} = {}) {
  if (!approval || approval.status !== 'pending') return invalid('APPROVAL_NOT_PENDING', 'Approval is no longer pending.');
  if (!execution || execution.status !== 'waiting_approval') return invalid('EXECUTION_NOT_WAITING', 'Execution is not waiting for approval.');
  if (approval.tenantId !== tenantId || approval.agencyId !== tenantId ||
      execution.agencyId !== tenantId) return invalid('TENANT_MISMATCH', 'Approval belongs to a different tenant.');
  if (approval.locationId !== locationId || execution.locationId !== locationId) {
    return invalid('LOCATION_MISMATCH', 'Approval belongs to a different workspace.');
  }
  if (approval.executionId !== execution.id || approval.workflowId !== execution.workflowId) {
    return invalid('EXECUTION_MISMATCH', 'Approval does not match this workflow execution.');
  }
  if (execution.pendingApprovalId !== approval.id ||
      execution.pendingApproval?.nodeId !== approval.nodeId ||
      execution.pendingApproval?.actionHash !== approval.actionHash) {
    return invalid('ACTION_MISMATCH', 'Approval no longer matches the paused action.');
  }
  if (approval.request?.actionHash !== approval.actionHash ||
      approval.request?.nodeId !== approval.nodeId ||
      approval.request?.executionId !== execution.id ||
      approval.request?.workflowId !== execution.workflowId ||
      approval.request?.tenantId !== tenantId ||
      approval.request?.requestedByActorId !== approval.requestedByActorId) {
    return invalid('REQUEST_MISMATCH', 'Approval request metadata is inconsistent.');
  }

  const evidence = decideApproval({
    request: approval.request,
    tenantId,
    approvedByActorId: approverActorId,
    decision,
    now
  });
  if (evidence.status === 'denied') return invalid(evidence.code, 'Approval decision was rejected by policy.');

  return {
    ok: true,
    evidence,
    approvalStatus: evidence.status,
    executionStatus: evidence.status === 'approved' ? 'resuming' : 'failed',
    resumeKey: evidence.checksum,
    decidedAt: evidence.approvedAt,
    decidedByActorId: evidence.approvedByActorId
  };
}
