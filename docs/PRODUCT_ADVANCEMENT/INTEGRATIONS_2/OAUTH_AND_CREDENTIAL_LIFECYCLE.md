# OAuth 2.0 & Credential Lifecycle

**Module:** `packages/platform-core/src/oauth-lifecycle-v2.mjs`  
**Storage:** `provider_secrets` (`016_provider_secret_vault.sql`), `integration_connections` (`042_integrations_2_0.sql`)

## 1. Lifecycle Guarantees
- **PKCE S256 & Signed State:** `createAuthorizationRequest` generates a 32-byte `code_verifier`, computes `S256` `code_challenge`, signs the tenant/actor/nonce/redirect payload with HMAC-SHA256 (`OPERZA_VAULT_KEY`), and enforces strict `allowedRedirectOrigins`.
- **Single-Use Anti-Replay:** `verifyAndConsumeState` validates HMAC signature, expiry, tenant (`agencyId` + `locationId`), and deletes state on first use.
- **Concurrent Refresh Lock:** `refreshTokenBundle` deduplicates concurrent refresh calls per `secretRef` via an in-flight promise map and persists rotated refresh tokens into the AES-256-GCM vault.
- **Terminal Revocation:** `revokeConnectionSecret` overwrites the vault bundle with `{ revoked: true }` and `updateConnectionStatus(..., { status: 'disconnected' })` records `revoked_at` to block subsequent use.
- **Zero Browser Token Exposure:** `normalizeConnectionRow` returns `hasSecretRef: Boolean(row.vault_secret_ref)` and never returns `vault_secret_ref` or token plaintexts to clients.
