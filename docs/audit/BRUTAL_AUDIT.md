# OPERZA — BRUTAL ENGINEERING AUDIT & EVIDENCE REPORT

**Audit Date:** November 5, 2026  
**Auditor:** Principal Software Architect, Staff Full-Stack Engineer, Security Engineer, QA Lead  
**Target Repository:** `https://github.com/MuhammadAsimdeveloper/operza-growth`  
**Local Codebase:** `C:\Users\Muhammad Asim\.gemini\antigravity\scratch\operza`  
**Current Branch:** `release/production-launch` (Commit `ae80376`)  

---

## 1. Executive Summary & Audit Mandate

Previous audit logs and status documentation asserted high test pass rates and production readiness. However, under rigorous forensic inspection, multiple critical vulnerabilities, architectural anti-patterns, and simulation shortcuts were identified.

### High-Level Findings Summary:
1. **P0 — Fake Checkout & Order Paid Status:** Visitor submissions on checkout links immediately set order status to `'paid'` and opportunity status to `'won'` without any payment gateway session, authorization, or verified provider webhook.
2. **P0 — Webhook Backdoors & Signature Bypass:** Meta webhooks contained an explicit hardcoded backdoor challenge (`meta_chall_44`), Stripe webhooks defaulted to test secret `'whsec_test_secret'`, and missing signature headers were allowed in non-production or when environment variables were absent.
3. **P0 — Storage Architecture Illusion:** Despite comprehensive database migrations (`001` through `008`), the API server primarily executed in-memory against a single JavaScript state tree dumped into a JSONB column (`agency_tenant_states.payload`) and a local `data/store.json` file. RLS policies on normalized tables were largely bypassed on read operations.
4. **P0 — CSRF Token Mismatch & Incomplete Lifecycle:** The API required `x-operza-csrf` for mutating requests, but `/api/auth/session` omitted the token from its JSON payload, relying solely on client-side cookie parsing which fails across strict origins or non-credentialed fetch requests.
5. **P1 — Monolithic API Implementation:** `apps/api/server.mjs` spans 8,821 lines of code containing routing, business logic, DB queries, webhook handlers, and AI orchestration in a single monolithic file.
6. **P1 — Process-Local Rate Limiting:** Rate limiting relies on an in-memory `Map()`, providing zero distributed protection across multiple node instances.

---

## 2. Forensic Findings & Reproduction

### Finding AUD-01 (Severity: P0 — Critical)
**Module:** Public Checkout & Commerce Lifecycle  
**Affected Files:** `apps/api/server.mjs:2740-2808`  
**Reproduction Steps:**
1. Send a POST request to `/api/checkout/:slug` or public payment link endpoint with a dummy payload:
   ```json
   { "firstName": "Test", "lastName": "Buyer", "email": "buyer@example.test" }
   ```
2. Inspect the returned JSON and persisted order record in state.
3. **Observed Behavior:** Order is created with `status: "paid"`, `paidAt: "2026-11-05T..."`, invoice is created with `status: "paid"`, open CRM opportunity is marked `stage: "Won"`, and payment trigger workflows are fired immediately.
4. **Impact:** Complete failure of financial integrity. Anyone can trigger paid orders, win deals, and initiate fulfillment without spending a penny.
5. **Remediation:** Checkout must create orders in `pending` state with a provider session/intent ID. Orders must ONLY transition to `paid` upon verified webhook receipt (`checkout.session.completed` / `payment_intent.succeeded`).

---

### Finding AUD-02 (Severity: P0 — Critical)
**Module:** Webhook Ingress & Cryptographic Verification  
**Affected Files:** `apps/api/server.mjs:3428, 3501-3519, 3896, 3906, 3921-3930`  
**Reproduction Steps:**
1. Meta Webhook: Send a GET request to `/api/webhooks/meta?hub.mode=subscribe&hub.challenge=meta_chall_44`.
   - **Observed Behavior:** Returned HTTP 200 with challenge confirmed, completely bypassing verify token validation!
2. Meta Webhook POST: Send a forged message event without `X-Hub-Signature-256`. If `META_APP_SECRET` is unset, the code logs the message and creates a contact with fabricated fallback handle `@user_123`.
3. Stripe Webhook: `const secret = STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';` allows spoofing in non-strict environments.
4. Twilio Webhook: Skips signature check entirely if `TWILIO_AUTH_TOKEN` is unset, and calculates HMAC URL based on unverified `req.headers.host`.
5. **Impact:** Remote attackers can inject forged conversations, spoof customer SMS/WhatsApp messages, trigger workflows, and forge payment confirmations.
6. **Remediation:** Remove all backdoor challenges. In production, fail closed: reject any webhook that does not carry a valid cryptographic signature against a non-empty configured secret.

---

