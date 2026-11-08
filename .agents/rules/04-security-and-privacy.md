# Rule 04: Security, Privacy, and Execution Boundaries

## 1. Zero Trust & Boundary Isolation
- **Authentication & Tenant Isolation:** Every request to an API endpoint or internal worker task must be authenticated and bound to an active tenant (`agency_id` / `location_id`). Cross-tenant access is treated as a critical security vulnerability.
- **Fail Closed:** Missing, malformed, or unverified session tokens, API keys, or tenant contexts must fail immediately with `401 Unauthorized` or `403 Forbidden`.
- **Row-Level Security (RLS):** All tenant data access must pass through PostgreSQL RLS or explicit parameterized tenant isolation filters.

## 2. Secrets and Credential Protection
- **No Hardcoded Secrets:** Never hardcode API keys, passwords, JWT secrets, private certificates, or test credentials in source code, scripts, or test fixtures.
- **No Secret Leakage in Logs or Output:** Terminal output, build artifacts, test logs, error payloads, and execution history must never display raw credentials, authorization headers, or environment variables.
- **Vaulted Integrations:** Provider tokens (Stripe, Twilio, SendGrid, Meta, Google, OpenAI, Anthropic) must be encrypted at rest and accessed only by authorized backend adapters. Never leak integration credentials to the frontend browser application.

## 3. Provider Integrity & Outbound Safety
- **Lifecycle States:** Provider connections must strictly distinguish five distinct lifecycle states:
  1. `UNCONFIGURED`
  2. `PENDING_VERIFICATION`
  3. `VERIFIED`
  4. `DEGRADED`
  5. `REVOKED`
- **No Simulated Real Outcomes:** Never mark a mock or simulated delivery as a real production communication or transaction.
- **SSRF Prevention:** Prevent Server-Side Request Forgery. Workflow HTTP request nodes and webhook calls must validate target URLs against an allowlist of permitted protocols (`https:` only) and reject private/loopback/cloud-metadata IP ranges (`127.0.0.1`, `localhost`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254`).

## 4. AI Tool Governance and Permission Escalation
- **No Self-Granted Permissions:** An AI model or agent cannot grant itself permissions, broaden its scope, or bypass authorization checks.
- **Permission Ceiling:** AI agent capabilities are bounded by:
  1. Authenticated user role and permissions.
  2. Active location/agency entitlements.
  3. Registered tool schema and capability bounds.
  4. Action risk level (Low, Medium, High, Critical).
  5. Mandatory human approval gates for irreversible actions (e.g., bulk email dispatch, financial refunds, contact deletion).
- **Proposal-Only Mode:** Until verified authorization and execution primitives exist, AI agents operate in proposal-only mode for destructive or external state changes.

## 5. Sandboxed Test & Security Audit Execution
- Automated security testing and audit probes (via `security-audit`) must run within isolated environments:
  - Zero external network requests during test runs.
  - Read-only access to repository sources.
  - Write access isolated to temporary `scratch/` directories.
  - Never execute security probes against live production endpoints or customer environments.
