# Phase 7 Preflight — SaaS Mode, White-Label, Marketplace, Reporting, Public API, OAuth Apps, PWA & Platform Administration

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `f24ef4f1d8334347dc2a9bf3b17274a98d8a17d6` (`f24ef4f`)
**Working Tree:** Clean (`[ahead 12]`, not pushed)

---

## 1. Phase 6 Verification & Release-Readiness Carryover

- **Phase 6 Verified:** `site_versions`, `custom_domains`, `ssl_certificates`, `calendar_availability_rules` (Migration `038`), `apps/marketing` Astro static site, multi-tenant SEO (`sitemap.xml`, `robots.txt`, canonicals), and Calendar V2 DST/availability rules are committed and tested.
- **Preserved Deployment Limitations:**
  - Live public DNS propagation & live ACME/edge TLS termination require production hosting configuration (automated tests use deterministic DNS/TLS fixtures).
  - Native `pgvector` binary is absent on local Windows PostgreSQL 18 (using `double precision[]` + `pg_trgm` fallback).
  - Gemini/OpenAI/Anthropic API keys and live Twilio Media Streams transport remain unconfigured in this local environment.

---

## 2. Phase 7 Scope & Gaps Identified

1. **SaaS Subscriptions & Entitlements:** `entitlements.mjs` defines plan limits/features, but lacks persistent PostgreSQL `saas_subscriptions` lifecycle (`trialing`, `active`, `past_due`, `paused`, `cancelled`, `expired`), atomic seat/location limit checks, and server-side subscription enforcement.
2. **White-Label:** `Branding.tsx` & `/api/agency/branding` exist; must integrate cleanly with Phase 6 verified `custom_domains`, agency owner/admin RBAC, and tenant isolation.
3. **Marketplace:** `connector-catalog.mjs` & `integration-sdk.mjs` exist, but lack `marketplace_apps` review/approval lifecycle and `TenantTx` `marketplace_installations` with credential revocation on uninstall.
4. **Public API & OAuth Platform:** `/api/v1/zapier/*` and bearer API keys exist, but lack a full OAuth 2.0 Authorization Code + PKCE application platform (`oauth_apps`, single-use `oauth_auth_codes`, hashed `oauth_tokens` with refresh rotation & replay detection) and versioned `/api/v1/public/*` contracts.
5. **Platform Administration & Reporting:** `/api/admin/*` already enforces 403 for agency owners (`routes/system.mjs`), and needs platform-admin agency/subscription/marketplace/audit endpoints plus tenant-isolated SQL reporting aggregates.
6. **PWA:** `manifest.json` exists in `apps/web/public/`, but lacks a versioned Service Worker (`sw.js`) with strict cache-isolation (never caching `/api/*` authenticated responses and purging caches on logout/agency switch).
