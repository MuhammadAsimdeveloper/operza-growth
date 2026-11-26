# Integration 2.0 Security Review

## 1. Security Controls Verified
- **Encrypted Vault & Zero Secret Leakage:** All secrets reside in `provider_secrets` (`v1:` AES-256-GCM envelopes); `integration_connections` stores only `vault_secret_ref` (`^(vault|kms):...`) and `normalizeConnectionRow` strips `vault_secret_ref` from API responses.
- **Multi-Tenant `FORCE RLS`:** All 5 tables in `042_integrations_2_0.sql` enforce composite `(agency_id, location_id, id)` primary keys and `FORCE ROW LEVEL SECURITY`, verified under `operza_app` in `real-postgres-integration.test.mjs`.
- **OAuth & PKCE:** Redirect URI allowlist, `S256` PKCE, single-use HMAC state, cross-tenant rejection, concurrent refresh lock, and terminal revocation verified in `integrations-2-0.test.mjs`.
- **Webhook & SSRF Protection:** Timestamped HMAC-SHA256 verification (`300s` replay window), `262,144`-byte payload cap, idempotent DB deduplication, `redirect: 'error'`, and private/loopback IP blocking verified.
