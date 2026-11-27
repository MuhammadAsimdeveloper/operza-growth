/**
 * ============================================================================
 * Operza Workflow Execution Operations & Reliability 2.0
 * ============================================================================
 * Deterministic failure classification, bounded retry policies, side-effect
 * safety evaluation, cooperative cancellation contracts, stuck-execution
 * detection, and redacted observability formatting.
 */

import { getWorkflowActionDefinition } from './action-governance.mjs';
import { redactSensitivePayload } from './graph-validator-v2.mjs';
import { EXECUTION_STATES, isTerminalState } from './execution-state.mjs';

export const FAILURE_CATEGORIES = Object.freeze({
  TRANSIENT_NETWORK: 'transient_network',
  RATE_LIMIT: 'rate_limit',
  PROVIDER_OUTAGE: 'provider_outage',
  LEASE_EXPIRED: 'lease_expired',
  TIMEOUT: 'timeout',
  INVALID_CONFIG: 'invalid_config',
  PERMISSION_DENIED: 'permission_denied',
  VALIDATION_ERROR: 'validation_error',
  APPROVAL_REJECTED: 'approval_rejected',
  UNKNOWN: 'unknown'
});

const RETRYABLE_CATEGORIES = new Set([
  FAILURE_CATEGORIES.TRANSIENT_NETWORK,
  FAILURE_CATEGORIES.RATE_LIMIT,
  FAILURE_CATEGORIES.PROVIDER_OUTAGE,
  FAILURE_CATEGORIES.LEASE_EXPIRED,
  FAILURE_CATEGORIES.TIMEOUT
]);

const PERMANENT_CATEGORIES = new Set([
  FAILURE_CATEGORIES.INVALID_CONFIG,
  FAILURE_CATEGORIES.PERMISSION_DENIED,
  FAILURE_CATEGORIES.VALIDATION_ERROR,
  FAILURE_CATEGORIES.APPROVAL_REJECTED
]);

export function classifyWorkflowFailure({ errorCode = null, errorMessage = '', statusCode = null, retryableHint = null } = {}) {
  const code = String(errorCode || '').toUpperCase();
  const msg = String(errorMessage || '').toLowerCase();
  const httpStatus = Number(statusCode) || null;

  if (code.includes('APPROVAL_REJECTED') || code.includes('APPROVAL_EXPIRED')) {
    return {
      category: FAILURE_CATEGORIES.APPROVAL_REJECTED,
      retryable: false,
      userSummary: 'Execution stopped because the human approval gate was rejected or expired.'
    };
  }
  if (
    httpStatus === 401 || httpStatus === 403 ||
    code.includes('UNAUTHORIZED') || code.includes('FORBIDDEN') ||
    code.includes('INSUFFICIENT_SCOPES') || code.includes('CONSENT_') ||
    code.includes('SSRF_BLOCKED') || code.includes('PERMISSION')
  ) {
    return {
      category: FAILURE_CATEGORIES.PERMISSION_DENIED,
      retryable: false,
      userSummary: 'Execution failed due to missing permissions, revoked consent, or blocked target.'
    };
  }
  if (
    code.includes('INVALID_CONFIG') || code.includes('MISSING_CREDENTIAL') ||
    code.includes('PROVIDER_NOT_CONFIGURED') || code.includes('HANDLER_NOT_REGISTERED') ||
    code.includes('WORKFLOW_VALIDATION_FAILED')
  ) {
    return {
      category: FAILURE_CATEGORIES.INVALID_CONFIG,
      retryable: false,
      userSummary: 'Execution failed due to invalid workflow or provider configuration.'
    };
  }
  if (
    httpStatus === 400 || httpStatus === 422 ||
    code.includes('BAD_REQUEST') || code.includes('INVALID_INPUT') ||
    code.includes('SCHEMA_VALIDATION') || code.includes('VALIDATION')
  ) {
    return {
      category: FAILURE_CATEGORIES.VALIDATION_ERROR,
      retryable: false,
      userSummary: 'Execution failed due to invalid input payload or schema mismatch.'
    };
  }
  if (httpStatus === 429 || code.includes('RATE_LIMIT') || code.includes('TOO_MANY_REQUESTS') || msg.includes('rate limit')) {
    return {
      category: FAILURE_CATEGORIES.RATE_LIMIT,
      retryable: true,
      userSummary: 'Upstream provider rate limit reached; eligible for backoff retry.'
    };
  }
  if (
    httpStatus === 502 || httpStatus === 503 || httpStatus === 504 ||
    code.includes('SERVICE_UNAVAILABLE') || code.includes('BAD_GATEWAY') ||
    code.includes('GATEWAY_TIMEOUT') || code.includes('PROVIDER_TIMEOUT_INDETERMINATE')
  ) {
    return {
      category: FAILURE_CATEGORIES.PROVIDER_OUTAGE,
      retryable: true,
      userSummary: 'Upstream provider is temporarily unavailable.'
    };
  }
  if (
    code.includes('LEASE') || code.includes('WORKER_CANCELLED')
  ) {
    return {
      category: FAILURE_CATEGORIES.LEASE_EXPIRED,
      retryable: true,
      userSummary: 'Worker lease expired or was reclaimed before completion.'
    };
  }
  if (code.includes('TIMEOUT') || msg.includes('timed out')) {
    return {
      category: FAILURE_CATEGORIES.TIMEOUT,
      retryable: true,
      userSummary: 'Execution or step timed out before completion.'
    };
  }
  if (
    code.includes('ETIMEDOUT') || code.includes('ECONNRESET') ||
    code.includes('ECONNREFUSED') || code.includes('ENOTFOUND') ||
    code.includes('EAI_AGAIN') || code.includes('NETWORK') ||
    code.includes('PROVIDER_TRANSPORT_INDETERMINATE') || msg.includes('socket hang up')
  ) {
    return {
      category: FAILURE_CATEGORIES.TRANSIENT_NETWORK,
      retryable: true,
      userSummary: 'Transient network error occurred while communicating with an external service.'
    };
  }

  const retryable = retryableHint === true;
  return {
    category: FAILURE_CATEGORIES.UNKNOWN,
    retryable,
    userSummary: retryable
      ? 'An unexpected recoverable error occurred.'
      : 'An uncategorized error occurred; manual inspection is recommended before retrying.'
  };
}

