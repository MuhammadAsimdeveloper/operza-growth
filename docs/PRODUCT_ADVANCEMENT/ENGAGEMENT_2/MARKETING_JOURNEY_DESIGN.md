# Engagement 2.0 — Marketing Journeys Design

- **Single Runtime Principle:** Marketing journeys reuse **Workflow Engine 2.0** (`041_workflows_2_0.sql`, `workflows-2-repository.mjs`, `branch-executor-v2.mjs`, `scheduler-v2.mjs`) rather than creating a parallel scheduler.
- **Enrollment Deduplication:** `engagement_journey_enrollments` enforces `UNIQUE (agency_id, location_id, journey_key, contact_id)` and links `workflow_id` + `execution_id`, tracking `active`, `paused`, `completed`, `exited_goal`, `exited_opt_out`, `cancelled`, and `failed` states.
