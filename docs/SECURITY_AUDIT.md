# Operza — Comprehensive Security Audit & Threat Modeling

## 1. Executive Summary

This security audit inspects Operza across the OWASP Top 10 web application vulnerabilities, multi-tenant isolation boundaries, cryptographic primitives, public webhook ingress authenticity, and client portal access controls.

---

## 2. Threat Modeling & Defense-in-Depth Analysis

### A01: Broken Access Control (Multi-Tenancy & Data Isolation)
- **Architecture**: Operza enforces multi-tenancy at both the application gateway layer and the relational database kernel.
- **Relational PostgreSQL RLS**:
  - Tables utilize `ALTER TABLE ... FORCE ROW LEVEL SECURITY;`.
  - Policies enforce:
    ```sql
    CREATE POLICY location_records_tenant_scope ON location_records
      USING (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid AND location_id = nullif(current_setting('app.location_id',true),'')::uuid)
      WITH CHECK (agency_id = nullif(current_setting('app.agency_id',true),'')::uuid AND location_id = nullif(current_setting('app.location_id',true),'')::uuid);
    ```
  - `set_config('app.agency_id', ..., true)` ensures settings are strictly scoped to the active transaction (`is_local = true`). Connection pool release automatically purges tenant scope.
  - Absence of tenant context causes policies to evaluate to `NULL` (fail-closed, returning 0 rows).
- **Application Layer Protection**:
  - In `apps/api/server.mjs`, all CRM modification endpoints (`POST /api/crm/:collection`, `PUT /api/crm/:collection/:id`) explicitly strip client-supplied `id`, `agencyId`, and `locationId` values, preventing tenant injection.
- **Verification**: Verified via `TEST 73: Cross-Tenant Injection Immunity`.

### A02: Cryptographic Failures
- **Password Hashing**: Derived via Node.js native `crypto.scrypt` with salt and high cost parameters.
- **Timing Attacks**: Token comparisons, CSRF verification, and webhook signature validations utilize `crypto.timingSafeEqual` over fixed-length buffers.
- **Session Tokens**: 256-bit cryptographically secure pseudorandom strings generated via `crypto.randomBytes(32).toString('hex')`.
- **Session Cookies**:
  - `HttpOnly`: Enabled (prevents JavaScript access).
  - `SameSite`: Set to `Lax` (session) and `Strict` (CSRF).
  - `Secure`: Enabled automatically when `NODE_ENV === 'production'` using `__Host-` cookie prefixes.

### A03: Injection (SQL & Command Injection)
- **Parameterized Queries**: PostgreSQL operations in `packages/db` and `apps/api` utilize parameterized SQL queries (`$1, $2, ...`). Zero raw string interpolation of user input.
- **JSON Storage Safe Writes**: JSON atomic persistence parses structured JavaScript primitives without executing dynamic evaluation code (`eval` is completely prohibited).

### A04: Insecure Design & Price Manipulation
- **Server-Side Price Authority**: Public checkouts, funnel opt-ins, and 1-click order bumps strictly recalculate totals on the backend using stored product records. Client-provided prices are ignored.
- **Webhook Replay Attacks**:
  - Stripe: Webhook timestamps are verified within a 300-second window.
  - Event ID deduplication cache (`webhookReplayCache`) prevents duplicate processing of replayed webhook events.

### A05: Security Misconfiguration
- **Security Headers**: Every HTTP response sets:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Cache-Control: no-store` (for authenticated/dynamic routes)
- **Container Hardening**:
  - Docker containers execute as unprivileged user `USER node` (UID 1000).
  - Production compose configuration specifies `security_opt: ["no-new-privileges:true"]`.

### A06: Vulnerable and Outdated Components
- Verified clean dependency tree with standard npm dependencies.
- Zero known high/critical CVEs in runtime dependencies.

### A07: Identification and Authentication Failures
- **Brute-Force Protection**: Sliding-window rate limiter restricts authentication attempts to 10–15 requests per minute per IP, returning HTTP 429 with `Retry-After`.
- **Client Portal**: Contacts must have explicit `portalAccess !== false` status; revoked contacts receive HTTP 403 Forbidden.

### A08: Software and Data Integrity Failures
- **Workflow Step Checksums**: Workflow executions generate SHA-256 state checksums to verify execution integrity between step hops.

### A09: Security Logging and Monitoring Failures
- **Request Correlation IDs**: Every request is assigned an `x-request-id` (generated or received) propagated to response headers and structured JSON log events.
- **Audit Logging**: Sensitive actions (role changes, deletions, webhook events) are written to `state.audit` / `agency_audit_events`.

### A10: Server-Side Request Forgery (SSRF)
- Outbound workflow webhooks validate destination URL protocols to restrict loopback/metadata endpoints.

---

## 3. Compliance Summary

| Security Control | Implementation Mechanism | Status |
|---|---|---|
| PostgreSQL RLS Fail-Closed | `FORCE ROW LEVEL SECURITY` with `set_config` transaction scope | **Compliant** |
| Session Hijacking Defense | `__Host-` prefixed `HttpOnly` `SameSite=Lax` cookies | **Compliant** |
| Cross-Site Request Forgery (CSRF) | Double-submit CSRF tokens with constant-time verification | **Compliant** |
| Cross-Site Scripting (XSS) | JSX string escaping; zero `dangerouslySetInnerHTML` | **Compliant** |
| Webhook Authenticity | HMAC-SHA256 (Stripe), HMAC-SHA1 (Twilio), Token Check (Meta) | **Compliant** |
| Webhook Replay Mitigation | 300s timestamp tolerance + 1hr sliding deduplication cache | **Compliant** |
| Rate Limiting & DoS Defense | In-memory sliding-window token limiter | **Compliant** |
| Least Privilege Containers | Non-root `node` user, read-only config mounts, no-new-privileges | **Compliant** |
