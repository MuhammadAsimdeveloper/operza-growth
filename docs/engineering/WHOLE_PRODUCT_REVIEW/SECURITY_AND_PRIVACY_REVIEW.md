# OPERZA WHOLE-PRODUCT AUDIT: SECURITY AND PRIVACY REVIEW

**Audit Date:** November 8, 2026
**Auditor Roles:** Principal Security Architect, Application Security Engineer, Privacy Officer
**Repository:** `MuhammadAsimdeveloper/operza-growth`
**Branch:** `feat/operza-unified-atlas-automation` (`389aae8`)
**Security Standards Evaluated:** OWASP Top 10 (2021), Cloudflare Security Architecture Standards, TCPA / GDPR Privacy Standards

---

## 1. Threat Model & Security Posture Overview

Operza is a multi-tenant enterprise business operating system handling sensitive communications, financial transactions, client PII, and automated background jobs. The system implements a **Defense-in-Depth** model across six distinct security perimeters:

```text
Perimeter 1: Network Edge & Rate Limiting (CORS, IP Throttling, Security Headers)
Perimeter 2: Identity & Session Management (Scrypt, HttpOnly Cookies, CSRF tokens)
Perimeter 3: Multi-Tenant Isolation & Authorization (RBAC, Scoped Context, Forced RLS)
Perimeter 4: Ingress Sanitization & SSRF Defense (DNS Pinning, Formula Escaping, ReDoS)
Perimeter 5: Governed AI Execution (Two-Phase Approvals, Credit Checks, Tool Sandbox)
Perimeter 6: Immutable Compliance & Audit Trail (PostgreSQL Trigger Blockers, TCPA Ledger)
```

---

## 2. In-Depth Evaluation Across Security Controls

### A. Authentication & Session Security
- **Password Hashing:** Implemented using Node's native `crypto.scrypt` with a random 16-byte salt per user and high work factors (`cost: 16384, blockSize: 8, parallel: 1`). Plaintext passwords are never logged or stored.
- **Session Tokens:** 32-byte cryptographically secure random session tokens (`randomBytes(32).toString('hex')`) stored with an SHA-256 hash in memory/database.
- **Cookie Security:** Sessions are transmitted exclusively via `Set-Cookie` with `HttpOnly; SameSite=Lax; Path=/` (`Secure` enabled when `NODE_ENV === 'production'`).
- **CSRF Defense:** Double-submit cookie pattern. The server sets an `operza_csrf` cookie and verifies that mutating requests (`POST`, `PUT`, `DELETE`) include matching `x-operza-csrf` request headers.
- **Rate Limiting:**
  - Public API routes: 300 requests per 60-second sliding window per IP.
  - Authentication endpoints (`/api/auth/*`): Strict limit of 10 requests per 60-second window per IP. Responds with HTTP `429 Too Many Requests` and `Retry-After` headers.

### B. Multi-Tenant Isolation & Row-Level Security (RLS)
- **Tenant Context Binding:** Every request resolves `agencyId` and `locationId` from the verified session. Incoming headers (`x-operza-location`) are validated to ensure the authenticated user holds an active membership in that location.
- **PostgreSQL Forced RLS:**
  - Migrations 001-014 enforce RLS across all tables:
    ```sql
    ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
    CREATE POLICY contacts_tenant_isolation ON contacts
      USING (agency_id = NULLIF(current_setting('app.current_agency_id', true), '')::uuid);
    ```
  - Using `FORCE ROW LEVEL SECURITY` guarantees that table owners and background processes cannot bypass tenant boundaries accidentally.
  - Cross-Tenant Injection Immunity is verified in Test 73 (`scripts/test-e2e.mjs`), where spoofed `agencyId` parameters in POST payloads are stripped and overwritten with the authenticated user's session agency ID.

