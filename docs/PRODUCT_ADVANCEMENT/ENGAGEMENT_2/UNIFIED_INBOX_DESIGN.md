# Engagement 2.0 — Unified Inbox & AI Response Assistant Design

- **Lifecycle States:** `open`, `assigned`, `pending`, `resolved`, `archived` (`canTransitionConversation`).
- **Auditable History & Notes:** `engagement_conversation_history` records every status, assignment, and priority transition; `engagement_conversation_notes` stores internal agent notes under `FORCE RLS`.
- **Message Delivery States:** `draft` -> `queued` -> `submitted` -> `sent` -> `delivered` | `failed`, plus `inbound`. `canTransitionMessageState(..., { viaProviderCallback })` blocks marking any message `delivered` without a verified provider callback.
- **AI Response Assistant:** `generateAiInboxSuggestion` provides intent classification, sentiment, summary, KB citations, and suggested reply, always tagged `isAiSuggestion: true` and `requiresHumanApproval: true` unless an explicit automation policy is enabled (and opt-out requests always require human confirmation).
