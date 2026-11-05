# OPERZA — IMPLEMENTATION ROADMAP & PHASE GATES

This roadmap guides the transition of Operza from its audited baseline into a production-hardened platform aligned with user requirements and the target Figma design (`Atlas-Desktop-Control-Center`).

---

## Phase 1: Security, Ingress & Financial Integrity (HIGHEST PRIORITY)
**Objective:** Eliminate all P0 vulnerabilities before modifying application layouts or adding UI features.

- [ ] **Milestone 1.1: Fix Checkout & Payment Lifecycle (AUD-01)**
  - Rewrite public checkout handler: Create orders with `status: 'pending'`, `paidAt: null`.
  - Introduce payment provider intent/session creation (Stripe/PayPal/mock adapter).
  - Mark order and invoice as `paid` ONLY upon receiving and validating an authentic provider webhook event.
  - Return clear status in UI: `pending_payment` with redirect or payment elements.
  - Regression test: Verify visiting checkout creates a pending order; verify unpaid order never triggers won deals or fulfillment workflows.

- [ ] **Milestone 1.2: Remove Webhook Backdoors & Harden Signatures (AUD-02)**
  - Remove backdoor challenge `meta_chall_44` from Meta webhook.
  - Remove fallback identity creation (`ig_user_123`, `@user_xxxx`).
  - Require valid HMAC SHA256 signatures for Meta webhooks.
  - Reject Stripe webhooks lacking valid `Stripe-Signature` or using fallback test secrets in production.
  - Validate Twilio canonical URL using configured public URL / host allowlist.
  - Regression test: Attempt forged Meta webhook challenge and verify HTTP 403; test valid signed webhook and verify HTTP 200.

- [ ] **Milestone 1.3: Repair CSRF Token Synchronization (AUD-04)**
  - Include `csrfToken` in JSON response for `/api/auth/session`, `/api/auth/login`, and `/api/auth/signup`.
  - Add `/api/auth/csrf` refresh endpoint.
  - Update `apps/web/src/lib/api.ts` to cache and provide token seamlessly.
  - Verify session token cookies retain `HttpOnly; SameSite=Lax; Path=/`.
  - Regression test: Perform authenticated POST requests with and without `x-operza-csrf`.

- [ ] **Milestone 1.4: Normalize PostgreSQL Persistence & RLS (AUD-03)**
  - Connect core CRM, Orders, Invoices, and Workflow entities to normalized SQL tables using `withTenantTransaction`.
  - Ensure failure to write to database fails the request in production rather than silently ignoring it.
  - Maintain JSON store mode strictly as a zero-config fallback for isolated offline developer testing.
  - Regression test: Multi-tenant cross-boundary isolation test verifying Tenant B cannot read or alter Tenant A's orders or contacts.

---

## Phase 2: Server Modularization & Real Service Adapters
**Objective:** Decompose monolithic `server.mjs` (8,821 lines) into modular controllers and services.

- [ ] **Milestone 2.1: Extract Domain Routes & Services**
  - Create `apps/api/src/routes/` (`auth.mjs`, `crm.mjs`, `webhooks.mjs`, `commerce.mjs`, `workflows.mjs`, `copilot.mjs`).
  - Create `apps/api/src/middleware/` (`csrf.mjs`, `authGuard.mjs`, `rateLimiter.mjs`, `errorHandler.mjs`).
  - Create `apps/api/src/services/` (`paymentService.mjs`, `telephonyService.mjs`, `notificationService.mjs`).
  - Ensure entry point `server.mjs` delegates cleanly to mounted route handlers.

- [ ] **Milestone 2.2: Distributed Rate Limiting**
  - Implement Redis atomic sliding window / token bucket rate limiter.
  - Configure trusted proxy header verification.

---

## Phase 3: Figma-Led UI Redesign (Atlas Desktop Control Center)
**Objective:** Transform frontend interface to match the user's Figma reference (`https://www.figma.com/design/PrrVxX6q5KIUtxlXLHSala/Atlas-Desktop-Control-Center`).

- [ ] **Milestone 3.1: Design Tokens & System Alignment**
  - Map colors, typography, elevations, border radii, and button/card styling from Atlas Control Center design.
  - Update `src/styles/tokens.css` and `src/styles/app.css` (fixing CSS lint warning `justifyContent`).
- [ ] **Milestone 3.2: Modernized AppShell & Navigation**
  - Implement clean control-center navigation with workspace switching, notifications, and search.
- [ ] **Milestone 3.3: Signature Workflow Automation Workspace**
  - Upgrade node canvas, palette, zoom/pan controls, inspector drawer, and live test execution preview.
- [ ] **Milestone 3.4: CRM & Commercial Dashboards**
  - Refresh contacts table, pipeline board, orders overview, and analytics screens.

---

## Phase 4: Quality Gates, Colab Research Notebooks & Release Verification
- [ ] **Milestone 4.1: Google Colab Research Notebooks**
  - Add `research/colab/operza_benchmark_analysis.ipynb`.
  - Add `research/colab/operza_synthetic_data.ipynb`.
- [ ] **Milestone 4.2: Automated Regression Suite & CI**
  - Verify `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e`, and `npm run test:seo`.
  - Ensure zero unresolved P0 defects.
- [ ] **Milestone 4.3: Git Commit & Remote Push**
  - Commit all changes incrementally with descriptive semantic commit messages.
  - Push branch to `https://github.com/MuhammadAsimdeveloper/operza-growth`.
