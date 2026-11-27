# Unified Inbox & Customer Support 2.0 — Architecture & Gap Audit

**Stage:** Product Advancement Stage 15 — Unified Inbox & Customer Support 2.0
**Branch:** `feat/operza-agency-launch-readiness`
**Starting Commit:** `b00e7b6`

---

## 1. Existing Architecture Inventory

1. **Conversations & Messages (`034_conversations_and_messages.sql`, `packages/db/lib/conversations-repository.mjs`)**
   - `conversations` table with composite tenant PK `(agency_id, location_id, id)`, `FORCE ROW LEVEL SECURITY`, `channel` (`sms`, `email`, `whatsapp`, `meta`, `webchat`, `voice`, `other`), `status`, `assigned_to`, `last_message`, `last_message_at`.
   - `messages` table with `direction` (`inbound`, `outbound`), `sender_type` (`agent`, `contact`, `bot`, `system`, `campaign`), `delivery_status`, `provider`, `provider_message_id`, `idempotency_key`, and unique indexes on `(agency_id, location_id, provider, provider_message_id)` and `(agency_id, location_id, idempotency_key)`.
2. **Engagement 2.0 Extensions (`046_engagement_2_0.sql`, `packages/db/lib/engagement-2-repository.mjs`, `apps/api/routes/engagement2.mjs`)**
   - Extended `conversations` with `priority` (`low`, `normal`, `high`, `urgent`), `tags`, `unread_count`, `team_id`.
   - Added `engagement_conversation_notes` (internal-only notes) and `engagement_conversation_history` (assignment/status/priority/tag audit history).
   - Added `engagement_templates` and `/api/engagement/v2/inbox/ai-assist`.
3. **CRM, Customer 360, Portal, AI & Outbox**
   - `contacts`, `opportunities`, `appointments`, `orders`, `invoices`, `communication_consents`, `customer_portal_requests`.
   - `packages/platform-core/src/ai/model-router-v2.mjs` & `redactSensitivePayload` (`graph-validator-v2.mjs`).
   - `packages/platform-core/src/outbox-producer.mjs` for durable idempotent workflow events.
4. **Frontend (`apps/web/src/pages/Conversations.tsx`)**
   - Client-side filtered conversation list (`all`, `unread`, `starred`), local `useStore()` state, basic reply composer, and WebSocket listener.

---

## 2. Identified Gaps for Stage 15

1. **Conversation Lifecycle & Support Semantics**: `conversations.status` only allows `('open', 'pending', 'resolved', 'closed', 'archived')`; lacks `'waiting_on_customer'` and `'waiting_on_internal'` plus optimistic concurrency (`version` column) for assignment & state transitions.
2. **Support Teams, Tickets, SLA Policies & Saved Replies**: No `support_teams`, `support_tickets`, `sla_policies`, `support_saved_replies`, or `support_saved_views` tables with `FORCE ROW LEVEL SECURITY`.
3. **Server-Side Inbox Views, Search & Pagination**: `Conversations.tsx` filters client-side; needs server-side paginated endpoints (`/api/support/v2/conversations`) supporting views (`all`, `assigned_to_me`, `unassigned`, `open`, `pending`, `waiting_on_customer`, `resolved`, `closed`, `high_priority`, `overdue_sla`, `team_queue`) and search.
4. **Channel Adapter Honesty & Connection Status**: Needs explicit per-channel connection status (`connected`, `pending_approval`, `not_configured`, `disconnected`, `temporarily_unavailable`, `sending_disabled`) derived from `integrations_connections` / provider configuration rather than assuming live delivery.
5. **Customer 360 & Support Dashboard**: Needs permission-gated Customer 360 aggregation (CRM profile, opportunities, appointments, invoices/orders only with `billing:read`/`payments:read`, consent, tickets) and real-data SLA/support performance metrics.
6. **AI Support Governance & Workflow Events**: Needs structured AI draft/summary/intent/priority/category/KB suggestion with explicit human-approval-required flag, secret redaction, and durable outbox event emission (`support.*` / `conversation.*`) with loop protection.
7. **Pre-existing Web TypeScript Errors**: `CommerceHub2Panel.tsx`, `EngagementHub2Panel.tsx`, `PortalHub2Panel.tsx`, `SitesHub2Panel.tsx` fail `tsc -b` due to `SectionCard` missing `style` prop and `EmptyState` requiring `icon`.