export function normalizeRetryPolicy(policy = {}) {
  const rawMax = Number(policy?.maxAttempts);
  const rawBase = Number(policy?.baseDelayMs);
  const rawMaxDelay = Number(policy?.maxDelayMs);

  const maxAttempts = Number.isFinite(rawMax) ? Math.min(10, Math.max(1, Math.floor(rawMax))) : 3;
  const baseDelayMs = Number.isFinite(rawBase) ? Math.min(60_000, Math.max(1_000, Math.floor(rawBase))) : 5_000;
  const maxDelayMs = Number.isFinite(rawMaxDelay)
    ? Math.min(3_600_000, Math.max(baseDelayMs, Math.floor(rawMaxDelay)))
    : Math.max(baseDelayMs, 300_000);
  const jitter = policy?.jitter !== false;

  const retryableCategories = Array.isArray(policy?.retryableCategories) && policy.retryableCategories.length > 0
    ? policy.retryableCategories.filter(c => RETRYABLE_CATEGORIES.has(c))
    : Array.from(RETRYABLE_CATEGORIES);

  return { maxAttempts, baseDelayMs, maxDelayMs, jitter, retryableCategories };
}

export function computeRetryBackoffMs({ attempt = 1, policy = {}, randomFn = Math.random } = {}) {
  const norm = normalizeRetryPolicy(policy);
  const exponent = Math.max(0, Number(attempt) - 1);
  const expDelay = Math.min(norm.maxDelayMs, norm.baseDelayMs * (2 ** exponent));
  if (!norm.jitter) return Math.round(expDelay);
  const r = Math.min(1, Math.max(0, Number(randomFn()) || 0));
  return Math.round(expDelay * (0.5 + r * 0.5));
}

