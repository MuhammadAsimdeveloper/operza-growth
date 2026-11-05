import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateWorkflowActions } from '../src/simulation.mjs';

test('local workflow simulation never reports side effects as completed', () => {
  const result = simulateWorkflowActions([
    { id: 'tag-1', kind: 'tag', label: 'Apply VIP tag', config: { tag: 'vip' } },
    { id: 'task-1', kind: 'task', label: 'Create follow-up', config: { dueInDays: 2 } },
    { id: 'email-1', kind: 'email', label: 'Send welcome email', config: {} }
  ], { id: 'contact-1', tags: [], status: 'lead', company: '', email: '' });

  assert.equal(result.status, 'simulated');
  assert.deepEqual(result.steps.map((step) => step.status), ['simulated', 'simulated', 'simulated']);
  assert.match(result.steps[0].detail, /would apply/i);
  assert.match(result.steps[1].detail, /would create/i);
  assert.match(result.steps[2].detail, /no message sent/i);
});

test('simulation evaluates conditions and only visits the selected branch', () => {
  const result = simulateWorkflowActions([
    {
      id: 'condition-1',
      kind: 'condition',
      label: 'Is a lead?',
      config: { rule: { field: 'status', operator: 'is', value: 'lead' } },
      yes: [{ id: 'yes-1', kind: 'tag', label: 'Add qualified', config: { tag: 'qualified' } }],
      no: [{ id: 'no-1', kind: 'task', label: 'Review contact', config: { dueInDays: 1 } }]
    }
  ], { id: 'contact-1', tags: [], status: 'lead', company: '', email: '' });

  assert.equal(result.status, 'simulated');
  assert.deepEqual(result.steps.map((step) => step.id), ['condition-1', 'yes-1']);
  assert.deepEqual(result.steps.map((step) => step.status), ['simulated', 'simulated']);
});

test('invalid webhook configuration fails simulation without claiming delivery', () => {
  const result = simulateWorkflowActions([
    { id: 'hook-1', kind: 'webhook', label: 'Call endpoint', config: { url: 'not-a-url' } },
    { id: 'task-1', kind: 'task', label: 'Create follow-up', config: { dueInDays: 1 } }
  ], { id: 'contact-1', tags: [], status: 'lead', company: '', email: '' });

  assert.equal(result.status, 'failed');
  assert.equal(result.steps[0].status, 'failed');
  assert.equal(result.steps[1].status, 'skipped');
});
