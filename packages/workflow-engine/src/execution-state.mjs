// Execution state machine and validation for workflow runs

export const EXECUTION_STATES = Object.freeze({
  PENDING: 'pending',
  ENQUEUED: 'enqueued',
  RUNNING: 'running',
  RESUMING: 'resuming',
  WAITING: 'waiting',
  WAITING_APPROVAL: 'waiting_approval',
  WAITING_WEBHOOK: 'waiting_webhook',
  RETRY_SCHEDULED: 'retry_scheduled',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELED: 'canceled',
  DEAD_LETTER: 'dead_letter'
});

export const VALID_EXECUTION_STATES = Object.freeze(Object.values(EXECUTION_STATES));

export const TERMINAL_STATES = Object.freeze([
  EXECUTION_STATES.COMPLETED,
  EXECUTION_STATES.FAILED,
  EXECUTION_STATES.CANCELED,
  EXECUTION_STATES.DEAD_LETTER
]);

export const WAITING_STATES = Object.freeze([
  EXECUTION_STATES.WAITING,
  EXECUTION_STATES.WAITING_APPROVAL,
  EXECUTION_STATES.WAITING_WEBHOOK
]);

export const STATE_TRANSITIONS = Object.freeze({
  [EXECUTION_STATES.PENDING]: Object.freeze([
    EXECUTION_STATES.ENQUEUED,
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.FAILED
  ]),
  [EXECUTION_STATES.ENQUEUED]: Object.freeze([
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.RESUMING,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.FAILED
  ]),
  [EXECUTION_STATES.RUNNING]: Object.freeze([
    EXECUTION_STATES.WAITING,
    EXECUTION_STATES.WAITING_APPROVAL,
    EXECUTION_STATES.WAITING_WEBHOOK,
    EXECUTION_STATES.RETRY_SCHEDULED,
    EXECUTION_STATES.COMPLETED,
    EXECUTION_STATES.FAILED,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.DEAD_LETTER
  ]),
  [EXECUTION_STATES.WAITING]: Object.freeze([
    EXECUTION_STATES.RESUMING,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.FAILED
  ]),
  [EXECUTION_STATES.WAITING_APPROVAL]: Object.freeze([
    EXECUTION_STATES.RESUMING,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.FAILED
  ]),
  [EXECUTION_STATES.WAITING_WEBHOOK]: Object.freeze([
    EXECUTION_STATES.RESUMING,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.FAILED
  ]),
  [EXECUTION_STATES.RETRY_SCHEDULED]: Object.freeze([
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.ENQUEUED,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.FAILED,
    EXECUTION_STATES.DEAD_LETTER
  ]),
  [EXECUTION_STATES.RESUMING]: Object.freeze([
    EXECUTION_STATES.RUNNING,
    EXECUTION_STATES.WAITING,
    EXECUTION_STATES.WAITING_APPROVAL,
    EXECUTION_STATES.WAITING_WEBHOOK,
    EXECUTION_STATES.RETRY_SCHEDULED,
    EXECUTION_STATES.COMPLETED,
    EXECUTION_STATES.FAILED,
    EXECUTION_STATES.CANCELED,
    EXECUTION_STATES.DEAD_LETTER
  ]),
  [EXECUTION_STATES.COMPLETED]: Object.freeze([]),
  [EXECUTION_STATES.FAILED]: Object.freeze([]),
  [EXECUTION_STATES.CANCELED]: Object.freeze([]),
  [EXECUTION_STATES.DEAD_LETTER]: Object.freeze([])
});

export const OPERATOR_REQUEUE_STATES = Object.freeze([
  EXECUTION_STATES.FAILED,
  EXECUTION_STATES.DEAD_LETTER
]);

export function canOperatorRequeueState(state) {
  return OPERATOR_REQUEUE_STATES.includes(state);
}

export function isValidExecutionState(state) {
  return typeof state === 'string' && VALID_EXECUTION_STATES.includes(state);
}

export function isTerminalState(state) {
  return TERMINAL_STATES.includes(state);
}

export function isWaitingState(state) {
  return WAITING_STATES.includes(state);
}

export function isValidStateTransition(fromState, toState) {
  if (!isValidExecutionState(fromState) || !isValidExecutionState(toState)) {
    return false;
  }
  // Idempotent self-transition allowed only if explicitly transitioning to the same state
  if (fromState === toState) {
    return true;
  }
  const allowed = STATE_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.includes(toState));
}

export function assertValidStateTransition(fromState, toState) {
  if (!isValidStateTransition(fromState, toState)) {
    const error = new Error(`Invalid workflow execution state transition from '${fromState}' to '${toState}'`);
    error.code = 'INVALID_STATE_TRANSITION';
    error.fromState = fromState;
    error.toState = toState;
    throw error;
  }
}
