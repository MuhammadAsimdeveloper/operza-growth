# Operza Growth — Customer Engagement & Marketing Automation 2.0 Architecture Audit

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `4f565b2`

---

## 1. Existing Architecture Assessment

### 1.1 Conversations & Messaging (`034_conversations_and_messages.sql`, `conversations.mjs`, `Conversations.tsx`)
- **Database (`conversations`, `messages`):** Composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, `provider_message_id` and `idempotency_key` unique indexes, and `delivery_status` check constraints (`queued`, `processing`, `sent`, `delivered`, `failed`, `read`, `cancelled`).
- **Gaps:**
  - `conversations` lacks `priority`, `tags`, `unread_count`, `team_id`, and an auditable `conversation_history` / `conversation_notes` table.
  - `Conversations.tsx` still reads/writes via legacy `useStore()` instead of TanStack Query + Engagement 2.0 APIs, lacks internal notes, assignment history, AI summary/intent/sentiment, and clear AI-draft vs human-sent visual separation.

### 1.2 Communication Consents (`communication-consents-repository.mjs`, `consent-policy.mjs`)
- **Strengths:** Channel-specific (`email`, `sms`, `whatsapp`) and purpose-specific (`transactional`, `marketing`, `appointment`, `review_request`) consent records, `proofRef` enforcement, `recordInboundOptOut` for `STOP` keywords.
- **Gaps:** No centralized suppression list table, no agency-timezone quiet hours enforcement, no per-contact frequency capping across overlapping campaigns/journeys.

### 1.3 Campaigns, Templates & Journeys (`Campaigns.tsx`, `Templates.tsx`, `workflows2.mjs`)
- **Gaps:**
  - `Campaigns.tsx` & `Templates.tsx` still sync into `useStore()`. No campaign approval lifecycle (`draft -> ready_for_review -> approved -> scheduled -> sending -> paused -> completed/failed/cancelled`), no Smart List audience snapshot, no per-recipient durable delivery state, and no WhatsApp template approval state enforcement.
  - Marketing journeys need explicit enrollment deduplication, goal/exit handling, and frequency limits built directly on top of **Workflow Engine 2.0** (not a duplicate scheduler).

### 1.4 Forms, Funnels & Analytics (`forms.mjs`, `funnels.mjs`, `analytics-2-0.mjs`)
- **Strengths:** Forms (`035`), Funnels (`funnels-repository.mjs`), and Analytics 2.0 (`045_analytics_2_0.sql` with `UNIQUE (agency_id, location_id, source_module, deduplication_key)`).
- **Gaps:** Engagement-specific metrics (first response time, resolution time, delivery vs engagement vs conversion, campaign audience/eligible/delivered/bounce/unsubscribe) need formal numerator/denominator definitions in Analytics 2.0.
