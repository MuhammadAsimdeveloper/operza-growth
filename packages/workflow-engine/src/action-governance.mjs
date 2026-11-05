import { createHash } from 'node:crypto';

const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const HASH = /^[a-f0-9]{64}$/;
const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key|client[_-]?secret)/i;
const DIRECT_TARGET_KEYS = new Set(['url', 'uri', 'endpoint', 'host', 'destination', 'webhookurl', 'callbackurl', 'redirecturl']);

const DEFINITIONS = [
  ['email', 'communication.email.send', 'external_side_effect', 'human', 'email'],
  ['send_email', 'communication.email.send', 'external_side_effect', 'human', 'email'],
  ['sms', 'communication.sms.send', 'external_side_effect', 'human', 'sms'],
  ['send_sms', 'communication.sms.send', 'external_side_effect', 'human', 'sms'],
  ['send_review_request', 'reputation.review.request', 'external_side_effect', 'human', 'reviews'],
  ['webhook', 'automation.webhook.send', 'external_side_effect', 'human', 'webhook'],
  ['http_request', 'automation.http.request', 'external_side_effect', 'human', 'http'],
  ['slack_notify', 'communication.slack.notify', 'external_side_effect', 'human', 'slack'],
  ['tag', 'crm.contact.tag', 'write', 'none', null],
  ['add_tag', 'crm.contact.tag', 'write', 'none', null],
  ['task', 'crm.task.create', 'write', 'none', null],
  ['create_task', 'crm.task.create', 'write', 'none', null],
  ['opportunity_stage', 'crm.opportunity.stage.update', 'write', 'none', null],
  ['update_stage', 'crm.opportunity.stage.update', 'write', 'none', null],
  ['update_contact', 'crm.contact.update', 'write', 'none', null],
  ['create_opportunity', 'crm.opportunity.create', 'write', 'none', null],
  ['assign_to', 'crm.contact.assign', 'write', 'none', null]
].map(([nodeType, id, risk, approval, providerKey]) => Object.freeze({
  nodeType, id, risk, approval, providerKey, surface: 'workflow'
}));

export const ACTION_CATALOG = Object.freeze(DEFINITIONS);
const ACTIONS_BY_TYPE = new Map(DEFINITIONS.map(item => [item.nodeType, item]));
const DIRECT_NETWORK_NODES = new Set(['webhook', 'http_request', 'slack_notify']);

function fail(message, code) {
  throw Object.assign(new TypeError(message), { code });
}

