import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStep } from '../src/engine.mjs';

test('assign_to passes the selected user as the CRM assignee', async () => {
  let assignment;

  const result = await executeStep({
    node: {
      id: 'node_assign',
      type: 'assign_to',
      config: { userId: 'user_42' }
    },
    execution: { id: 'execution_42' },
    triggerContext: { contact: { id: 'contact_42' } },
    crmActions: {
      assignContact: async ({ contactId, assignee }) => {
        assignment = { contactId, assignee };
      }
    }
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(assignment, {
    contactId: 'contact_42',
    assignee: 'user_42'
  });
});

test('dry-run CRM write actions never call mutation adapters', async () => {
  let mutationCount = 0;

  const result = await executeStep({
    node: {
      id: 'node_tag_dry_run',
      type: 'tag',
      config: { tag: 'vip' }
    },
    execution: { id: 'execution_dry_run', mode: 'dry_run' },
    triggerContext: { contact: { id: 'contact_42' } },
    crmActions: {
      addContactTag: async () => { mutationCount += 1; }
    }
  });

  assert.equal(result.status, 'simulated');
  assert.equal(result.result.sideEffectsDisabled, true);
  assert.equal(mutationCount, 0);
});

test('dry-run wait nodes preview the delay without suspending execution', async () => {
  const result = await executeStep({
    node: {
      id: 'node_wait_dry_run',
      type: 'wait',
      config: { durationMinutes: 30 }
    },
    execution: { id: 'execution_dry_run', mode: 'dry_run' },
    triggerContext: {}
  });

  assert.equal(result.status, 'simulated');
  assert.equal(result.result.wouldWaitMinutes, 30);
});
