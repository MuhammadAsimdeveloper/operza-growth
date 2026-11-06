import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCopilotTool, createCopilotProposal } from '../src/tool-permissions.mjs';

test('read-only Copilot tools can be invoked for a viewer', () => {
  assert.equal(authorizeCopilotTool({ toolName: 'search_contacts', actorRole: 'viewer' }).decision, 'allow_read');
});

test('write tools produce proposals, never execution permission', () => {
  for (const toolName of ['create_contact', 'create_task', 'book_appointment', 'update_opportunity_stage', 'trigger_workflow', 'send_communication']) {
    const result = authorizeCopilotTool({ toolName, actorRole: 'admin' });
    assert.equal(result.decision, 'proposal_only');
    assert.equal(result.requiresHumanApproval, true);
    assert.notEqual(result.decision, 'execute');
  }
});

test('role, tenant capability and agent grants are enforced', () => {
  assert.equal(authorizeCopilotTool({ toolName: 'create_contact', actorRole: 'viewer' }).code, 'ACTOR_ROLE_FORBIDDEN');
  assert.equal(authorizeCopilotTool({ toolName: 'send_communication', actorRole: 'admin', tenantCapability: false }).code, 'TENANT_CAPABILITY_DISABLED');
  assert.equal(authorizeCopilotTool({ toolName: 'create_task', actorRole: 'admin', agentGrant: false }).code, 'AGENT_GRANT_MISSING');
  assert.equal(authorizeCopilotTool({ toolName: 'run_shell', actorRole: 'owner' }).code, 'TOOL_NOT_REGISTERED');
});

test('proposals are tenant-scoped and reject secret-like parameters', () => {
  const proposal = createCopilotProposal({
    tenantId: 'tenant_001',
    locationId: 'location_001',
    actorId: 'actor_001',
    toolName: 'create_contact',
    params: { firstName: 'Sarah', email: 'sarah@example.com' },
    id: 'proposal_001'
  });
  assert.equal(proposal.status, 'pending_review');
  assert.equal(proposal.requiresHumanApproval, true);
  assert.equal(proposal.params.firstName, 'Sarah');
  assert.throws(() => createCopilotProposal({
    tenantId: 'tenant_001', locationId: 'location_001', actorId: 'actor_001',
    toolName: 'send_communication', params: { token: 'never-store' }
  }), { code: 'CREDENTIAL_IN_PROPOSAL' });
});
