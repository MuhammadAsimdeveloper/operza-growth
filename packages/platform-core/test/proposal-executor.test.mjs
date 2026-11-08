import test from 'node:test';
import assert from 'node:assert/strict';
import { executeCopilotProposal } from '../src/proposal-executor.mjs';
import { createBillingLedgerStore } from '../src/billing-ledger.mjs';

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

test('executeCopilotProposal: fails closed with INSUFFICIENT_CREDITS when ledger balance is zero', async () => {
  const ledger = createBillingLedgerStore();
  const proposal = {
    id: 'prop-credit-fail',
    status: 'approved',
    toolName: 'create_contact',
    params: { firstName: 'Bob', email: 'bob@example.com' },
    tenantId: 'agency-broke',
    locationId: 'loc-broke'
  };
  const actor = { role: 'admin', id: 'admin-1', user: { id: 'admin-1' } };
  let handlerCalled = false;
  const handlers = {
    create_contact: async () => { handlerCalled = true; return { id: 'contact-bob' }; }
  };

  const res = await executeCopilotProposal({
    proposal,
    actor,
    handlers,
    ledger,
    toolCostCents: 50
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, 'INSUFFICIENT_CREDITS');
  assert.equal(handlerCalled, false);
});

test('executeCopilotProposal: debits ledger and succeeds when location has sufficient credits', async () => {
  const ledger = createBillingLedgerStore();
  ledger.recordTransaction({
    agencyId: 'agency-funded',
    locationId: 'loc-funded',
    entryType: 'credit',
    amountCents: 500,
    referenceType: 'subscription_allowance'
  });

  const proposal = {
    id: 'prop-credit-ok',
    status: 'approved',
    toolName: 'create_contact',
    params: { firstName: 'Charlie', email: 'charlie@example.com' },
    tenantId: 'agency-funded',
    locationId: 'loc-funded'
  };
  const actor = { role: 'admin', id: 'admin-1', user: { id: 'admin-1' } };
  let handlerCalled = false;
  const handlers = {
    create_contact: async () => { handlerCalled = true; return { id: 'contact-charlie' }; }
  };

  const res = await executeCopilotProposal({
    proposal,
    actor,
    handlers,
    ledger,
    toolCostCents: 50
  });

  assert.equal(res.ok, true);
  assert.equal(res.code, 'PROPOSAL_EXECUTED');
  assert.equal(handlerCalled, true);
  assert.equal(ledger.getBalance({ agencyId: 'agency-funded', locationId: 'loc-funded' }), 450);
});