function assertRef(value, label) {
  if (typeof value !== 'string' || !REF.test(value)) fail(label + ' is invalid', 'INVALID_REFERENCE');
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneSafeJson(value, path = 'input', depth = 0, seen = new WeakSet()) {
  if (depth > 8) fail(path + ' exceeds the maximum nesting depth', 'INPUT_TOO_DEEP');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 20_000) fail(path + ' contains an oversized string', 'INPUT_TOO_LARGE');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(path + ' contains a non-finite number', 'INPUT_INVALID');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) fail(path + ' contains too many items', 'INPUT_TOO_LARGE');
    return value.map((item, index) => cloneSafeJson(item, path + '[' + index + ']', depth + 1, seen));
  }
  if (!isPlainObject(value) || seen.has(value)) fail(path + ' must contain plain JSON data', 'INPUT_INVALID');
  const entries = Object.entries(value);
  if (entries.length > 100) fail(path + ' contains too many properties', 'INPUT_TOO_LARGE');
  seen.add(value);
  const result = {};
  for (const [key, child] of entries) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(path + ' contains an unsafe key', 'INPUT_INVALID');
    if (SECRET_KEY.test(key)) fail(path + ' contains credential material', 'CREDENTIAL_IN_INPUT');
    result[key] = cloneSafeJson(child, path + '.' + key, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function approvalBody(request) {
  const { checksum: _checksum, ...body } = request;
  return body;
}

function approvalEvidenceIsValid(evidence, invocation, now) {
  if (!evidence || evidence.status !== 'approved') return false;
  const { checksum, ...body } = evidence;
  if (!HASH.test(checksum || '') || digest(body) !== checksum) return false;
  if (evidence.tenantId !== invocation.tenantId ||
      evidence.workflowId !== invocation.workflowId ||
      evidence.executionId !== invocation.executionId ||
      evidence.nodeId !== invocation.nodeId ||
      evidence.actionHash !== invocation.actionHash ||
      evidence.requestedByActorId !== invocation.actorId ||
      !evidence.approvedByActorId || evidence.approvedByActorId === evidence.requestedByActorId) return false;
  const expiry = Date.parse(evidence.expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

export function getWorkflowActionDefinition(nodeType) {
  const definition = ACTIONS_BY_TYPE.get(nodeType);
  return definition ? { ...definition } : null;
}

export function isDirectNetworkNode(nodeType) {
  return DIRECT_NETWORK_NODES.has(nodeType);
}

export function createActionInvocation({
  tenantId = null,
  workflowId = null,
  executionId = null,
  actorId = null,
  node,
  input,
  mode = 'dry_run',
  providerStatus = 'unconfigured',
  consent = false,
  approvalEvidence = null
} = {}) {
  if (!isPlainObject(node) || typeof node.id !== 'string' || node.id.length < 1 || node.id.length > 180) {
    fail('node must have a bounded ID', 'INVALID_NODE');
  }
  const definition = ACTIONS_BY_TYPE.get(node.type);
  if (!definition) fail('workflow action is not registered', 'ACTION_NOT_REGISTERED');
  if (!['dry_run', 'live'].includes(mode)) fail('mode must be dry_run or live', 'INVALID_MODE');
  if (!['verified', 'unconfigured', 'degraded', 'revoked'].includes(providerStatus)) {
    fail('provider status is invalid', 'INVALID_PROVIDER_STATUS');
  }
  if (typeof consent !== 'boolean') fail('consent must be boolean', 'INVALID_CONSENT');

  if (mode === 'live') {
    assertRef(tenantId, 'tenantId');
    assertRef(workflowId, 'workflowId');
    assertRef(executionId, 'executionId');
    assertRef(actorId, 'actorId');
  }

  const safeInput = cloneSafeJson(input === undefined ? (node.config || {}) : input);
  const serialized = JSON.stringify(safeInput);
  if (serialized.length > 100_000) fail('action input exceeds the maximum serialized size', 'INPUT_TOO_LARGE');

  const identity = {
    tenantId,
    workflowId,
    executionId,
    actorId,
    nodeId: node.id,
    nodeType: node.type,
    actionId: definition.id,
    mode,
    providerStatus,
    consent,
    input: safeInput
  };
  const actionHash = digest(identity);
  return freeze({
    ...identity,
    risk: definition.risk,
    approval: definition.approval,
    providerKey: definition.providerKey,
    approvalEvidence: approvalEvidence ? cloneSafeJson(approvalEvidence, 'approvalEvidence') : null,
    actionHash
  });
}

export function authorizeActionInvocation(invocation, { now = Date.now() } = {}) {
  if (!invocation || typeof invocation !== 'object' || !ACTIONS_BY_TYPE.has(invocation.nodeType)) {
    return { decision: 'deny', code: 'INVOCATION_INVALID' };
  }
  const definition = ACTIONS_BY_TYPE.get(invocation.nodeType);
  const expectedHash = digest({
    tenantId: invocation.tenantId, workflowId: invocation.workflowId, executionId: invocation.executionId,
    actorId: invocation.actorId, nodeId: invocation.nodeId, nodeType: invocation.nodeType,
    actionId: invocation.actionId, mode: invocation.mode, providerStatus: invocation.providerStatus,
    consent: invocation.consent, input: invocation.input
  });
  if (invocation.actionId !== definition.id || invocation.risk !== definition.risk ||
      invocation.approval !== definition.approval || invocation.providerKey !== definition.providerKey ||
      invocation.actionHash !== expectedHash) return { decision: 'deny', code: 'INVOCATION_TAMPERED' };
  if (invocation.mode === 'dry_run') return { decision: 'simulate', code: 'DRY_RUN_ONLY' };
  if (invocation.mode !== 'live') return { decision: 'deny', code: 'INVALID_MODE' };
  if (invocation.risk !== 'external_side_effect') return { decision: 'allow', code: 'INTERNAL_ACTION' };
  if (invocation.providerStatus !== 'verified') return { decision: 'deny', code: 'PROVIDER_UNVERIFIED' };
  if (invocation.consent !== true) return { decision: 'deny', code: 'CONSENT_REQUIRED' };
  if (invocation.approval !== 'none' && !approvalEvidenceIsValid(invocation.approvalEvidence, invocation, now)) {
    return { decision: 'deny', code: invocation.approvalEvidence ? 'APPROVAL_MISMATCH' : 'APPROVAL_REQUIRED' };
  }
  return { decision: 'allow', code: 'POLICY_SATISFIED' };
}

export function createApprovalRequest({
  tenantId,
  workflowId,
  executionId,
  nodeId,
  requestedByActorId,
  actionHash,
  expiresAt
} = {}) {
  assertRef(tenantId, 'tenantId');
  assertRef(workflowId, 'workflowId');
  assertRef(executionId, 'executionId');
  assertRef(nodeId, 'nodeId');
  assertRef(requestedByActorId, 'requestedByActorId');
  if (!HASH.test(actionHash || '')) fail('actionHash must be a SHA-256 digest', 'INVALID_ACTION_HASH');
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) fail('expiresAt must be in the future', 'INVALID_EXPIRY');
  const body = {
    id: 'approval_' + digest({ tenantId, workflowId, executionId, nodeId, actionHash }).slice(0, 24),
    tenantId, workflowId, executionId, nodeId, requestedByActorId,
    actionHash, status: 'pending', expiresAt: new Date(expiry).toISOString()
  };
  return freeze({ ...body, checksum: digest(body) });
}

export function decideApproval({ request, tenantId, approvedByActorId, decision, now = Date.now() } = {}) {
  if (!request || typeof request !== 'object' || !HASH.test(request.checksum || '') ||
      digest(approvalBody(request)) !== request.checksum) {
    return { status: 'denied', code: 'INVALID_REQUEST' };
  }
  if (request.tenantId !== tenantId) return { status: 'denied', code: 'TENANT_MISMATCH' };
  if (approvedByActorId === request.requestedByActorId) return { status: 'denied', code: 'SELF_APPROVAL' };
  if (!['approved', 'rejected'].includes(decision) || !approvedByActorId) return { status: 'denied', code: 'INVALID_DECISION' };
  if (Date.parse(request.expiresAt) <= now) return { status: 'denied', code: 'EXPIRED' };

  const body = {
    status: decision,
    requestId: request.id,
    tenantId: request.tenantId,
    workflowId: request.workflowId,
    executionId: request.executionId,
    nodeId: request.nodeId,
    requestedByActorId: request.requestedByActorId,
    approvedByActorId,
    actionHash: request.actionHash,
    approvedAt: new Date(now).toISOString(),
    expiresAt: request.expiresAt
  };
  return freeze({ ...body, checksum: digest(body) });
}

function collectFindings(value, path, findings, depth = 0) {
  if (depth > 8 || value == null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? path + '.' + key : key;
    if (SECRET_KEY.test(key)) findings.push({ code: 'SECRET_LIKE_FIELD', severity: 'critical', path: nextPath });
    collectFindings(child, nextPath, findings, depth + 1);
  }
}

export function auditWorkflowSecurity({ tenantId, workflow } = {}) {
  const findings = [];
  if (!REF.test(tenantId || '')) findings.push({ code: 'TENANT_CONTEXT_MISSING', severity: 'critical' });
  if (!workflow || !Array.isArray(workflow.nodes)) {
    findings.push({ code: 'WORKFLOW_NODES_MISSING', severity: 'critical' });
  }
  if (workflow && workflow.tenantId && workflow.tenantId !== tenantId) {
    findings.push({ code: 'TENANT_MISMATCH', severity: 'critical' });
  }

  for (const node of (workflow && Array.isArray(workflow.nodes) ? workflow.nodes : [])) {
    if (!node || typeof node !== 'object') {
      findings.push({ code: 'INVALID_NODE', severity: 'critical' });
      continue;
    }
    const definition = ACTIONS_BY_TYPE.get(node.type);
    if (DIRECT_NETWORK_NODES.has(node.type)) {
      const config = isPlainObject(node.config) ? node.config : {};
      const hasTarget = Object.keys(config).some(key => DIRECT_TARGET_KEYS.has(key.toLowerCase()));
      findings.push({
        code: hasTarget ? 'DIRECT_NETWORK_TARGET' : 'UNSCOPED_NETWORK_NODE',
        severity: 'critical', nodeId: node.id || null
      });
    }
    if (definition && definition.risk === 'external_side_effect' && node.requiresApproval !== true) {
      findings.push({ code: 'APPROVAL_POLICY_MISSING', severity: 'high', nodeId: node.id || null });
    }
    collectFindings(node.config || {}, 'nodes.' + (node.id || 'unknown') + '.config', findings);
  }

  const status = findings.some(item => item.severity === 'critical')
    ? 'blocked'
    : findings.some(item => item.severity === 'high') ? 'review_required' : 'ready';
  return freeze({ status, tenantId: tenantId || null, workflowId: workflow && workflow.id || null, findings });
}
