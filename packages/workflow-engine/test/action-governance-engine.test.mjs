import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStep } from '../src/engine.mjs';
import { createActionInvocation, createApprovalRequest, decideApproval } from '../src/action-governance.mjs';

const identity = {
  tenantId: 'tenant_123',
  workflowId: 'workflow_123',
  executionId: 'execution_123',
  actorId: 'actor_owner'
};

test('outbound email is simulated by default and does not write a fake sent message', async () => {
  let calls = 0;
  const result = await executeStep({
    node: { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hello', body: 'Test' } },
    execution: { agencyId: identity.tenantId, workflowId: identity.workflowId, id: identity.executionId },
    triggerContext: {},
    crmActions: { sendEmail: async () => { calls += 1; } }
  });
  assert.equal(result.status, 'simulated');
  assert.equal(result.result.sideEffectsDisabled, true);
  assert.equal(calls, 0);
});

test('raw HTTP workflow nodes are blocked before fetch is called', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('fetch must not run'); };
  try {
    const result = await executeStep({
      node: { id: 'node_http', type: 'http_request', config: { url: 'http://127.0.0.1:8080/admin' } },
      execution: { agencyId: identity.tenantId, workflowId: identity.workflowId, id: identity.executionId },
      triggerContext: {}
    });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorCode, 'DIRECT_NETWORK_TARGET_DISABLED');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verified live delivery requires an approved action and an injected provider adapter', async () => {
  const node = { id: 'node_email', type: 'send_email', config: { to: 'person@example.com', subject: 'Hello' } };
  const invocation = createActionInvocation({ ...identity, node, mode: 'live', providerStatus: 'verified', consent: true });
  const request = createApprovalRequest({
    ...identity,
    nodeId: node.id,
    requestedByActorId: identity.actorId,
    actionHash: invocation.actionHash,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  const approvalEvidence = decideApproval({
    request,
    tenantId: identity.tenantId,
    approvedByActorId: 'actor_admin',
    decision: 'approved'
  });
  let providerCalls = 0;
  const result = await executeStep({
    node,
    execution: {
      agencyId: identity.tenantId,
      workflowId: identity.workflowId,
      id: identity.executionId,
      actorId: identity.actorId,
      mode: 'live',
      providerStatuses: { email: 'verified' },
      consent: true,
      approvalEvidence
    },
    triggerContext: {},
    providerExecutor: async ({ invocation: received }) => {
      providerCalls += 1;
      assert.equal(received.actionHash, invocation.actionHash);
      return { accepted: true };
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.result.dispatch, 'accepted');
  assert.equal(providerCalls, 1);
});

test('live delivery fails closed when provider or consent is not configured', async () => {
  const result = await executeStep({
    node: { id: 'node_sms', type: 'send_sms', config: { phone: '+15550100', message: 'Hello' } },
    execution: {
      agencyId: identity.tenantId, workflowId: identity.workflowId, id: identity.executionId,
      actorId: identity.actorId, mode: 'live', providerStatuses: {}, consent: false
    },
    triggerContext: {},
    providerExecutor: async () => { throw new Error('must not run'); }
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'PROVIDER_UNVERIFIED');
});
