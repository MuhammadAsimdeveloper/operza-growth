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

test('math node computes arithmetic operations and stores variable', async () => {
  const node = {
    id: 'node-math-1',
    type: 'math',
    config: {
      operandA: 150,
      operandB: 3,
      operation: 'multiply',
      resultVariable: 'totalValue'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.output, 450);
  assert.equal(res.setVariable?.name, 'totalValue');
  assert.equal(res.setVariable?.value, 450);
});

test('lead_score node increments contact points via CRM action', async () => {
  let scoredPoints = 0;
  let scoredContact = null;

  const node = {
    id: 'node-score-1',
    type: 'lead_score',
    config: {
      points: 25
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {
      contact: { id: 'con_lead_123', name: 'John Doe' }
    },
    crmActions: {
      updateLeadScore: async ({ contactId, points }) => {
        scoredContact = contactId;
        scoredPoints = points;
      }
    }
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.pointsAdded, 25);
  assert.equal(scoredContact, 'con_lead_123');
  assert.equal(scoredPoints, 25);
});

test('internal_notification node dispatches team alert via CRM action', async () => {
  let alertDispatched = null;

  const node = {
    id: 'node-notif-1',
    type: 'internal_notification',
    config: {
      title: 'High Value Lead Alert',
      message: 'New prospect requested consultation',
      channel: 'in_app'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {
      contact: { id: 'con_alert_1', name: 'VIP Lead' }
    },
    crmActions: {
      sendInternalNotification: async (data) => {
        alertDispatched = data;
        return { id: 'notif_999', ...data };
      }
    }
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.title, 'High Value Lead Alert');
  assert.equal(res.result.notificationId, 'notif_999');
  assert.equal(alertDispatched.channel, 'in_app');
});

test('loop_items node iterates over array items in batches', async () => {
  const node = {
    id: 'node-loop-1',
    type: 'loop_items',
    config: {
      items: [
        { id: 'deal-1', value: 1000 },
        { id: 'deal-2', value: 2000 },
        { id: 'deal-3', value: 3000 },
        { id: 'deal-4', value: 4000 },
        { id: 'deal-5', value: 5000 }
      ],
      batchSize: 2
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.iterations, 5);
  assert.equal(res.result.batchSize, 2);
  assert.equal(res.result.batchCount, 3);
  assert.equal(res.result.firstItem.id, 'deal-1');
  assert.equal(res.loopItems.length, 5);
});

test('data_filter node filters array by condition rules', async () => {
  const node = {
    id: 'node-filter-1',
    type: 'data_filter',
    config: {
      items: [
        { id: 'lead-1', score: 20, stage: 'new' },
        { id: 'lead-2', score: 85, stage: 'qualified' },
        { id: 'lead-3', score: 40, stage: 'contacted' },
        { id: 'lead-4', score: 95, stage: 'qualified' }
      ],
      field: 'score',
      operator: 'greater_than',
      value: 50,
      resultVariable: 'qualifiedLeads'
    }
  };

  const res = await executeStep({
    node,
    triggerContext: {},
    crmActions: {}
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.result.filteredCount, 2);
  assert.equal(res.result.totalInputItems, 4);
  assert.deepEqual(res.result.items.map(i => i.id), ['lead-2', 'lead-4']);
  assert.equal(res.setVariable?.name, 'qualifiedLeads');
  assert.equal(res.setVariable?.value?.length, 2);
});
