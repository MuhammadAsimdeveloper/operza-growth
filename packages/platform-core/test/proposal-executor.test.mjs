import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCopilotProposal } from '../src/proposal-executor.mjs';

test('executeCopilotProposal rejects unapproved proposal', async () => {
  const proposal = {
    id: 'prop-1',
    status: 'pending_review',
    toolName: 'create_contact',
    params: { email: 'test@example.com' },
    tenantId: 'agency-1',
    locationId: 'loc-1'
  };
  const actor = { role: 'admin', id: 'user-1' };

  const res = await executeCopilotProposal({ proposal, actor });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'PROPOSAL_NOT_APPROVED');
});

test('executeCopilotProposal rejects unauthorized non-admin actor', async () => {
  const proposal = {
    id: 'prop-2',
    status: 'approved',
    toolName: 'create_contact',
    params: { email: 'test@example.com' },
    tenantId: 'agency-1',
    locationId: 'loc-1'
  };
  const actor = { role: 'viewer', id: 'user-2' };

  const res = await executeCopilotProposal({ proposal, actor });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'UNAUTHORIZED_EXECUTOR');
});

test('executeCopilotProposal executes approved proposal with registered handler and generates action receipt', async () => {
  const proposal = {
    id: 'prop-3',
    status: 'approved',
    toolName: 'create_contact',
    params: { firstName: 'Alice', email: 'alice@example.com' },
    tenantId: 'agency-1',
    locationId: 'loc-1'
  };
  const actor = { role: 'admin', id: 'admin-1', user: { id: 'admin-1' } };

  let handlerCalled = false;
  const handlers = {
    create_contact: async (params, ctx) => {
      handlerCalled = true;
      assert.equal(params.email, 'alice@example.com');
      assert.equal(ctx.tenantId, 'agency-1');
      return { id: 'contact-alice-123', success: true };
    }
  };

  const res = await executeCopilotProposal({ proposal, actor, handlers });
  assert.equal(res.ok, true);
  assert.equal(res.code, 'PROPOSAL_EXECUTED');
  assert.equal(handlerCalled, true);
  assert.equal(res.proposal.status, 'executed');
  assert.ok(res.proposal.receiptId.startsWith('rcpt_'));
  assert.equal(res.receipt.proposalId, 'prop-3');
  assert.equal(res.receipt.entityId, 'contact-alice-123');
});
