# Canonical Entity & Data Ownership

- Authoritative ownership is defined in `CANONICAL_ENTITY_OWNERSHIP` (`packages/platform-core/src/cross-platform-events.mjs`):
  - **Contact / Opportunity / Invoice**: `location_records` (`(agency_id, location_id, id)`).
  - **Conversation / Support Ticket**: `conversations` & `support_tickets` (`(agency_id, location_id, id)`).
  - **Campaign**: `engagement_campaigns`.
  - **Workflow & Execution**: `workflow_definitions` + `workflow_versions` + `workflow_executions`.
  - **Integration Connection**: `integrations_connections`.
  - **AI Agent**: `ai_agents`.
  - **Order & Ledger**: `commerce_orders` & `commerce_ledger_entries`.
  - **Site Page & Customer Session**: `sites_pages` & `customer_portal_sessions`.
  - **Marketplace & Analytics**: `marketplace_installations` & `analytics_events`.
- Cross-module references use foreign keys / UUID references (`contact_id`, `conversation_id`, `workflow_id`) rather than duplicating mutable records.
