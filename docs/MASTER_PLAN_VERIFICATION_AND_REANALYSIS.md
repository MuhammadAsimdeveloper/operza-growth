# Operza Growth — Master Plan Verification & Re-Analysis Report

**Date:** November 22, 2026  
**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Current HEAD:** `afb61eb` (`feat/operza-agency-launch-readiness`)  
**Audited Artifacts:** `01_BRUTAL_AUDIT.md`, `02_MASTER_PLAN.md`, `03_FEATURE_SPECS.md`

---

## 1. Executive Summary & Verification Context

A critical assessment of the three uploaded documents was conducted against the live, running Operza repository:
1. **Audit Baseline Discrepancy:** The uploaded `01_BRUTAL_AUDIT.md` evaluated an earlier static snapshot (`operza-growth-main.zip`, 201 files, ~6,741 lines in `server.mjs`, 6 database migrations).
2. **Current Repository Evolution:** The active branch `feat/operza-agency-launch-readiness` has advanced through **32 migrations**, least-privilege PostgreSQL roles (`operza_app`, `operza_worker`) with strict `FORCE ROW LEVEL SECURITY`, durable execution leases, action receipt fencing with claim tokens, static prerendering across all 12 public marketing routes, and a passing 505-test verification suite.
3. **Confirmed Active Broken Features:** Despite these architectural advances in database safety and workflow leasing, several core product criticisms from the audit remain **completely true and active in the codebase today**. Specifically:
   - Public checkout accepts arbitrary requests and mints `status: 'paid'` orders with zero payment verification.
   - Outbound messaging (SMS and Email) in workflow actions is simulated with `console.log` and in-memory updates.
   - Webhook signature verification in Stripe and Twilio fails open if secret environment variables are absent.
   - QR code generation uses an FNV-seeded xorshift RNG generating pseudo-random squares that fail to scan.
   - Public endpoints (forms, checkout, booking) lack bot defenses (honeypots, time-to-submit validation).
   - Frontend state remains split between `localStorage` (`store.tsx` + `seed.ts`) and the server API.

---

## 2. Forensic Audit Matrix: Claims vs. Live Codebase Reality

| Finding | Audit Finding | Live Codebase Status (`afb61eb`) | Verdict |
|---|---|---|---|
| **C1: AI Copilot** | "Pile of regex branches, no LLM call anywhere" | `server.mjs` now connects to `CopilotService` with pluggable providers (`GeminiProvider`, `ClaudeProvider`, `OpenAIProvider`, `OllamaProvider`, `MockProvider`) and tool execution schemas in `packages/platform-core/src/copilot/`. | **Partially Addressed** (LLM architecture exists; requires verification of live provider keys vs mock fallback). |
| **C2: Messaging Simulation** | "Zero outbound calls to Twilio/SendGrid; console.log only" | `crmActions.sendEmail` and `crmActions.sendSms` in `server.mjs` (L1644–1710) write to `console.log` and append to `state.records.conversations`. No live HTTP dispatch occurs. | **CONFIRMED BROKEN** (P0 defect). |
| **C3: Free Checkout** | "`POST /api/payments/checkout/:slug` creates paid orders without processor" | `server.mjs` (L3641–3750) creates orders with `status: 'paid'`, generates fake payment tokens (`tok_...`), and marks invoices paid with no card verification or PaymentIntent. | **CONFIRMED BROKEN** (P0 critical security risk). |
| **C4: Fake Integrations** | "Integrations are a switch, fake Math.random() latency" | Fake latencies and pre-connected Stripe status were removed in Phase 32; unconfigured tests return `501 INTEGRATION_TEST_NOT_IMPLEMENTED`. Real credential vault/OAuth handshake remains incomplete. | **Improved, but Incomplete**. |
| **C5: API Keys Authenticate Nothing** | "No code path reads Bearer or x-api-key" | `resolveAuthSession` in `server.mjs` (L1408–1445) now authenticates `op_live_...` API keys by hash lookup, assigns tenant context, and updates `lastUsedAt`. | **FIXED** (Working in current branch). |
| **C6: Single JSON Blob & RLS decorative** | "Runtime truth is state in-memory; syncRelationalWrite swallows errors" | 32 migrations and RLS policies exist and are enforced under CI PostgreSQL. However, `server.mjs` still uses `operza_app_state` (JSON blob) as primary read/write cache for CRM entities. | **Partially Mitigated** (Dual-state architecture needs full normalization). |
| **C7: Fail-Open Security Defaults** | "Stripe and Twilio signature checks skipped when secret unset" | Lines 4583 & 4634 log a warning and process webhooks unverified when secrets are missing. Hardcoded `localhost:5173` CORS origins persist in SSE routes. | **CONFIRMED BROKEN** (P0 defect). |
| **C8: Compliance Theater** | "A2P transitions to VERIFIED_10DLC with no TCR call" | A2P status transitions are synthetic; automated enforcement of STOP/DND opt-out lists before workflow dispatches is incomplete. | **CONFIRMED ACTIVE**. |
| **C9: Unscannable QR Codes** | "`generateQrSvg()` draws pseudo-random squares seeded by hash" | `generateQrSvg()` (L342–365) uses an FNV-seeded xorshift RNG to plot SVG rects. It produces invalid, unscannable visual noise. | **CONFIRMED BROKEN** (P0 defect). |
| **C10: Marketing & Metric Exaggerations** | "README and docs report 100/100 and unbacked metrics" | Phase 32 scrubbed all fictional team members, 99.99% SLA, and unbacked SOC-2/HIPAA claims; however, root `package.json` keywords and descriptions require further cleanup. | **Largely Addressed in Phase 32**. |
| **M1: Frontend Split-Brain** | "`store.tsx` uses localStorage with `seed.ts` demo data" | `apps/web/src/lib/store.tsx` still manages state via local reducer; several pages do not query the server API. | **CONFIRMED ACTIVE** (P1 architecture goal). |

