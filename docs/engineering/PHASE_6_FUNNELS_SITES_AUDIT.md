# Phase 6 — Funnels & Sites V2 Audit

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`

---

## 1. Current Implementation Inventory

| Area | Current State | Phase 6 Gap |
| --- | --- | --- |
| **Persistence (`packages/db/lib/funnels-repository.mjs`)** | Stores `websites` / `funnels` in `location_records` (`collection = 'websites'`) with `published` boolean and `pages` array. | No immutable `site_versions` snapshots, no draft vs. published isolation, no version rollback. |
| **API (`apps/api/routes/funnels.mjs`)** | Supports CRUD, `/api/funnels/public/:slugOrId`, opt-in, and 1-click upsell. | Public lookup reads mutable `body` directly; no SSR HTML endpoint with inline meta/OG/JSON-LD or cache invalidation by verified host + version. |
| **Editor (`apps/web/src/pages/Websites.tsx`, `Funnels.tsx`)** | Has page list, block editing, and preview. | Needs explicit Publish Version / Rollback controls and Custom Domain + SEO settings persistence. |
| **Custom Domains (`apps/api/routes/agency.mjs`)** | Legacy `/api/agency/branding/verify-domain` sets `isDomainVerified: true, sslActive: true` without DNS or SSL checks. | Must introduce dedicated `custom_domains` & `ssl_certificates` PostgreSQL tables, DNS TXT verification, duplicate-claim rejection, and ACME/TLS lifecycle. |
