# Integration Architecture Audit — Product Advancement Stage 3

**Date:** 2026-11-26  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `b83eadb`

## 1. Baseline Triage (Pre-Existing Failures)
Reproduced before Stage 3 changes:
1. `apps/api/test/phase-2b-independent-verification.test.mjs` (`3.1 Concurrent verification`): 1 failure (`5 !== 9`, pre-existing race in OTP verification endpoint).
2. `apps/api/test/release-verification-gaps.test.mjs` (tests `3` & `4`): 2 failures (pre-existing `/api/workflows` response shape mismatch).
3. `packages/platform-core/test/provider-adapters.test.mjs` (`Stripe remains disabled`): 1 failure (`INVALID_CREDENTIAL_FORMAT !== PAYMENTS_DISABLED_PENDING_COMPLIANCE` because Phase 3 implemented Stripe sandbox credential validation).

These are pre-existing baseline behaviors unrelated to Stage 3 Integrations Hub 2.0.

## 2. Existing Integration Capabilities (Verified in Codebase)
- **Catalog & SDK (`packages/platform-core/src/connector-catalog.mjs`, `integration-sdk.mjs`):**
  - 22+ catalog entries (`slack`, `gmail`, `google_sheets`, `hubspot`, `stripe`, `shopify`, `airtable`, `mailchimp`, etc.).
  - `createIntegrationHubSdk` supports `register`, `validateConfig`, `testConnection`, `executeAction`, per-tenant in-memory rate limits, and idempotency caching.
- **Provider Adapters (`packages/platform-core/src/provider-adapters.mjs`):**
  - Real adapter implementations for `email.resend`, `email.sendgrid`, `sms.twilio`, `whatsapp.meta_cloud`, `payments.stripe`, and `zapier` with consent checks, timeouts (`AbortSignal.timeout(10_000)`), and `redirect: 'error'`.
- **Credential Vault & OAuth (`secret-vault.mjs`, `outlook-oauth.mjs`, `016`, `017`, `039`):**
  - AES-256-GCM envelope encryption (`v1:salt:iv:tag:ciphertext` via `scryptSync`), `provider_secrets` with `FORCE RLS`, `provider_oauth_states`, `oauth_clients`, `oauth_tokens`, and `marketplace_apps`/`marketplace_installations`.
- **SSRF Defense (`ssrf-defense.mjs`):**
  - Blocks loopback, RFC 1918, link-local (`169.254.0.0/16`), CGNAT, and IPv6 ULA/link-local addresses.
- **UI (`apps/web/src/pages/Integrations.tsx`):**
  - 2,067-line single-page UI with `UNIVERSAL_CONNECTORS` and `DEFAULT_MARKETPLACE_APPS`, using raw `useEffect` rather than TanStack Query and lacking sync conflict/webhook delivery/OAuth lifecycle management views.

## 3. Gaps & Risks Identified

| Area | Current State | Risk / Gap | Stage 3 Target |
| :--- | :--- | :--- | :--- |
| **Connector Contract & Readiness** | Mixed between `CONNECTOR_CATALOG` (`catalog_only`) and `provider-adapters.mjs` | No unified readiness taxonomy separating `implemented_adapter`, `unit_tested`, `sandbox_verified`, `production_configured`, and `live_verified`; no connector-to-Workflow-Node-Registry bridge | `connector-sdk-v2.mjs` with full lifecycle (`register`, `validate`, `connect`, `test`, `activate`, `refresh`, `pause`, `reconnect`, `disconnect`, `revoke`, `uninstall`), strict schemas, and Workflow 2.0 node export |
| **Database Persistence & RLS** | `provider_secrets` (`016`), `provider_oauth_states` (`017`), `marketplace_installations` (`039`) | No durable `integration_connections` table with `status` (`active`, `paused`, `expired`, `revoked`, `disconnected`), `vault_secret_ref`, or `expires_at`; no durable `integration_webhook_events` / `integration_webhook_deliveries` / `integration_sync_jobs` / `integration_sync_conflicts` tables | Migration `042_integrations_2_0.sql` with composite `(agency_id, location_id, id)` PKs, `FORCE RLS`, and `operza_app` + `operza_worker` grants |
| **OAuth & Credential Lifecycle** | `outlook-oauth.mjs` handles Outlook only | No generic OAuth 2.0 + PKCE (`S256`) + state HMAC/nonce + concurrent refresh lock + token rotation + revocation service for all OAuth connectors | `oauth-lifecycle-v2.mjs` supporting PKCE, strict redirect URI allowlisting, refresh concurrency protection, rotation, and terminal revocation |
| **Webhook Platform 2.0** | `server.mjs` handles inline routes (`7836`–`7999`) | No unified inbound signature + timestamp replay window + normalized event envelope + durable persistence; no outbound circuit breaker / dead-letter / secret rotation | `webhook-platform-v2.mjs` with HMAC-SHA256 timestamped verification, replay cache/DB deduplication, normalized event envelope, SSRF-safe outbound delivery, and circuit breaker |
| **Data Synchronization** | Calendar sync only | No general CRM/Sheets/HubSpot/Stripe sync engine with external ID mapping, loop prevention (`source_system` + `origin_event_id`), or conflict queue | `sync-engine-v2.mjs` with one-way/two-way sync, loop-prevention guards, field mapping, and explicit conflict queue |
| **API & UI** | Inline `server.mjs` handlers + monolithic `Integrations.tsx` | Business logic in route handlers; UI lacks dedicated tabs for Catalog, Connections (health/expiry/reconnect/disconnect), Webhooks, Sync/Conflicts, and Developer Specs | Modular `apps/api/routes/integrations2.mjs` + TanStack Query tabs in `Integrations.tsx` |