---

## 3. Re-Analysis of the Master Plan Architecture

The target architecture outlined in `02_MASTER_PLAN.md` is sound and aligns with enterprise requirements:
- **Modular Services:** Transitioning from monolithic `server.mjs` to Fastify/modular routers with Zod schema validation.
- **Relational Normalization:** Moving completely off `operza_app_state` blob onto the existing 32 PostgreSQL tables.
- **Durable Queue & Outbox:** Replacing in-memory intervals with dedicated workers consuming PostgreSQL outbox and Redis BullMQ queues.
- **Unified Frontend:** Replacing `localStorage` state with TanStack Query and typed API clients.

### Critical Execution Guardrails
To prevent disrupting the currently verified test suite (505 passing tests):
1. **Never Break Existing Test Contracts:** Every API change must maintain backward compatibility for existing regression tests or cleanly update tests with explicit behavioral guarantees.
2. **Stepwise Migration:** Follow the Master Plan's phased discipline. Execute Phase 0 immediately to make the system honest, secure, and fail-closed before undertaking broad structural re-platforming.

---

## 4. Phase 0 Work Breakdown & Immediate Action Plan

We will immediately begin building, enhancing, and repairing the broken features identified in Phase 0 ("Stop the lies"):

### Task 0.4: Kill Free Checkout & Enforce Payment Gateway Validation
- **Problem:** `POST /api/payments/checkout/:slug` creates `status: 'paid'` orders and invoices without any processor verification.
- **Action:** If no valid Stripe PaymentIntent / charge token is provided or if Stripe is not configured for the tenant, return `503 payments_not_configured` or `400 payment_verification_failed`. Never mark orders or invoices as `paid` on public ingress without verified gateway confirmation.

### Task 0.2: Fail-Closed Webhook Validation
- **Problem:** Stripe (`/api/webhooks/stripe`) and Twilio (`/api/webhooks/twilio`) skip signature checks when environment secrets are missing.
- **Action:** In production (and when webhook protection is enabled), missing webhook secrets or invalid signatures must immediately reject requests with `400` or `401 Unauthorized`.

### Task 0.3: CORS Hygiene & Boot Guards
- **Problem:** Hardcoded `http://localhost:5173` origins in SSE endpoints and missing strict origin validation.
- **Action:** Introduce an authoritative `corsFor(origin)` helper respecting `ALLOWED_ORIGINS` and `PUBLIC_BASE_URL`.

### Task 0.6: Honest Messaging Fail-Closed Handlers
- **Problem:** Workflows and CRM actions report success for SMS and Email when no provider credentials exist.
- **Action:** In `crmActions.sendEmail` and `sendSms`, check tenant provider configuration. If not configured, throw `ChannelNotConfigured` (`PROVIDER_NOT_CONFIGURED`) and mark workflow execution step as `failed` with clear diagnostics.

### Task 0.9: RFC-Compliant Scannable QR Code Generation
- **Problem:** `generateQrSvg` produces unreadable pseudo-random noise.
- **Action:** Implement standard QR code matrix generation (QR Code Model 2 with error correction level M) producing valid, scannable SVGs and add decoding/unit verification.

### Task 0.12: Bot Protection on Public Ingress
- **Problem:** Public form submit, booking, and checkout endpoints are vulnerable to automated spam and denial-of-service.
- **Action:** Implement honeypot fields and minimum time-to-submit verification across public endpoints.

---

## 5. Verification Gate for Phase 0
- [ ] No checkout request can mint a paid order without a verified payment processor.
- [ ] Forged or unsigned webhooks fail closed with 4xx errors.
- [ ] Workflow email/sms nodes fail honestly when credentials are missing.
- [ ] QR code endpoint returns valid, scannable SVG data verified by QR decoding logic.
- [ ] 100% test pass rate across existing unit, integration, and PostgreSQL test suites.
