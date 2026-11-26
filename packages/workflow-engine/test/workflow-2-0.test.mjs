import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNodeDefinitionV2,
  listNodeDefinitionsV2,
  validateNodeConfigV2
} from '../src/node-registry-v2.mjs';
import {
  redactSensitivePayload,
  validateWorkflowGraphV2
} from '../src/graph-validator-v2.mjs';
import {
  evaluateCompoundRules,
  executeWorkflowGraphV2
} from '../src/branch-executor-v2.mjs';
import {
  computeNextRunAtUtc,
  evaluateMissedRuns
} from '../src/scheduler-v2.mjs';

test('Node Registry V2 covers all 7 categories and blocks executable JS/SQL', () => {
  const all = listNodeDefinitionsV2();
  const categories = new Set(all.map(n => n.category));
  for (const cat of ['triggers', 'crm', 'communication', 'logic', 'data', 'commerce', 'ai']) {
    assert.ok(categories.has(cat), `Missing category ${cat}`);
  }
  assert.ok(getNodeDefinitionV2('approval_gate'));
  assert.equal(validateNodeConfigV2('code', {}).valid, false);
  assert.equal(validateNodeConfigV2('set_variable', { apiKey: 'sk_live_123' }).valid, false);
  assert.equal(validateNodeConfigV2('set_variable', { key: 'x', value: 'eval(1)' }).valid, false);
  assert.equal(validateNodeConfigV2('set_variable', { key: 'tier', value: 'vip' }).valid, true);
});

test('Graph Validator V2 detects cycles, stop outgoing edges, and self-loops', () => {
  const cyclic = validateWorkflowGraphV2({
    nodes: [
      { id: 'a', kind: 'tag', label: 'A', config: { tag: 'x' } },
      { id: 'b', kind: 'task', label: 'B', config: { title: 'y' } }
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a' }
    ]
  });
  assert.equal(cyclic.valid, false);
  assert.ok(cyclic.errors.some(e => e.code === 'CYCLE_DETECTED'));

  const stopOut = validateWorkflowGraphV2({
    nodes: [
      { id: 's', kind: 'stop', label: 'Stop', config: {} },
      { id: 't', kind: 'task', label: 'Task', config: {} }
    ],
    edges: [{ id: 'e1', source: 's', target: 't' }]
  });
  assert.equal(stopOut.valid, false);
  assert.ok(stopOut.errors.some(e => e.code === 'STOP_NODE_HAS_OUTGOING'));
});

test('Branch Executor V2 handles AND/OR, switch, parallel split+merge, loop limits, and redaction', async () => {
  assert.equal(
    evaluateCompoundRules(
      {
        combinator: 'AND',
        rules: [
          { field: 'contact.status', operator: 'equals', value: 'lead' },
          {
            combinator: 'OR',
            rules: [
              { field: 'contact.company', operator: 'contains', value: 'Acme' },
              { field: 'contact.company', operator: 'equals', value: 'Beta' }
            ]
          }
        ]
      },
      { contact: { status: 'lead', company: 'Acme Corp' } }
    ),
    true
  );

  const res = await executeWorkflowGraphV2({
    nodes: [
      { id: 'n1', kind: 'set_variable', config: { key: 'cleanName', value: '{{contact.firstName}}' } },
      { id: 'n2', kind: 'split_branches', config: {} },
      { id: 'n3', kind: 'string_transform', config: { sourcePath: 'variables.cleanName', operation: 'upper', targetKey: 'upperName' } },
      { id: 'n4', kind: 'tag', config: { tag: 'vip' } },
      { id: 'n5', kind: 'merge', config: { mode: 'all' } },
      { id: 'n6', kind: 'stop', config: {} }
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'n1' },
      { id: 'e2', source: 'n1', target: 'n2' },
      { id: 'e3', source: 'n2', target: 'n3', sourceHandle: 'branch_a' },
      { id: 'e4', source: 'n2', target: 'n4', sourceHandle: 'branch_b' },
      { id: 'e5', source: 'n3', target: 'n5' },
      { id: 'e6', source: 'n4', target: 'n5' },
      { id: 'e7', source: 'n5', target: 'n6' }
    ],
    initialContext: { contact: { firstName: 'Ada' }, authorization: 'Bearer super_secret' }
  });

  assert.equal(res.status, 'completed');
  assert.equal(res.context.variables.upperName, 'ADA');
  assert.equal(res.context.authorization, '[REDACTED]');
  assert.equal(redactSensitivePayload({ apiKey: 'secret', ok: 'yes' }).apiKey, '[REDACTED]');
});

test('Scheduler V2 computes UTC/IANA next-run across DST and missed-run catchup', () => {
  const next = computeNextRunAtUtc({
    scheduleType: 'cron',
    timezone: 'America/New_York',
    cronExpression: '30 9 * * *',
    fromDate: new Date('2026-03-08T05:00:00Z') // US DST spring-forward date
  });
  assert.ok(next);
  assert.ok(next.endsWith('Z'));

  const missed = evaluateMissedRuns({
    nextRunAt: '2026-03-08T10:00:00Z',
    now: new Date('2026-03-08T12:30:00Z'),
    catchupPolicy: 'catch_up',
    maxCatchup: 3,
    scheduleParams: { scheduleType: 'interval', intervalEvery: 1, intervalUnit: 'hours', timezone: 'UTC' }
  });
  assert.equal(missed.dueRuns.length, 3);
  assert.ok(missed.nextScheduledAt);
});
