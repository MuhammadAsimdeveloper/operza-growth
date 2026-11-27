# Workflow & Integration Events

- `buildSupportWorkflowEvent` (`unified-inbox-2-0.mjs`) validates event types (`conversation.created`, `conversation.inbound_message`, `conversation.assigned`, `conversation.priority_changed`, `conversation.resolved`, `ticket.created`, `ticket.reopened`, `sla.approaching_breach`, `sla.breached`, `customer.replied`).
- Generates deterministic `idempotencyKey` (`sup_<sha256>`) and enforces `loopDepth <= 3` (`WORKFLOW_LOOP_PREVENTED`) to prevent infinite workflow loops.
- Channel adapters distinguish implementation readiness from live provider connections; external messaging remains disabled in local tests (`OPERZA_LIVE_MESSAGING !== 'true'`).
