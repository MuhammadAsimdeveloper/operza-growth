import assert from 'node:assert/strict';
import {
  calculateChecksum,
  renderTemplate,
  evaluateCondition,
  withRetry,
  executeStep,
  walkGraph,
  buildExecutionTimeline
} from '../src/engine.mjs';

console.log('=====================================================');
console.log('🧪 Starting Workflow Engine Unit & Graph Walker Tests');
console.log('=====================================================');

// 1. Checksum Determinism
console.log('[TEST 1] State Checksum Determinism');
const stateA = { step: 1, action: 'send_sms', target: '+15550001' };
const stateB = { step: 1, action: 'send_sms', target: '+15550001' };
const stateC = { step: 2, action: 'send_sms', target: '+15550001' };

const checksumA = calculateChecksum(stateA);
const checksumB = calculateChecksum(stateB);
const checksumC = calculateChecksum(stateC);

assert.equal(checksumA, checksumB, 'Identical state objects must produce identical SHA-256 checksums');
assert.notEqual(checksumA, checksumC, 'Different states must produce distinct checksums');
console.log('✅ Checksum determinism verified');

// 2. Template Rendering
console.log('[TEST 2] Template Engine Variable Resolution');
const context = {
  contact: {
    firstName: 'Marcus',
    lastName: 'Vance',
    company: 'Nexus Capital'
  },
  deal: {
    amount: 15000
  }
};

const rendered = renderTemplate(
  'Hello {{contact.firstName}} {{contact.lastName}} from {{contact.company}}! Deal: ${{deal.amount}}.',
  context
);
assert.equal(rendered, 'Hello Marcus Vance from Nexus Capital! Deal: $15000.');

const renderedFallback = renderTemplate('Unknown: {{contact.missingField}}', context);
assert.equal(renderedFallback, 'Unknown: ');
console.log('✅ Template rendering and fallbacks verified');

// 3. Condition Evaluation
console.log('[TEST 3] Rule Condition Evaluator');
assert.ok(evaluateCondition({ field: 'contact.firstName', operator: 'equals', value: 'marcus' }, context));
assert.ok(evaluateCondition({ field: 'contact.company', operator: 'contains', value: 'nexus' }, context));
assert.ok(evaluateCondition({ field: 'deal.amount', operator: 'greater_than', value: 10000 }, context));
assert.ok(evaluateCondition({ field: 'deal.amount', operator: 'less_than', value: 20000 }, context));
assert.ok(evaluateCondition({ field: 'contact.notes', operator: 'is_empty', value: '' }, context));
assert.ok(evaluateCondition({ field: 'contact.firstName', operator: 'is_not_empty', value: '' }, context));
assert.ok(evaluateCondition({ field: 'contact.firstName', operator: 'in', value: ['Marcus', 'Alex'] }, context));
assert.ok(evaluateCondition({ field: 'contact.company', operator: 'regex', value: '^nexus' }, context));
console.log('✅ All condition rule operators verified');

// 4. Retry Helper with Exponential Backoff
console.log('[TEST 4] Retry Logic with Exponential Backoff');
let attemptsCount = 0;
const flakyFn = async () => {
  attemptsCount++;
  if (attemptsCount < 3) throw new Error('Transient network glitch');
  return 'SUCCESS';
};

const retryResult = await withRetry(flakyFn, { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 50, jitter: false });
assert.equal(retryResult, 'SUCCESS');
assert.equal(attemptsCount, 3);
console.log('✅ Retry helper recovered from transient failures');

// 5. Step Execution (Tagging Action)
console.log('[TEST 5] Execute Step — Tagging Action');
const mockContact = { id: 'c1', tags: ['lead'] };
const mockCrmActions = {
  addContactTag: async ({ contactId, tag }) => {
    mockContact.tags.push(tag);
    return { success: true };
  }
};

const stepRes = await executeStep({
  node: {
    id: 'n_tag',
    type: 'tag',
    config: { tag: 'vip-buyer' }
  },
  execution: {},
  triggerContext: { contact: mockContact },
  crmActions: mockCrmActions
});

assert.equal(stepRes.status, 'completed');
assert.ok(mockContact.tags.includes('vip-buyer'));
console.log('✅ Step execution completed successfully');

// 6. Step Execution — Approval Gate
console.log('[TEST 6] Execute Step — Approval Gate Node');
const approvalStepRes = await executeStep({
  node: {
    id: 'n_approval',
    type: 'tag',
    requiresApproval: true,
    config: { tag: 'needs-approval' }
  },
  execution: {}, // unapproved
  triggerContext: { contact: mockContact },
  crmActions: mockCrmActions
});

assert.equal(approvalStepRes.status, 'waiting_approval');
console.log('✅ Approval gate node halted workflow execution cleanly');

// 7. Graph Walker
console.log('[TEST 7] Graph Walker Traversal');
const nodes = [
  { id: '1', type: 'tag', config: { tag: 'step1' }, next: '2' },
  { id: '2', type: 'tag', config: { tag: 'step2' }, next: null }
];

let walkerExecutedSteps = [];
const mockStepExecutor = async (node) => {
  walkerExecutedSteps.push(node.id);
  return { status: 'completed' };
};

const walkResult = await walkGraph(nodes, { contact: { id: 'c1' } }, mockStepExecutor);
assert.equal(walkResult.finalStatus, 'completed');
assert.deepEqual(walkerExecutedSteps, ['1', '2']);
assert.equal(walkResult.timeline.length, 2);
console.log('✅ Graph walker sequentially traversed nodes');

// 8. Execution Timeline Builder
console.log('[TEST 8] Execution Timeline Builder');
const mockExecution = {
  id: 'exec_101',
  workflowId: 'wf_1',
  status: 'completed',
  createdAt: '2026-10-31T12:00:00Z',
  finishedAt: '2026-10-31T12:00:05Z',
  steps: [
    { nodeId: '1', name: 'Add Tag', status: 'completed', startedAt: '2026-10-31T12:00:01Z', finishedAt: '2026-10-31T12:00:02Z' },
    { nodeId: '2', name: 'Send Email', status: 'completed', startedAt: '2026-10-31T12:00:03Z', finishedAt: '2026-10-31T12:00:05Z' }
  ]
};

const timeline = buildExecutionTimeline(mockExecution);
assert.ok(Array.isArray(timeline));
assert.equal(timeline.length, 2);
assert.equal(timeline[0].nodeId, '1');
assert.equal(timeline[1].nodeId, '2');
console.log('✅ Execution timeline constructed cleanly');

console.log('\n🎉 ALL 8 WORKFLOW ENGINE UNIT TESTS PASSED CLEANLY! 🎉');
