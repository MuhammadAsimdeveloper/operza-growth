# Operza Security Policy & Safety Boundaries

This document defines the mandatory security policies, isolation boundaries, and execution constraints enforced across the Operza platform.

---

## 1. Zero Trust Multi-Tenant Isolation

### The Tenant Boundary
- In Operza, multi-tenancy is not an application-layer afterthought; it is an infrastructure-enforced boundary.
- All persistent data belongs to a two-tier hierarchy: **Agency (`agency_id`)** and **Location (`location_id`)**.
- Any query, mutation, or background job that accesses customer data must possess a validated tenant context.
- **Fail Closed:** If a tenant context is missing, malformed, or unverified, the database or API must reject the operation immediately (`401 Unauthorized` / `403 Forbidden` / database exception).

### PostgreSQL Row-Level Security (RLS)
- Every tenant-scoped table in `packages/db` must enable PostgreSQL RLS:
  ```sql
  ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
  ```
- RLS policies must evaluate session context variables populated by backend middleware:
  ```sql
  CREATE POLICY contacts_tenant_isolation ON contacts
    FOR ALL
    USING (
      agency_id = NULLIF(current_setting('operza.current_agency_id', true), '')::uuid
      AND location_id = NULLIF(current_setting('operza.current_location_id', true), '')::uuid
    );
  ```
- Application code must never bypass RLS by querying with database superuser credentials.

---

## 2. Secrets & Credential Protection

1. **Zero Hardcoded Secrets:**
   - Source code, migration files, test fixtures, and scripts must never contain production or development secrets, passwords, API tokens, private keys, or webhook signing secrets.
2. **Environment Variable Hygiene:**
   - Secrets must be injected via runtime environment variables.
   - `.env` files must be listed in `.gitignore`.
   - Never print or dump environment variables to console logs, error traces, or reports.
3. **Integration Credential Encryption:**
   - Provider credentials (Stripe keys, Twilio auth tokens, Meta tokens) stored in the database must be encrypted at rest using AES-256-GCM.
   - Credential values must be decrypted only at the execution boundary immediately before making an authorized outbound request.

---

## 3. Outbound Request Safety & SSRF Prevention

Operza allows users to configure webhooks and HTTP request nodes in workflows. To prevent **Server-Side Request Forgery (SSRF)** attacks:

1. **Strict Protocol Allowlist:**
   - Only `https:` URLs are permitted. `http:`, `file:`, `ftp:`, `gopher:`, and other schemes are blocked.
2. **IP Range Blacklist & DNS Pinning:**
   - Outbound requests must never resolve to loopback, link-local, private, or cloud metadata addresses:
     - `127.0.0.0/8` (Loopback)
     - `10.0.0.0/8` (Private Class A)
     - `172.16.0.0/12` (Private Class B)
     - `192.168.0.0/16` (Private Class C)
     - `169.254.169.254` (Cloud Instance Metadata Service)
     - `::1`, `fc00::/7`, `fe80::/10` (IPv6 equivalents)
   - DNS must be validated immediately prior to establishing the TCP connection to prevent DNS rebinding attacks.

---

## 4. Provider Connection Integrity & Lifecycle

External service providers (Stripe, Twilio, SendGrid, Meta, Google) must strictly track connection status:

| State | Definition | Permitted Actions |
|---|---|---|
| `UNCONFIGURED` | No credentials or OAuth tokens present | Prompts user to configure integration |
| `PENDING_VERIFICATION` | Credentials submitted; connection handshake underway | Read-only ping test; no real production traffic |
| `VERIFIED` | Successful handshake and valid credential scope confirmed | Full authorized outbound actions permitted |
| `DEGRADED` | Provider returned rate limits (429) or temporary server errors (5xx) | Retry with exponential backoff; alert admin |
| `REVOKED` | Invalid credentials (401/403) or token expired/unauthorized | Halts all dependent workflow actions immediately |

**Anti-Simulation Rule:** Never present a simulated or mock outcome as a real delivery in customer-facing logs or dashboards.

---

## 5. AI Tool Governance & Action Permissions

AI Copilot and autonomous agents operating within Operza are subject to strict authorization controls:

1. **Permission Ceiling:**
   - An AI agent's permissions can never exceed the permissions of the authenticated user invoking the session.
   - Tools evaluate tenant boundary, user role, and location subscription tier before executing.
2. **Action Risk Classification:**
   - **Low Risk (Read-Only):** Fetching contacts, searching appointments, summarizing conversation history. Automatic execution allowed.
   - **Medium Risk (Reversible Writes):** Updating a contact tag, setting a task deadline, creating a draft email. Automatic execution with audit logging.
   - **High Risk (External State Mutation):** Sending an SMS, dispatching an email campaign, triggering a third-party webhook. Requires explicit human confirmation.
   - **Critical Risk (Irreversible Actions):** Issuing a refund, deleting contacts/pipelines, rotating API keys. **Mandatory human approval gate** with cryptographic token verification.
3. **Proposal-Only Mode:**
   - Until verified authorization contracts exist for a specific action, AI agents operate in proposal-only mode, presenting the intended payload to the user for review.

---

## 6. Sandboxed Security Audits & Testing

When running security audits using the `security-audit` skill:
- Inspection of target source code is strictly **read-only**.
- All audit processes must run locally without external network access.
- Any scratch files or temporary artifacts must be written to isolated `scratch/` directories outside of source control.
- Never execute penetration probes against live production systems, customer databases, or deployed endpoints.
