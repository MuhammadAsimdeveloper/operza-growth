# Integrations Hub 2.0 — Implementation Plan

**Date:** 2026-11-26  
**Stage:** Product Advancement Stage 3

## 1. Implementation Phases
1. **Database Schema & RLS (`packages/db/migrations/042_integrations_2_0.sql`):**
   - `integration_connections`: `(agency_id, location_id, id)` with `connector_id`, `account_label`, `auth_strategy`, `status` (`pending`, `active`, `paused`, `expired`, `revoked`, `disconnected`), `readiness_level`, `vault_secret_ref`, `granted_scopes`, `token_expires_at`, `last_tested_at`, `last_error_code`, `circuit_state`.
   - `integration_webhook_endpoints`: Outbound/inbound webhook registrations with `signing_secret_ref`, `event_subscriptions`, `status`, `failure_count`, `circuit_open_until`.
   - `integration_webhook_events`: Durable inbound/outbound normalized event envelope with `UNIQUE (agency_id, location_id, provider, provider_event_id)` for idempotent deduplication, `processing_state` (`received`, `normalized`, `delivered`, `failed`, `dead_letter`).
   - `integration_sync_jobs` & `integration_sync_conflicts`: Controlled 1-way/2-way sync state, external ID mappings, loop-prevention markers, and conflict resolution queue.
   - `FORCE ROW LEVEL SECURITY` + `operza_app` / `operza_worker` grants on all 5 tables.
2. **Core Platform Engines (`packages/platform-core/src/`):**
   - `connector-sdk-v2.mjs`: Unified Connector SDK 2.0 with explicit readiness levels (`implemented_adapter`, `unit_tested`, `sandbox_verified`, `production_configured`, `live_verified`), full lifecycle, rate-limit/retry/circuit-breaker policy, and Workflow Node Registry 2.0 exporter.
   - `oauth-lifecycle-v2.mjs`: Generic OAuth 2.0 + PKCE (`S256`), strict redirect URI validation, single-use state consumption, concurrent refresh locking, token rotation, and terminal revocation.
   - `webhook-platform-v2.mjs`: Inbound HMAC-SHA256 + timestamp replay window (`300s`) + payload size guard + normalized event envelope + SSRF-safe outbound signed dispatch with exponential backoff.
   - `sync-engine-v2.mjs`: Loop-safe 1-way/2-way CRM/Sheets/HubSpot/Stripe sync engine with external ID tracking and conflict queue.
3. **Repository & API (`packages/db/lib/integrations-2-repository.mjs`, `apps/api/routes/integrations2.mjs`):**
   - Strictly `TenantTx`-scoped persistence and modular HTTP router mounted in `apps/api/routes/system.mjs` or `server.mjs`.
4. **Frontend Integrations Hub 2.0 (`apps/web/src/pages/Integrations.tsx`):**
   - Clean tabbed workspace (Catalog, Connections, Webhooks, Sync & Conflicts, Developer Specs) powered by TanStack Query.
5. **Verification & Documentation:**
   - Comprehensive unit, OAuth, webhook, sync, security, E2E, and real PostgreSQL `FORCE RLS` tests.
