# Phase 6 — Custom Domains & SSL Architecture

**Module:** `packages/platform-core/src/domains/custom-domains.mjs`
**Repository:** `packages/db/lib/custom-domains-repository.mjs`
**Routes:** `apps/api/routes/domains.mjs` (`/api/domains*`)

- **Hostname Normalization:** `normalizeHostname()` enforces IDNA Punycode normalization, trailing-dot stripping, RFC label syntax, and blocks IP literals, wildcards, and reserved system domains (`operza.io`, `localhost`).
- **Global Uniqueness:** `custom_domains_active_hostname_idx` on `lower(hostname) WHERE status <> 'disconnected'` blocks cross-tenant duplicate claims at the PostgreSQL layer (`DOMAIN_ALREADY_CLAIMED`).
- **DNS TXT Verification:** `verifyDnsTxtOwnership()` checks `_operza-challenge.<hostname>` against cryptographically generated, expiring tokens.
- **SSL Lifecycle:** `createSslProvisioningAdapter()` tracks `provisioning_requested -> issued -> active` and **never** marks SSL `active` until both certificate issuance and `verifyHttps()` succeed. Private keys are never stored in `ssl_certificates`.
- **Host Routing:** `resolvePublicHost()` only resolves `status === 'active'` verified domains.