export function evaluateRetryEligibility({
  execution,
  steps = [],
  receipts = [],
  confirmSideEffectRetry = false
} = {}) {
  if (!execution) {
    return {
      eligible: false,
      requiresConfirmation: false,
      code: 'EXECUTION_NOT_FOUND',
      reason: 'Execution not found.'
    };
  }

  const status = execution.status;
  if (status === EXECUTION_STATES.COMPLETED || status === 'success') {
    return {
      eligible: false,
      requiresConfirmation: false,
      code: 'ALREADY_COMPLETED',
      reason: 'Completed executions cannot be retried.'
    };
  }
  if (status === EXECUTION_STATES.CANCELED) {
    return {
      eligible: false,
      requiresConfirmation: false,
      code: 'EXECUTION_CANCELED',
      reason: 'Canceled executions cannot be retried automatically; trigger a new run instead.'
    };
  }
  if ([EXECUTION_STATES.RUNNING, EXECUTION_STATES.RESUMING, EXECUTION_STATES.ENQUEUED, EXECUTION_STATES.PENDING].includes(status)) {
    return {
      eligible: false,
      requiresConfirmation: false,
      code: 'EXECUTION_ACTIVE',
      reason: `Execution is currently '${status}' and cannot be retried while active.`
    };
  }

  const classification = execution.failureCategory
    ? {
        category: execution.failureCategory,
        retryable: execution.retryable === true || RETRYABLE_CATEGORIES.has(execution.failureCategory)
      }
    : classifyWorkflowFailure({
        errorCode: execution.lastErrorCode,
        errorMessage: execution.failureMessage || ''
      });

  if (PERMANENT_CATEGORIES.has(classification.category)) {
    return {
      eligible: false,
      requiresConfirmation: false,
      code: 'PERMANENT_FAILURE_NOT_RETRYABLE',
      failureCategory: classification.category,
      reason: `Failure category '${classification.category}' is permanent and must be fixed in workflow configuration or permissions before running again.`
    };
  }

  const externalSideEffectNodes = [];
  const seenNodeIds = new Set();
  const snapshotNodes = Array.isArray(execution.workflowSnapshot?.nodes) ? execution.workflowSnapshot.nodes : [];

  for (const step of steps) {
    const nodeType = step.nodeType || step.kind || snapshotNodes.find(n => n.id === step.nodeId)?.kind || snapshotNodes.find(n => n.id === step.nodeId)?.type;
    const def = nodeType ? getWorkflowActionDefinition(nodeType) : null;
    if (def && def.risk === 'external_side_effect' && !seenNodeIds.has(step.nodeId)) {
      seenNodeIds.add(step.nodeId);
      externalSideEffectNodes.push({
        nodeId: step.nodeId,
        nodeType,
        stepStatus: step.status,
        actionId: def.id
      });
    }
  }

  const indeterminateReceipts = (receipts || []).filter(r => r.status === 'indeterminate');
  const warnings = [];
  if (indeterminateReceipts.length > 0) {
    warnings.push(
      `${indeterminateReceipts.length} action receipt(s) have indeterminate provider outcome; retrying cannot undo a side effect that may already have occurred.`
    );
  }
  if (externalSideEffectNodes.length > 0) {
    warnings.push(
      `Execution includes ${externalSideEffectNodes.length} external side-effect node(s) (${externalSideEffectNodes.map(n => n.nodeType).join(', ')}). Retrying preserves workflow version ${execution.workflowVersion || 1} and requires explicit side-effect confirmation.`
    );
  }

  const requiresConfirmation = externalSideEffectNodes.length > 0 || indeterminateReceipts.length > 0;
  if (requiresConfirmation && !confirmSideEffectRetry) {
    return {
      eligible: true,
      requiresConfirmation: true,
      code: 'SIDE_EFFECT_CONFIRMATION_REQUIRED',
      failureCategory: classification.category,
      hasExternalSideEffects: externalSideEffectNodes.length > 0,
      externalSideEffectNodes,
      indeterminateReceipts: indeterminateReceipts.map(r => ({ id: r.id, actionKey: r.actionKey || r.action_key, status: r.status })),
      preservedWorkflowVersion: execution.workflowVersion || 1,
      warnings,
      reason: warnings[0]
    };
  }

  return {
    eligible: true,
    requiresConfirmation,
    code: 'RETRY_ELIGIBLE',
    failureCategory: classification.category,
    hasExternalSideEffects: externalSideEffectNodes.length > 0,
    externalSideEffectNodes,
    indeterminateReceipts: indeterminateReceipts.map(r => ({ id: r.id, actionKey: r.actionKey || r.action_key, status: r.status })),
    preservedWorkflowVersion: execution.workflowVersion || 1,
    warnings,
    reason: 'Execution is eligible for safe retry against its pinned workflow version.'
  };
}