### C. Server-Side Request Forgery (SSRF) Defenses
- **Protection Surface:** Workflow HTTP request nodes, Zapier outbound webhooks, and developer webhook deliveries.
- **Implementation (`packages/platform-core/src/ssrf-defense.mjs`):**
  - Resolves hostnames via `node:dns/promises.lookup` prior to initiating TCP connections.
  - Rejects private, loopback, link-local, and cloud metadata addresses:
    - `127.0.0.0/8` (Localhost loopback)
    - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 Private networks)
    - `169.254.169.254` (AWS/GCP/Azure instance metadata service)
    - `::1`, `fc00::/7`, `fe80::/10` (IPv6 loopback and unique local addresses)
  - Verified by dedicated unit tests (`packages/workflow-engine/test/workflow-ssrf-defense.test.mjs`).

### D. CSV Formula Injection Defense
- **Vulnerability:** User-controlled inputs in contacts or form submissions exported to CSV could execute arbitrary commands in Microsoft Excel or Google Sheets if prefixed with `=`, `+`, `-`, or `@`.
- **Implementation (`packages/platform-core/src/csv-transfer.mjs`):**
  - All spreadsheet cells are evaluated during CSV generation and import.
  - Cells beginning with unsafe formula trigger characters are automatically sanitized by prefixing with a single quote (`'`), neutralizing spreadsheet formula execution.
  - Verified in `packages/platform-core/test/csv-transfer.test.mjs`.

### E. AI Copilot Governance & Prompt Injection Defenses
- **Action Governance:** Copilot never executes data-mutating tools (e.g. creating contacts, deleting opportunities, triggering campaigns) directly in response to user chat.
- **Two-Phase Approval Gate:**
  1. AI chat generates a sandboxed **Proposal** with explicit parameters and expected impact.
  2. The proposal is deposited into `/copilot-inbox` and requires explicit human review and cryptographic authorization.
  3. Authoritative execution occurs only after human approval and credit verification against the billing ledger.
- **Credit Balance Check:** Tool execution fails closed with `INSUFFICIENT_CREDITS` if the agency balance is exhausted.

### F. Immutable Audit Log & Compliance
- **Database-Enforced Immutability:** Migration 014 installs PostgreSQL trigger functions preventing modification or deletion of audit logs:
  ```sql
  CREATE OR REPLACE FUNCTION prevent_audit_tampering()
  RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION 'Audit log entries are strictly immutable and cannot be updated or deleted.';
  END;
  $$ LANGUAGE plpgsql;
  ```
- **TCPA Consent Ledger:** Tracks customer communication opt-ins (`consent_records`) across SMS, WhatsApp, and Email. Outbox dispatch workers check consent status before initiating marketing dispatches.

---

## 3. Static Code & Secret Exposure Scan

An exhaustive static scan was executed across the entire repository to detect potential secrets, hardcoded API keys, and sensitive tokens:
- **Scan Result:** **0 Real Secrets Exposed**.
- **Test Fixtures:** One mock string (`xoxb-9812481928-1928491829`) was identified in `scripts/test-e2e.mjs:L3300`, which was verified as a synthetic Slack fixture for Test 77.
- **Private Keys:** Staging TLS certificates (`certs/`) are test self-signed certificates and strictly separated from production deployment configurations.

---

## 4. Security Findings & Recommendations

| Finding ID | Severity | Category | Description | Recommended Remediation |
|---|---|---|---|---|
| **SEC-01** | **P1 (High)** | Infrastructure | In-Memory / File-based media storage at `/api/media/upload` stores binary buffers without cloud antivirus/malware scanning. | Integrate AWS S3 / Cloudflare R2 bucket with pre-signed upload URLs and an asynchronous ClamAV/VirusTotal scan trigger before serving files. |
| **SEC-02** | **P2 (Medium)** | Network | WebRTC softphone STUN/TURN ICE servers currently use public Google STUN servers (`stun:stun.l.google.com:19302`) with no authenticated TURN relay. | Deploy an authenticated coturn instance or wire Twilio Network Traversal Service for clients behind restrictive enterprise NATs. |
| **SEC-03** | **P3 (Low)** | Cryptography | Local development uses fallback HMAC secrets (`operza_local_secret`) when `JWT_SECRET` environment variable is not explicitly provided. | Enforce startup crash in staging and production if `JWT_SECRET` is undefined or shorter than 32 characters. |
