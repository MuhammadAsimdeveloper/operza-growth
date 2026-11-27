# Operza Growth — Customer Portal & Self-Service 2.0 Architecture Audit

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Starting Commit:** `3fc662d`

---

## 1. Existing Portal Assessment (`PublicPortal.tsx`, `ClientPortal.tsx`, `payments.mjs`)

- **Critical Security & Identity Gaps:**
  - `PublicPortal.tsx` routes by `/portal/:contactId` without a cryptographically verified agency-scoped customer session (`customer_portal_sessions`), risking IDOR if an endpoint relies on guessable contact IDs.
  - `PublicPortal.tsx` collects raw `cardNumber`/`expiry`/`cvc` inputs in local state instead of deferring exclusively to provider-hosted payment links/flows.
- **Missing Multi-Agency & Governance Capabilities:**
  - No `customer_portal_configs` table for agency-controlled branding, feature toggles, or field-level profile edit policies.
  - No hashed single-use `customer_portal_magic_links` or agency-scoped `customer_portal_sessions`.
  - No `customer_portal_requests` self-service approval workflow (preventing customers from directly triggering refunds, cancellations, or restricted CRM edits).
  - No `customer_portal_events` privacy-aware analytics or internal-note filtering boundary for conversations.
