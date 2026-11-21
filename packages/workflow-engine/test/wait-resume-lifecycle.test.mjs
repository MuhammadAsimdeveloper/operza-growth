import test from 'node:test';
import assert from 'node:assert/strict';
import {
  walkGraph,
  VALID_EXECUTION_STATES,
  isValidExecutionState,
  isValidStateTransition,
  assertValidStateTransition,
  isTerminalState,
  isWaitingState,
  EXECUTION_STATES
} from '../src/engine.mjs';

test('execution-state: validates states, waiting flags, and terminal flags', () => {
  assert.equal(isValidExecutionState('waiting'), true);
  assert.equal(isValidExecutionState('resuming'), true);
  assert.equal(isValidExecutionState('enqueued'), true);
  assert.equal(isValidExecutionState('invalid_state'), false);

  assert.equal(isWaitingState('waiting'), true);
  assert.equal(isWaitingState('waiting_approval'), true);
  assert.equal(isWaitingState('waiting_webhook'), true);
  assert.equal(isWaitingState('running'), false);

  assert.equal(isTerminalState('completed'), true);
  assert.equal(isTerminalState('failed'), true);
  assert.equal(isTerminalState('canceled'), true);
  assert.equal(isTerminalState('dead_letter'), true);
  assert.equal(isTerminalState('waiting'), false);
  assert.equal(isTerminalState('resuming'), false);
});

test('execution-state: enforces valid state transition graph', () => {
  // Valid transitions
  assert.equal(isValidStateTransition('pending', 'enqueued'), true);
  assert.equal(isValidStateTransition('enqueued', 'running'), true);
  assert.equal(isValidStateTransition('running', 'waiting'), true);
  assert.equal(isValidStateTransition('waiting', 'resuming'), true);
  assert.equal(isValidStateTransition('resuming', 'completed'), true);
  assert.equal(isValidStateTransition('resuming', 'waiting'), true); // chained wait
  assert.equal(isValidStateTransition('resuming', 'failed'), true);
  assert.equal(isValidStateTransition('waiting', 'canceled'), true);

  // Self transitions (idempotent)
  assert.equal(isValidStateTransition('waiting', 'waiting'), true);
  assert.equal(isValidStateTransition('running', 'running'), true);

  // Invalid transitions
  assert.equal(isValidStateTransition('completed', 'running'), false);
  assert.equal(isValidStateTransition('completed', 'waiting'), false);
  assert.equal(isValidStateTransition('failed', 'resuming'), false);
  assert.equal(isValidStateTransition('waiting', 'completed'), false); // must resume first

  // assertValidStateTransition throws on invalid
  assert.throws(() => {
    assertValidStateTransition('completed', 'running');
  }, /Invalid workflow execution state transition/);

  assert.doesNotThrow(() => {
    assertValidStateTransition('waiting', 'resuming');
  });
});

test('walkGraph: pauses on wait node and calculates resumeNodeId', async () => {
  const nodes = [
    {
      id: 'step_1',
      name: 'Set Initial Variable',
      type: 'set_variable',
      config: { name: 'score', value: '100' },
      next: 'wait_node'
    },
    {
      id: 'wait_node',
      name: 'Wait 10 Minutes',
      type: 'wait',
      config: { durationMinutes: 10 },
      next: 'step_2'
    },
    {
      id: 'step_2',
      name: 'Follow Up Math',
      type: 'math',
      config: { operandA: 'score', operandB: 50, operation: 'add', resultVariable: 'finalScore' },
      next: null
    }
  ];

  const result = await walkGraph(nodes, {}, null, {});

  assert.equal(result.finalStatus, 'waiting');
  assert.ok(result.waitingStep);
  assert.equal(result.waitingStep.nodeId, 'wait_node');
  assert.equal(result.waitingStep.status, 'waiting');
  assert.ok(result.waitingStep.retryAt);
  assert.equal(result.resumeNodeId, 'step_2');
  assert.equal(result.variables.score, '100');
  assert.equal(result.timeline.length, 2);
  assert.equal(result.timeline[0].nodeId, 'step_1');
  assert.equal(result.timeline[1].nodeId, 'wait_node');
});

test('walkGraph: resumes from resumeNodeId without re-running wait node', async () => {
  const nodes = [
    {
      id: 'step_1',
      name: 'Set Initial Variable',
      type: 'set_variable',
      config: { name: 'score', value: '100' },
      next: 'wait_node'
    },
    {
      id: 'wait_node',
      name: 'Wait 10 Minutes',
      type: 'wait',
      config: { durationMinutes: 10 },
      next: 'step_2'
    },
    {
      id: 'step_2',
      name: 'Follow Up Math',
      type: 'math',
      config: { operandA: 'score', operandB: 50, operation: 'add', resultVariable: 'finalScore' },
      next: null
    }
  ];

  // Resuming with resumeNodeId = 'step_2' and initialVariables
  const resumed = await walkGraph(nodes, {}, null, {
    resumeNodeId: 'step_2',
    initialVariables: { score: 100 }
  });

  assert.equal(resumed.finalStatus, 'completed');
  assert.equal(resumed.variables.finalScore, 150);
  assert.equal(resumed.timeline.length, 1);
  assert.equal(resumed.timeline[0].nodeId, 'step_2');
  assert.equal(resumed.timeline[0].status, 'completed');
});

test('walkGraph: handles chained wait nodes sequentially', async () => {
  const nodes = [
    {
      id: 'node_1',
      type: 'set_variable',
      config: { name: 'phase', value: '1' },
      next: 'wait_1'
    },
    {
      id: 'wait_1',
      type: 'delay',
      config: { amount: 5, unit: 'minutes' },
      next: 'node_2'
    },
    {
      id: 'node_2',
      type: 'set_variable',
      config: { name: 'phase', value: '2' },
      next: 'wait_2'
    },
    {
      id: 'wait_2',
      type: 'delay',
      config: { amount: 15, unit: 'minutes' },
      next: 'node_3'
    },
    {
      id: 'node_3',
      type: 'set_variable',
      config: { name: 'phase', value: 'completed' },
      next: null
    }
  ];

  // Pass 1: start from beginning -> halts at wait_1
  const pass1 = await walkGraph(nodes, {}, null, {});
  assert.equal(pass1.finalStatus, 'waiting');
  assert.equal(pass1.waitingStep.nodeId, 'wait_1');
  assert.equal(pass1.resumeNodeId, 'node_2');
  assert.equal(pass1.variables.phase, '1');

  // Pass 2: resume from node_2 -> executes node_2, halts at wait_2
  const pass2 = await walkGraph(nodes, {}, null, {
    resumeNodeId: pass1.resumeNodeId,
    initialVariables: pass1.variables,
    initialTimeline: pass1.timeline
  });
  assert.equal(pass2.finalStatus, 'waiting');
  assert.equal(pass2.waitingStep.nodeId, 'wait_2');
  assert.equal(pass2.resumeNodeId, 'node_3');
  assert.equal(pass2.variables.phase, '2');
  assert.equal(pass2.timeline.length, 4); // node_1, wait_1, node_2, wait_2

  // Pass 3: resume from node_3 -> executes node_3, reaches completion
  const pass3 = await walkGraph(nodes, {}, null, {
    resumeNodeId: pass2.resumeNodeId,
    initialVariables: pass2.variables,
    initialTimeline: pass2.timeline
  });
  assert.equal(pass3.finalStatus, 'completed');
  assert.equal(pass3.variables.phase, 'completed');
  assert.equal(pass3.timeline.length, 5); // node_1, wait_1, node_2, wait_2, node_3
});
