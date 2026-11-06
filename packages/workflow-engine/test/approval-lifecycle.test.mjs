import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingApproval, resolvePendingApproval } from '../src/approval-lifecycle.mjs';

const now = Date.now();
const execution = () => ({
  id: 'execution_001',
  agencyId: 'tenant_001',
  locationId: 'location_001',
  workflowId: 'workflow_001',
  status: 'waiting_approval',
  pendingApprovalId: 'approval_pending',
  pendingApproval: { id: 'approval_pending', nodeId: 'node_email', actionHash: 'a'.repeat(64) }
});

function pending() {
  const run = execution();
  run.status = 'running';
  const approval = createPendingApproval({
    execution: run,
    tenantId: 'tenant_001',
    requestedByActorId: 'actor_owner',
    nodeId: 'node_email',
    actionHash: 'a'.repeat(64),
    actionId: 'crm.task.create',
    nodeType: 'create_task',
    nodeLabel: 'Create follow-up task',
    now,
    ttlMs: 5 * 60 * 1000
  });
  run.status = 'waiting_approval';
  run.pendingApprovalId = approval.id;
  run.pendingApproval.id = approval.id;
  return { run, approval };
}

test('creates a tenant- and action-bound approval with a bounded expiry', () => {
  const { run, approval } = pending();
  assert.equal(approval.status, 'pending');
  assert.equal(approval.tenantId, run.agencyId);
  assert.equal(approval.locationId, run.locationId);
  assert.equal(approval.executionId, run.id);
  assert.equal(approval.nodeId, 'node_email');
  assert.equal(approval.actionHash, 'a'.repeat(64));
  assert.equal(Date.parse(approval.request.expiresAt), now + 5 * 60 * 1000);
  assert.equal(approval.actionId, 'crm.task.create');
  assert.equal(approval.nodeType, 'create_task');
  assert.equal(approval.nodeLabel, 'Create follow-up task');
  assert.equal(approval.request.requestedByActorId, 'actor_owner');
});

test('approval transitions a paused execution to resuming, never completed', () => {
  const { run, approval } = pending();
  const result = resolvePendingApproval({
    approval,
    execution: run,
    tenantId: 'tenant_001',
    locationId: 'location_001',
    approverActorId: 'actor_admin',
    decision: 'approved',
    now
  });
  assert.equal(result.ok, true);
  assert.equal(result.approvalStatus, 'approved');
  assert.equal(result.executionStatus, 'resuming');
  assert.equal(result.evidence.actionHash, approval.actionHash);
  assert.equal(result.evidence.approvedByActorId, 'actor_admin');
  assert.ok(result.resumeKey);
});

test('rejects self-approval without changing the pending request', () => {
  const { run, approval } = pending();
  const result = resolvePendingApproval({
    approval,
    execution: run,
    tenantId: 'tenant_001',
    locationId: 'location_001',
    approverActorId: 'actor_owner',
    decision: 'approved',
    now
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SELF_APPROVAL');
  assert.equal(approval.status, 'pending');
});

test('rejects cross-tenant and cross-location approval attempts', () => {
  const { run, approval } = pending();
  assert.equal(resolvePendingApproval({
    approval, execution: run, tenantId: 'tenant_other', locationId: 'location_001',
    approverActorId: 'actor_admin', decision: 'approved', now
  }).code, 'TENANT_MISMATCH');
  assert.equal(resolvePendingApproval({
    approval, execution: run, tenantId: 'tenant_001', locationId: 'location_other',
    approverActorId: 'actor_admin', decision: 'approved', now
  }).code, 'LOCATION_MISMATCH');
});

test('rejects an approval whose execution or action binding has changed', () => {
  const { run, approval } = pending();
  const changed = { ...run, pendingApproval: { ...run.pendingApproval, actionHash: 'b'.repeat(64) } };
  assert.equal(resolvePendingApproval({
    approval, execution: changed, tenantId: 'tenant_001', locationId: 'location_001',
    approverActorId: 'actor_admin', decision: 'approved', now
  }).code, 'ACTION_MISMATCH');
});

test('rejects repeated decisions and executions that are no longer paused', () => {
  const { run, approval } = pending();
  const first = resolvePendingApproval({
    approval, execution: run, tenantId: 'tenant_001', locationId: 'location_001',
    approverActorId: 'actor_admin', decision: 'approved', now
  });
  assert.equal(first.ok, true);
  const decided = { ...approval, status: 'approved' };
  assert.equal(resolvePendingApproval({
    approval: decided, execution: run, tenantId: 'tenant_001', locationId: 'location_001',
    approverActorId: 'actor_other', decision: 'approved', now
  }).code, 'APPROVAL_NOT_PENDING');
  assert.equal(resolvePendingApproval({
    approval, execution: { ...run, status: 'completed' }, tenantId: 'tenant_001', locationId: 'location_001',
    approverActorId: 'actor_other', decision: 'approved', now
  }).code, 'EXECUTION_NOT_WAITING');
});

test('a rejected approval moves the paused execution to a terminal failure state', () => {
  const { run, approval } = pending();
  const result = resolvePendingApproval({
    approval, execution: run, tenantId: 'tenant_001', locationId: 'location_001',
    approverActorId: 'actor_admin', decision: 'rejected', now
  });
  assert.equal(result.ok, true);
  assert.equal(result.approvalStatus, 'rejected');
  assert.equal(result.executionStatus, 'failed');
});

test('rejects expired approval requests', () => {
  const { run, approval } = pending();
  const result = resolvePendingApproval({
    approval, execution: run, tenantId: 'tenant_001', locationId: 'location_001',
    approverActorId: 'actor_admin', decision: 'approved', now: now + 6 * 60 * 1000
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXPIRED');
});
