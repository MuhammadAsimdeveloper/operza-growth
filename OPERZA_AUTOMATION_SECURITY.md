# Operza Workflow Automation Security & Multi-Tenancy Architecture

## 1. Threat Model & Security Posture

Operating an enterprise workflow automation platform requires robust defenses against remote code execution, server-side request forgery (SSRF), credential theft, cross-tenant data leakage, and denial-of-service loops.

---

## 2. Security Defense Layers

### A. Strict Multi-Tenant Isolation
* **Scoping:** Every workflow definition, execution record, step result, credential, and queue message is bounded strictly by `agency_id`.
* **Zero Cross-Tenant Leakage:** If Tenant A attempts to read or execute a workflow belonging to Tenant B, the API returns a strict HTTP 404 (Not Found) without confirming the record's existence.
* **WebSocket Boundary:** Real-time event broadcasts are filtered at the connection level to sessions sharing the exact `agency_id`.

### B. SSRF (Server-Side Request Forgery) Protection
* **Blacklisted IP Ranges:** The HTTP Request node and Webhook Dispatcher validate target hostnames before socket connection:
  * `127.0.0.0/8` (Localhost)
  * `169.254.169.254` (AWS/Cloud Instance Metadata Service)
  * `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 Private Networks)
  * `::1`, `fc00::/7` (IPv6 loopback & unique local addresses)
* In cloud production environments, outbound requests route through dedicated egress proxies with DNS pinning to prevent DNS rebinding attacks.

### C. Sandboxed Code Execution
* User-provided JavaScript transformations are executed within isolated execution scopes.
* Direct access to global process primitives (`process`, `require`, `fs`, `child_process`, `net`, `eval`, `Function`) is strictly restricted.
* Maximum script execution timeout is strictly enforced (default: 500ms) to prevent CPU starvation loops.

### D. Webhook Replay & Ingress Protection
* **Cryptographic Signatures:** Stripe, Twilio, Meta, and WhatsApp inbound webhooks verify HMAC signatures against configured tenant secrets.
* **Timestamp Tolerance:** Requests outside a 300-second window are rejected to defeat replay attacks.
* **Idempotency Deduplication:** Webhook payloads track inbound event IDs (`MessageSid`, `stripe_event_id`, `idempotency_key`), discarding duplicate deliveries.

### E. Encrypted Credential Vault
* All sensitive credentials (API tokens, OAuth refresh tokens, SMTP/database passwords) are encrypted at rest using **AES-256-GCM**.
* Every credential record stores a unique 12-byte initialization vector (`iv`) and 16-byte authentication tag (`auth_tag`).
* Plaintext credentials are decrypted in-memory only at the moment of node execution and are scrubbed/masked (`op_live_...2c96`) before returning to the frontend or writing to execution logs.

### F. DoS & Concurrency Guardrails
* Per-tenant rate limiting enforces a maximum of 180 requests per minute on API endpoints.
* Workflow execution loops enforce a maximum recursion depth of 50 steps and maximum execution duration of 120 seconds.
* A circuit breaker halts execution if error rates exceed 80% over consecutive runs.
