import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_CATALOG,
  auditWorkflowSecurity,
  authorizeActionInvocation,
  createActionInvocation,
  createApprovalRequest,
  decideApproval,
  getWorkflowActionDefinition,
  isDirectNetworkNode
} from '../src/action-governance.mjs';

const base = {
  tenantId: 'tenant_123',
  workflowId: 'workflow_123',
  executionId: 'execution_123',
  actorId: 'actor_owner',
  node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hello' } },
  input: { to: 'person@example.com', subject: 'Hello' },
  mode: 'live',
  providerStatus: 'verified',
  consent: true
};

test('catalog classifies external actions separately from tenant CRM writes', () => {
  assert.equal(getWorkflowActionDefinition('send_email').risk, 'external_side_effect');
  assert.equal(getWorkflowActionDefinition('create_task').risk, 'write');
  assert.ok(ACTION_CATALOG.length >= 10);
});

test('dry-run creates a plan and never authorizes external delivery', () => {
  const invocation = createActionInvocation({ ...base, mode: 'dry_run', providerStatus: 'verified', consent: true });
  assert.equal(authorizeActionInvocation(invocation).decision, 'simulate');
  assert.equal(authorizeActionInvocation(invocation).code, 'DRY_RUN_ONLY');
  assert.equal(authorizeActionInvocation({ ...invocation, consent: false }).code, 'INVOCATION_TAMPERED');
});

test('live external actions require a verified provider and explicit consent', () => {
  const unverified = createActionInvocation({ ...base, providerStatus: 'unconfigured' });
  assert.equal(authorizeActionInvocation(unverified).code, 'PROVIDER_UNVERIFIED');
  const noConsent = createActionInvocation({ ...base, consent: false });
  assert.equal(authorizeActionInvocation(noConsent).code, 'CONSENT_REQUIRED');
});

test('live external actions require approval bound to this action, tenant and execution', () => {
  const invocation = createActionInvocation(base);
  const request = createApprovalRequest({
    tenantId: base.tenantId,
    workflowId: base.workflowId,
    executionId: base.executionId,
    nodeId: base.node.id,
    requestedByActorId: base.actorId,
    actionHash: invocation.actionHash,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(authorizeActionInvocation(invocation).code, 'APPROVAL_REQUIRED');
  assert.equal(decideApproval({ request, tenantId: base.tenantId, approvedByActorId: base.actorId, decision: 'approved' }).code, 'SELF_APPROVAL');
  const decision = decideApproval({ request, tenantId: base.tenantId, approvedByActorId: 'actor_admin', decision: 'approved' });
  assert.equal(decision.status, 'approved');
  assert.equal(authorizeActionInvocation(createActionInvocation({ ...base, approvalEvidence: decision })).decision, 'allow');
  assert.equal(authorizeActionInvocation(createActionInvocation({ ...base, tenantId: 'tenant_other', approvalEvidence: decision })).code, 'APPROVAL_MISMATCH');
});

test('approval decisions reject tampering, expiry and cross-tenant approval', () => {
  const request = createApprovalRequest({
    tenantId: 'tenant_123', workflowId: 'workflow_123', executionId: 'execution_123',
    nodeId: 'node_email', requestedByActorId: 'actor_owner', actionHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(decideApproval({ request, tenantId: 'tenant_other', approvedByActorId: 'actor_admin', decision: 'approved' }).code, 'TENANT_MISMATCH');
  assert.equal(decideApproval({ request: { ...request, actionHash: 'b'.repeat(64) }, tenantId: 'tenant_123', approvedByActorId: 'actor_admin', decision: 'approved' }).code, 'INVALID_REQUEST');
  const expiredRequest = createApprovalRequest({
    tenantId: 'tenant_123', workflowId: 'workflow_123', executionId: 'execution_123',
    nodeId: 'node_email', requestedByActorId: 'actor_owner', actionHash: 'c'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  assert.equal(decideApproval({ request: expiredRequest, tenantId: 'tenant_123', approvedByActorId: 'actor_admin', decision: 'approved', now: Date.now() + 120_000 }).code, 'EXPIRED');
});

test('invocations reject credential material and unbounded payloads', () => {
  assert.throws(() => createActionInvocation({ ...base, input: { to: 'x@example.com', apiKey: 'do-not-store' } }), { code: 'CREDENTIAL_IN_INPUT' });
  assert.throws(() => createActionInvocation({ ...base, input: { note: 'x'.repeat(120_000) } }), { code: 'INPUT_TOO_LARGE' });
});

test('direct URL nodes are rejected as unscoped network operations', () => {
  for (const type of ['webhook', 'http_request', 'slack_notify']) assert.equal(isDirectNetworkNode(type), true);
  assert.equal(isDirectNetworkNode('send_email'), false);
  const audit = auditWorkflowSecurity({
    tenantId: 'tenant_123',
    workflow: { id: 'workflow_123', tenantId: 'tenant_123', nodes: [
      { id: 'node_http', type: 'http_request', config: { url: 'http://169.254.169.254/latest/meta-data' } },
      { id: 'node_mail', type: 'send_email', config: { to: 'x@example.com' } }
    ] }
  });
  assert.equal(audit.status, 'blocked');
  assert.ok(audit.findings.some(item => item.code === 'DIRECT_NETWORK_TARGET'));
  assert.ok(audit.findings.some(item => item.code === 'APPROVAL_POLICY_MISSING'));
});

test('workflow audit rejects tenant mismatches and secret-shaped workflow configuration', () => {
  const audit = auditWorkflowSecurity({
    tenantId: 'tenant_123',
    workflow: { id: 'workflow_123', tenantId: 'tenant_other', nodes: [
      { id: 'node_email', type: 'send_email', requiresApproval: true, config: { smtpPassword: 'hidden' } }
    ] }
  });
  assert.equal(audit.status, 'blocked');
  assert.ok(audit.findings.some(item => item.code === 'TENANT_MISMATCH'));
  assert.ok(audit.findings.some(item => item.code === 'SECRET_LIKE_FIELD'));
});