export function evaluateCancellationContract(execution) {
  if (!execution) {
    return { supported: false, mode: 'unsupported', reason: 'Execution not found.' };
  }
  if (isTerminalState(execution.status) || execution.status === 'success') {
    return {
      supported: false,
      mode: 'unsupported',
      reason: `Execution is already in terminal state '${execution.status}'.`
    };
  }
  if ([
    EXECUTION_STATES.PENDING,
    EXECUTION_STATES.ENQUEUED,
    EXECUTION_STATES.WAITING,
    EXECUTION_STATES.WAITING_APPROVAL,
    EXECUTION_STATES.WAITING_WEBHOOK,
    EXECUTION_STATES.RETRY_SCHEDULED
  ].includes(execution.status)) {
    return {
      supported: true,
      mode: 'immediate',
      nextStatus: EXECUTION_STATES.CANCELED,
      reason: 'Queued or waiting execution can be canceled immediately before further steps run.'
    };
  }
  if ([EXECUTION_STATES.RUNNING, EXECUTION_STATES.RESUMING].includes(execution.status)) {
    return {
      supported: true,
      mode: 'cooperative_requested',
      nextStatus: execution.status,
      reason: 'Cooperative cancellation will be requested; any in-flight external action that already started may still complete.'
    };
  }
  return {
    supported: false,
    mode: 'unsupported',
    reason: `Cancellation is not supported for state '${execution.status}'.`
  };
}

export function sanitizeExecutionPayload(payload, maxBytes = 4096) {
  if (payload == null) return null;
  const redacted = redactSensitivePayload(payload);
  try {
    const serialized = JSON.stringify(redacted);
    if (serialized.length <= maxBytes) return redacted;
    return {
      _truncated: true,
      originalBytes: serialized.length,
      preview: serialized.slice(0, Math.max(256, maxBytes - 128)) + '...'
    };
  } catch {
    return { _truncated: true, error: 'UNSERIALIZABLE_PAYLOAD' };
  }
}

export function detectStuckExecutions({
  executions = [],
  now = Date.now(),
  runningTimeoutMs = 300_000,
  heartbeatStaleMs = 60_000
} = {}) {
  const stuck = [];
  for (const exec of executions) {
    if (!exec) continue;
    const status = exec.status;
    if (status === EXECUTION_STATES.RETRY_SCHEDULED && exec.nextRetryAt) {
      const dueMs = new Date(exec.nextRetryAt).getTime();
      if (Number.isFinite(dueMs) && dueMs <= now - 60_000) {
        stuck.push({
          executionId: exec.id,
          workflowId: exec.workflowId,
          status,
          stuckReason: 'OVERDUE_RETRY',
          overdueMs: now - dueMs
        });
      }
      continue;
    }

    if (![EXECUTION_STATES.RUNNING, EXECUTION_STATES.RESUMING].includes(status)) continue;

    const leaseExpMs = exec.leaseExpiresAt ? new Date(exec.leaseExpiresAt).getTime() : null;
    const heartbeatMs = exec.heartbeatAt ? new Date(exec.heartbeatAt).getTime() : null;
    const startedMs = exec.startedAt ? new Date(exec.startedAt).getTime() : new Date(exec.createdAt).getTime();

    if (leaseExpMs !== null && leaseExpMs <= now) {
      stuck.push({
        executionId: exec.id,
        workflowId: exec.workflowId,
        status,
        stuckReason: 'LEASE_EXPIRED',
        workerLeaseId: exec.workerLeaseId || null,
        expiredForMs: now - leaseExpMs
      });
    } else if (!exec.workerLeaseId && !leaseExpMs) {
      stuck.push({
        executionId: exec.id,
        workflowId: exec.workflowId,
        status,
        stuckReason: 'MISSING_LEASE'
      });
    } else if (heartbeatMs !== null && now - heartbeatMs > heartbeatStaleMs) {
      stuck.push({
        executionId: exec.id,
        workflowId: exec.workflowId,
        status,
        stuckReason: 'HEARTBEAT_STALE',
        workerLeaseId: exec.workerLeaseId || null,
        staleForMs: now - heartbeatMs
      });
    } else if (Number.isFinite(startedMs) && now - startedMs > runningTimeoutMs) {
      stuck.push({
        executionId: exec.id,
        workflowId: exec.workflowId,
        status,
        stuckReason: 'EXECUTION_TIMEOUT',
        runningForMs: now - startedMs
      });
    }
  }

  return {
    stuckCount: stuck.length,
    stuckExecutions: stuck
  };
}