### Finding AUD-03 (Severity: P0 — Critical)
**Module:** Data Persistence & Tenant Isolation  
**Affected Files:** `apps/api/server.mjs:1068-1115`, `packages/db/lib/database.mjs`  
**Reproduction Steps:**
1. Inspect `saveState()` in `server.mjs`:
   ```javascript
   await client.query(
     `INSERT INTO agency_tenant_states (agency_id, payload, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (agency_id) DO UPDATE SET payload = EXCLUDED.payload...`
   );
   ```
2. Inspect `crm.list`:
   ```javascript
   const list = (state.records[collectionName] || []).filter(item => item.agencyId === agency.id);
   ```
3. **Observed Behavior:** Database tables created in migration `008` (contacts, companies, pipelines, orders, etc.) are largely ignored for read operations. The API acts as an in-memory cache synchronized to a JSON blob in PostgreSQL.
4. **Impact:** High memory overhead, lack of horizontal scalability, risk of split-brain state, inability to query relational data with standard SQL, and bypass of table-level RLS policies.
5. **Remediation:** Transition core entities to direct PostgreSQL relational queries using `withTenantTransaction(context, async (client) => ...)`. Keep the JSON file mode strictly for zero-config offline testing.

---

### Finding AUD-04 (Severity: P0 — Critical)
**Module:** CSRF Token Strategy & Session State  
**Affected Files:** `apps/api/server.mjs:762-775, 1159-1166, 4419-4430`, `apps/web/src/lib/api.ts:15-38`  
**Reproduction Steps:**
1. Call `/api/auth/session` after successful login.
2. Check response JSON payload: Contains `user`, `agency`, `locations`, `activeLocationId`, `role`. Contains **NO** `csrfToken`.
3. In browser environments where `document.cookie` cannot access `operza_csrf` (due to `SameSite=Strict`, subdomain boundaries, or mobile web views), mutating API calls fail with `403 Invalid or missing CSRF token`.
4. **Impact:** Random session lockouts for legitimate users, or temptation to disable CSRF checks.
5. **Remediation:** Return `csrfToken` explicitly in `/api/auth/session`, `/api/auth/login`, and `/api/auth/signup`. Provide a dedicated `/api/auth/csrf` refresh endpoint. Ensure API client stores and sends it via `x-operza-csrf`.

---

### Finding AUD-05 (Severity: P1 — High)
**Module:** Server Monolith & Maintainability  
**Affected Files:** `apps/api/server.mjs` (8,821 lines)  
**Reproduction Steps:** Review code organization.
- **Observed Behavior:** A single 8,821-line file handles HTTP routing, JSON persistence, BullMQ logic, A2P 10DLC registration, telephony, AI tools, and CRM CRUD.
- **Impact:** High merge conflict risk, near-impossible isolated unit testing, elevated cognitive load, and dangerous regression surface.
- **Remediation:** Refactor incrementally into domain modules under `apps/api/src/` (`routes/`, `middleware/`, `services/`, `repositories/`, `security/`).

---

### Finding AUD-06 (Severity: P1 — High)
**Module:** Distributed Rate Limiting & Proxy Trust  
**Affected Files:** `apps/api/server.mjs:274-279`  
**Reproduction Steps:**
- Rate limiting uses an in-memory `rateLimitStore = new Map()`.
- Client IP resolution relies on `req.headers['x-forwarded-for']` without validating trusted reverse proxy hops.
- **Impact:** Attackers can spoof `X-Forwarded-For` to bypass rate limits, and in clustered deployments, brute force limits are multiplied by the number of running nodes.
- **Remediation:** Back rate limiting with Redis `INCR` + `EXPIRE` when Redis is available, and configure an explicit `TRUSTED_PROXIES` allowlist.

---

### Finding AUD-07 (Severity: P3 — Low)
**Module:** Frontend Build & CSS Lint  
**Affected Files:** `apps/web/src/styles/app.css` (or `tokens.css`)  
**Reproduction Steps:** Run `npm run build`.
- **Observed Output:**
  `▲ [WARNING] "justifyContent" is not a known CSS property [unsupported-css-property]`
- **Remediation:** Fix camelCase `justifyContent` to `justify-content`.

---

## 3. Baseline Verification Commands & Evidence

| Command | Status | Output / Findings |
| :--- | :---: | :--- |
| `git status` | Clean | Branch `release/production-launch` at commit `ae80376` |
| `npm run typecheck` | Passed | `tsc -b --noEmit` exited code 0 cleanly |
| `npm test` | Passed | 14 Engine tests + 12 SEO checks + Auth/DB tests + 24 Copilot tests passed |
| `npm run build` | Passed | Vite 5.4.21 bundle built in 5.17s (1 minor CSS property warning) |
| `node scripts/dev.mjs` | Operational | API listening at port 4000, Vite at port 5173 |
