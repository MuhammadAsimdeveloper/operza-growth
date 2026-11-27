# Support Tickets & Lifecycle

- `support_tickets` (`051_unified_inbox_support_2_0.sql`) links directly to `conversations`, `contacts`, `opportunities`, and `appointments` via composite tenant-scoped relationships (`FORCE ROW LEVEL SECURITY`).
- State machine (`TICKET_TRANSITIONS` / `CONVERSATION_TRANSITIONS` in `unified-inbox-2-0.mjs`) enforces valid transitions across `open`, `pending`, `waiting_on_customer`, `waiting_on_internal`, `resolved`, and `closed`, and supports reopening (`reopened_count` incremented).
- Tickets track `ticket_number`, `subject`, `description`, `priority`, `category`, `assigned_to`, `team_id`, `resolution_summary`, `resolved_at`, `closed_at`, and `version`.
