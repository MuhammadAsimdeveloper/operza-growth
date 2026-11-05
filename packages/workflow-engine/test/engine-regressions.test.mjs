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
