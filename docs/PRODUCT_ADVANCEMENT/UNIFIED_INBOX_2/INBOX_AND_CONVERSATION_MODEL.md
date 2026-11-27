# Inbox & Conversation Model

- Extends `conversations` (`034_conversations_and_messages.sql`, `046_engagement_2_0.sql`) via `051_unified_inbox_support_2_0.sql` with `waiting_on_customer`, `waiting_on_internal`, optimistic concurrency `version`, `assigned_agent_name`, `first_response_at`, `resolved_at`, `closed_at`, and SLA tracking columns.
- Server-side paginated and filtered `GET /api/support/v2/conversations` supports `view` (`all`, `assigned_to_me`, `unassigned`, `open`, `pending`, `waiting_on_customer`, `resolved`, `closed`, `high_priority`, `overdue_sla`, `team_queue`), `priority`, `channel`, `teamId`, `assignedTo`, `slaStatus`, `tag`, and `search`.
- Channel abstraction (`resolveChannelConnectionStatus`) honestly reports `connected`, `pending_approval`, `not_configured`, `disconnected`, `temporarily_unavailable`, or `sending_disabled` per channel without simulating live external delivery.
- Inbound and outbound messages deduplicate via `(provider, provider_message_id)` and `idempotency_key`.
