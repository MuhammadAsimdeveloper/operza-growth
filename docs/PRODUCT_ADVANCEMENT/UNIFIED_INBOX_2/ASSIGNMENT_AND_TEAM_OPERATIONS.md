# Assignment & Team Operations

- `support_teams` (`051_unified_inbox_support_2_0.sql`) models support teams, slugs, member IDs, and default SLA policies.
- `POST /api/support/v2/conversations/:id/assign` supports assigning/reassigning an agent, claiming unassigned conversations, unassigning, and transferring between teams.
- Concurrency safety: `SELECT ... FOR UPDATE` + `expectedVersion` check returns `409 ASSIGNMENT_VERSION_CONFLICT` if another operator updated the conversation concurrently.
- Every assignment change is recorded in `engagement_conversation_history` and emitted to the audit log.
