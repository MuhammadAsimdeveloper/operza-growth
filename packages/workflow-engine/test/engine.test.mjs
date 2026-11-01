import assert from 'node:assert/strict';
import {
  calculateChecksum,
  renderTemplate,
  evaluateCondition,
  withRetry,
  executeStep,
  walkGraph,
  buildExecutionTimeline,
  isSafeOutboundUrl
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

// 9. n8n-style Expression Engine ($json, $vars, $today)
console.log('[TEST 9] n8n-style Expression Resolution');
const exprContext = {
  contact: { email: 'client@example.com', score: 85 },
  variables: { discount: 20 }
};
const n8nTemplate = 'Send to {{ $json.email }} with {{ $vars.discount }}% discount. Date: {{ $today }}.';
const renderedExpr = renderTemplate(n8nTemplate, exprContext);
assert.ok(renderedExpr.includes('Send to client@example.com with 20% discount. Date: '));
console.log('✅ n8n-style expression syntax verified');

// 10. JavaScript Code Node
console.log('[TEST 10] JavaScript Code Transformation Node');
const codeStepRes = await executeStep({
  node: {
    id: 'n_code',
    type: 'code',
    config: {
      script: 'return { fullName: $json.firstName + " " + $json.lastName, scoreMultiplier: $json.score * 2 };',
      resultVariable: 'transformed'
    }
  },
  execution: {},
  triggerContext: { contact: { firstName: 'Sarah', lastName: 'Connor', score: 40 } },
  variables: {}
});
assert.equal(codeStepRes.status, 'completed');
assert.equal(codeStepRes.result.codeOutput.fullName, 'Sarah Connor');
assert.equal(codeStepRes.result.codeOutput.scoreMultiplier, 80);
assert.equal(codeStepRes.setVariable.name, 'transformed');
console.log('✅ JavaScript code transformation node verified');

// 11. Multi-Branch Switch Node
console.log('[TEST 11] Multi-Branch Switch Node');
const switchStepRes = await executeStep({
  node: {
    id: 'n_switch',
    type: 'switch',
    config: {
      rules: [
        { field: 'contact.tier', operator: 'equals', value: 'enterprise', branch: 'enterprise_branch' },
        { field: 'contact.tier', operator: 'equals', value: 'starter', branch: 'starter_branch' }
      ],
      fallbackBranch: 'standard_branch'
    }
  },
  execution: {},
  triggerContext: { contact: { tier: 'enterprise' } }
});
assert.equal(switchStepRes.status, 'completed');
assert.equal(switchStepRes.selectedBranch, 'enterprise_branch');
console.log('✅ Multi-branch switch node routing verified');

// 12. Multi-Input Merge Node
console.log('[TEST 12] Multi-Input Merge Node');
const mergeStepRes = await executeStep({
  node: {
    id: 'n_merge',
    type: 'merge',
    config: { mode: 'combine' }
  },
  execution: {},
  triggerContext: { contact: { id: 'c100' } },
  variables: { interimResult: 'ready' }
});
assert.equal(mergeStepRes.status, 'completed');
assert.equal(mergeStepRes.result.merged, true);
assert.equal(mergeStepRes.result.data.variables.interimResult, 'ready');
console.log('✅ Merge node context combination verified');

// 13. Code Node Security & Sandbox Isolation
console.log('[TEST 13] Safe VM Sandbox Isolation & Denial-of-Service Defense');
const sandboxIsolationRes = await executeStep({
  node: {
    id: 'n_sandbox',
    type: 'code',
    config: {
      script: 'return { hasProcess: typeof process !== "undefined", hasRequire: typeof require !== "undefined" };',
    }
  },
  execution: {},
  triggerContext: {},
  variables: {}
});
assert.equal(sandboxIsolationRes.status, 'completed');
assert.equal(sandboxIsolationRes.result.codeOutput.hasProcess, false);
assert.equal(sandboxIsolationRes.result.codeOutput.hasRequire, false);

const dosRes = await executeStep({
  node: {
    id: 'n_dos',
    type: 'code',
    config: {
      script: 'while(true) {}',
      timeoutMs: 200
    }
  },
  execution: {},
  triggerContext: {},
  variables: {}
});
assert.equal(dosRes.status, 'failed');
assert.ok(dosRes.error.includes('timed out') || dosRes.error.includes('Code execution failed'));
console.log('✅ VM sandbox security boundaries and execution timeout verified');

// 14. SSRF Defense & Outbound HTTP Protection
console.log('[TEST 14] SSRF Defense & Outbound HTTP URL Filtering');
assert.equal(isSafeOutboundUrl('http://169.254.169.254/latest/meta-data').safe, false, 'Cloud IMDS must be rejected');
assert.equal(isSafeOutboundUrl('http://127.0.0.1:4000/api').safe, false, 'IPv4 loopback must be rejected');
assert.equal(isSafeOutboundUrl('http://localhost:8080').safe, false, 'localhost must be rejected');
assert.equal(isSafeOutboundUrl('http://10.0.0.1/admin').safe, false, 'RFC1918 Class A must be rejected');
assert.equal(isSafeOutboundUrl('http://172.20.0.1/status').safe, false, 'RFC1918 Class B must be rejected');
assert.equal(isSafeOutboundUrl('http://192.168.1.1/').safe, false, 'RFC1918 Class C must be rejected');
assert.equal(isSafeOutboundUrl('file:///etc/passwd').safe, false, 'file protocol must be rejected');
assert.equal(isSafeOutboundUrl('ftp://ftp.example.com').safe, false, 'ftp protocol must be rejected');
assert.equal(isSafeOutboundUrl('https://api.stripe.com/v1/charges').safe, true, 'Valid HTTPS must be permitted');

const ssrfStepRes = await executeStep({
  node: {
    id: 'n_ssrf',
    type: 'http_request',
    config: {
      url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      method: 'GET'
    }
  },
  execution: {},
  triggerContext: {},
  variables: {}
});
assert.equal(ssrfStepRes.status, 'failed');
assert.ok(ssrfStepRes.error.includes('SSRF Security Error'), 'Step execution must fail closed on SSRF target');
console.log('✅ SSRF protection verified: cloud metadata & internal loopback targets blocked');

console.log('\n🎉 ALL 14 WORKFLOW ENGINE UNIT TESTS PASSED CLEANLY! 🎉');
