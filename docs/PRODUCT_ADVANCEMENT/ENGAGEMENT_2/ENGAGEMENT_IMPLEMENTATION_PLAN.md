# Operza Growth — Engagement 2.0 Implementation Plan

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `4f565b2`

1. **Database Migration (`packages/db/migrations/046_engagement_2_0.sql`):**
   - Additive `conversations` columns (`priority`, `tags`, `unread_count`, `team_id`).
   - `engagement_conversation_notes`, `engagement_conversation_history`, `engagement_templates`, `engagement_campaigns`, `engagement_campaign_recipients`, `engagement_suppression_list`, and `engagement_journey_enrollments` — all with composite `(agency_id, location_id, id)` PKs, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
2. **Core Engine (`packages/platform-core/src/engagement-2-0.mjs`):**
   - Conversation lifecycle state machine & assignment/history rules.
   - Message status state machine (`draft` -> `queued` -> `submitted` -> `sent` -> `delivered` | `failed`, `inbound`).
   - AI Response Assistant (suggested reply, summary, intent/sentiment, KB citations, strict human-in-the-loop gate).
   - Template Manager & safe variable renderer (strict HTML/SMS/WhatsApp escaping, WhatsApp approval gating).
   - Consent, suppression, quiet hours (IANA timezone), and per-contact frequency capping.
   - Campaign Engine 2.0 (lifecycle, Smart List snapshot, bounded batching, permanent vs transient error classification).
   - Marketing Journeys (backed by Workflow Engine 2.0, deduplicated enrollment, exit on opt-out/goal).
   - Engagement Analytics 2.0 metric definitions.
3. **Repository & API (`packages/db/lib/engagement-2-repository.mjs`, `apps/api/routes/engagement2.mjs`):**
   - `TenantTx`-scoped operations mounted in `apps/api/routes/conversations.mjs` under `/api/engagement/v2/*`.
4. **Frontend Unified Engagement 2.0 Workspace (`apps/web/src/components/EngagementHub2Panel.tsx`):**
   - Integrated into `Conversations.tsx` & `Campaigns.tsx` with tabs for Unified Inbox 2.0, Campaigns, Templates, Journeys, Audience & Suppression, and Delivery Analytics.
5. **Testing & Documentation:**
   - `packages/platform-core/test/engagement-2-0.test.mjs`, full regression (`@operza/api`, `@operza/db`, `verify-ci-postgres.mjs`, `@operza/web` `typecheck` + `build`, `test-e2e.mjs`, `run-seo-checks.mjs`), and all 10 docs in `docs/PRODUCT_ADVANCEMENT/ENGAGEMENT_2/`.
