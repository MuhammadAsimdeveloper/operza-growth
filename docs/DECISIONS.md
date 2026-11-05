# Operza Architecture Decision Records (ADRs)

## ADR-001: Two-Phase Provider-Verified Payment Lifecycle
- **Status:** Accepted (2026-11-05)
- **Context:** The legacy implementation immediately marked orders and invoices as `paid` upon user submission on public checkout pages, creating massive financial fraud exposure.
- **Decision:** All orders and invoices created via public checkout endpoints must initialize with `status: 'pending'` and `paidAt: null`. Orders only transition to `paid` upon receiving and validating an authentic provider webhook event (`checkout.session.completed` / `payment_intent.succeeded`).
- **Consequences:** Financial state is guaranteed authentic. Workflow automations with `payment` triggers are only fired when money has actually been confirmed by the payment gateway.

## ADR-002: Explicit CSRF Token Handshake
- **Status:** Accepted (2026-11-05)
- **Context:** The backend enforced `x-operza-csrf` header checks on mutating requests, but the frontend was forced to scrape `document.cookie`, which failed under strict cross-origin or subdomain contexts.
- **Decision:** Expose `csrfToken` explicitly in `/api/auth/session`, `/api/auth/login`, and `/api/auth/signup` JSON payloads, and provide a dedicated `/api/auth/csrf` refresh route. The frontend API client caches this token in memory and automatically supplies it in `x-operza-csrf`.
- **Consequences:** Eliminates random 403 CSRF lockouts without weakening security boundaries.

## ADR-003: Removal of Webhook Test Backdoors in Production
- **Status:** Accepted (2026-11-05)
- **Context:** Test shortcuts like `meta_chall_44` and hardcoded fallback verify tokens permitted unauthorized parties to pass webhook verification handshakes.
- **Decision:** Eliminate all backdoor strings. In production, webhooks without configured secrets or valid HMAC signatures fail closed with HTTP 401/403.
- **Consequences:** Webhook ingress is cryptographically secured against spoofing and forged events.
