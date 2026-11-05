-- Migration 007: Explicitly represent simulated workflow steps.
-- Simulated means the workflow prepared an external action without dispatching it.
-- It is intentionally a step state, not a terminal workflow-execution state.

ALTER TABLE workflow_execution_steps
  DROP CONSTRAINT IF EXISTS workflow_execution_steps_status_check;

ALTER TABLE workflow_execution_steps
  ADD CONSTRAINT workflow_execution_steps_status_check
  CHECK (status IN ('running', 'completed', 'simulated', 'failed', 'waiting_approval', 'skipped'));
