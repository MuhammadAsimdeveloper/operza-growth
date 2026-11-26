# Phase 6 Preflight — Funnels/Sites V2, Calendar V2, Astro Marketing Site, SEO Engine & Custom Domains + SSL

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `be39d1d570ee3401c104d34d9e7ae0ffb1267a2f` (`be39d1d`)
**Working Tree:** Clean (`[ahead 11]`, not pushed)

---

## 1. Phase 5 Verification & Persistent Technical Debt Register

| Phase 5 Item | Current Verified Status | Remaining Limitation / Debt |
| --- | --- | --- |
| **Native `pgvector`** | Migration `037_phase5_ai_platform.sql` conditionally enables `vector` when available; local Windows PostgreSQL 18 lacks `vector.control` and uses `double precision[]` + `pg_trgm` GIN fallback. | Native `vector(1536)` + HNSW indexing is **not** active on this Windows host until `pgvector` binary is installed in the target PostgreSQL deployment. |
| **AI Provider Credentials** | `createAiProviderGateway()` reports `gemini`, `openai`, `anthropic` as `not_configured` without API keys; `local_embeddings` is `sandbox_verified`. | Live cloud LLM/embedding calls require tenant or platform API keys. |
| **Live Voice AI** | `createVoiceAiSessionManager()` verifies consent, HMAC tokens, incremental `stt_partial`/`tts_chunk` streaming, barge-in, and usage metering. | Live Twilio Media Streams WebSocket audio transport remains unverified without live Twilio credentials. |

---

## 2. Phase 6 Baseline & Scope

- **Funnels/Sites:** Currently backed by `FunnelsRepository` (`location_records` collection `'websites'`), `apps/api/routes/funnels.mjs`, and React pages `Websites.tsx` / `Funnels.tsx` / `PublicWebsite.tsx` / `PublicFunnel.tsx`. Lacks immutable published version snapshots, rollback, and server-side HTML SSR rendering.
- **Calendar:** Backed by `SchedulingRepository` (`calendars`, `appointments` with PostgreSQL GiST exclusion constraint in Migration 015) and `apps/api/routes/scheduling.mjs`. Needs Calendar V2 availability rules (buffers, min-notice, max future booking window, time-off blocks, DST/timezone validation).
- **Marketing Site:** Currently React marketing routes in `apps/web/src/pages/marketing/` + `scripts/prerender-public-routes.mjs`. No `apps/marketing` Astro workspace exists yet.
- **SEO Engine:** `scripts/seo-audit/run-seo-checks.mjs` (106 checks) validates static `apps/web/public/sitemap.xml`, `robots.txt`, `index.html`, and marketing pages. Needs multi-tenant per-domain `sitemap.xml`, `robots.txt`, canonical URLs, JSON-LD generation, and draft exclusion.
- **Custom Domains & SSL:** `apps/api/routes/agency.mjs` (`POST /api/agency/branding/verify-domain`) currently marks `isDomainVerified = true` and `sslActive = true` without DNS TXT ownership checks, cross-tenant duplicate prevention, or certificate provisioning. Phase 6 introduces real `custom_domains` and `ssl_certificates` PostgreSQL tables (`FORCE RLS`), DNS TXT challenge verification, ACME/provider SSL adapter lifecycle, and verified host routing.

---

## 3. Acceptance Criteria

1. Immutable site/funnel version snapshots (`draft` vs `published` + rollback) and server-side HTML rendering.
2. Calendar V2 availability rules (buffers, min notice, max window, time-off blocks, timezone/DST correctness) preserving GiST exclusion.
3. Standalone `apps/marketing` Astro static marketing site building cleanly with SEO metadata, JSON-LD, sitemap, and robots.
4. Multi-tenant SEO engine (`sitemap.xml`, `robots.txt`, canonical URLs, draft non-indexing).
5. Custom domain ownership verification (DNS TXT token, expiry, replay/duplicate prevention, hostname normalization) + SSL provisioning/renewal lifecycle + local TLS/HTTPS verification.
6. Multi-tenant public host routing that never trusts unverified `Host` headers or exposes drafts.
