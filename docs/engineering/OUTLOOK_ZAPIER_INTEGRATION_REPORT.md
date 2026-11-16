# Operza Growth — Microsoft Outlook & Zapier Integration Report

## 1. Microsoft Outlook (Graph API) Integration

Operza integrates with Microsoft 365 and Outlook via modern Microsoft Graph OAuth 2.0.

### 1. Security Architecture
- **Delegated Least-Privilege Scope**: Requests only `Mail.Send` and `offline_access`. Never requests full mailbox read access or broad tenant permissions.
- **PKCE Flow (RFC 7636)**: Generates high-entropy `code_verifier` (43–128 characters) and SHA-256 `code_challenge`.
- **Single-Use State Verification**: State parameter is cryptographically signed and stored in PostgreSQL (`provider_oauth_states`). States expire after 10 minutes and can never be replayed.
- **Encrypted Token Vault**: Refresh tokens and access tokens are encrypted using AES-256-GCM under the tenant vault (`vault:<agency_id>/<location_id>/outlook_token`).
- **Automated Token Refresh**: Tokens within 60 seconds of expiry are automatically refreshed using the stored refresh token.
- **Dispatch Contract**: Email dispatch verifies recipient consent against the communication consent ledger and only acknowledges success when Microsoft Graph returns HTTP 202 Accepted.

### 2. Verified Test Scenarios
- PKCE authorization URL generation with `S256` challenge.
- Callback token exchange with Graph mailbox verification.
- Tampered state rejection and replay attack immunity.
- Token refresh with automatic rotated refresh token persistence.
- Fail-closed behavior on missing contact consent.

---

## 2. Zapier Universal Platform & REST Hooks Integration

Operza implements a complete, native Zapier App integration conforming to modern Zapier CLI standards.

### 1. Inbound Actions & Triggers
- **14 REST Hook Triggers**: `contact.created`, `contact.updated`, `deal.won`, `appointment.booked`, `task.created`, etc.
- **12 Inbound Actions**: Create contact, update contact, create opportunity, add note, create task, book appointment, remove tag, etc.
- **4 Search Lookups**: Find contact, find opportunity, find task, find appointment.
- **App Introspection**: `GET /api/v1/zapier/app-definition` returns the complete schema manifest.

### 2. Outbound REST Hook Delivery
- **Durable Subscriptions**: Stored in PostgreSQL `zapier_rest_hook_subscriptions` with tenant vault signing secrets.
- **HMAC-SHA256 Signatures**: Outbound payloads include `X-Operza-Signature: t=<timestamp>,v1=<hmac>` for cryptographic verification.
- **Replay Protection**: Timestamps are enforced within a 300-second window.
- **SSRF Defense**: Target URLs are strictly inspected. Non-HTTPS schemes, loopbacks, RFC 1918 private subnets, and cloud metadata IPs (`169.254.169.254`) are rejected before DNS resolution.
- **Outbox Persistence**: Deliveries are logged in `zapier_rest_hook_deliveries` with attempt counts, HTTP status codes, and latency tracking.

### 3. Verified Test Scenarios
- `packages/platform-core/test/outlook-oauth.test.mjs`: 6/6 tests passing.
- `apps/api/test/zapier-endpoints.test.mjs` & `zapier-authz.test.mjs`: 11/11 tests passing.
- `scripts/test-e2e.mjs`: Tests 110–114 verified app manifest discovery, search lookups, inbound actions, test ping, and polling triggers.
