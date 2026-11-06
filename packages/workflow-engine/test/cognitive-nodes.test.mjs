import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStep } from '../src/engine.mjs';
import { createActionInvocation, createApprovalRequest, decideApproval } from '../src/action-governance.mjs';

test('ai_classify node classifies lead text and routes to matching branch', async () => {
  const node = {
    id: 'node-classify-1',
    type: 'ai_classify',
    config: {
      text: 'I need help with my invoice and billing statement urgently',
      categories: ['sales', 'billing', 'support', 'technical'],
      resultVariable: 'leadCategory'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.selectedBranch, 'billing');
  assert.equal(res.result.category, 'billing');
  assert.equal(res.setVariable?.name, 'leadCategory');
  assert.equal(res.setVariable?.value, 'billing');
});

test('ai_extract node extracts structured data from unstructured text', async () => {
  const node = {
    id: 'node-extract-1',
    type: 'ai_extract',
    config: {
      text: 'Contact Alice at alice@cyberdyne.test with budget of $50,000',
      schema: ['email', 'budget'],
      resultVariable: 'extractedInfo'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.extracted.email, 'alice@cyberdyne.test');
  assert.equal(res.result.extracted.budget, '50000');
  assert.equal(res.setVariable?.name, 'extractedInfo');
});

test('switch node routes value to correct matching branch', async () => {
  const node = {
    id: 'node-switch-1',
    type: 'switch',
    config: {
      value: 'VIP',
      cases: [
        { value: 'Standard', branch: 'standard_flow' },
        { value: 'VIP', branch: 'white_glove_flow' }
      ],
      defaultBranch: 'general_flow'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.selectedBranch, 'white_glove_flow');
  assert.equal(res.result.branch, 'white_glove_flow');
});

test('code node transforms data in sandboxed environment', async () => {
  const node = {
    id: 'node-code-1',
    type: 'code',
    config: {
      code: `
        const base = $json.dealValue || 100;
        return {
          calculatedDiscount: base * 0.20,
          netTotal: base * 0.80
        };
      `,
      resultVariable: 'pricing'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {
      contact: { dealValue: 500 }
    },
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.output.calculatedDiscount, 100);
  assert.equal(res.result.output.netTotal, 400);
  assert.equal(res.setVariable?.name, 'pricing');
});

test('whatsapp node simulates in dry-run mode and dispatches in live mode with governance', async () => {
  const node = {
    id: 'node-wa-1',
    type: 'send_whatsapp',
    config: {
      phone: '+1 555-0999',
      message: 'Appointment confirmed for tomorrow at 2pm'
    }
  };

  // 1. Dry run safely returns simulated
  const dryRunRes = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });
  assert.equal(dryRunRes.status, 'simulated');
  assert.equal(dryRunRes.result.sideEffectsDisabled, true);

  // 2. Live delivery with approved action and providerExecutor
  const identity = {
    tenantId: 'agency-wa-100',
    workflowId: 'wf-wa-100',
    executionId: 'exec-wa-100',
    actorId: 'usr-admin-1'
  };
  const invocation = createActionInvocation({
    ...identity,
    node,
    mode: 'live',
    providerStatus: 'verified',
    consent: true
  });
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
    approvedByActorId: 'usr-superadmin',
    decision: 'approved'
  });

  let dispatched = false;
  const liveRes = await executeStep({
    node,
    execution: {
      mode: 'live',
      agencyId: identity.tenantId,
      workflowId: identity.workflowId,
      id: identity.executionId,
      actorId: identity.actorId,
      consent: true,
      providerStatuses: { whatsapp: 'verified' },
      approvalEvidence
    },
    triggerContext: {},
    crmActions: {},
    providerExecutor: async () => {
      dispatched = true;
    }
  });

  assert.equal(liveRes.status, 'completed');
  assert.equal(liveRes.result.dispatch, 'accepted');
  assert.equal(dispatched, true);
});
