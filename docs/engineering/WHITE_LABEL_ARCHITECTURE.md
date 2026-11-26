# Phase 7 — White-Label Architecture

- **Tenant Branding Isolation:** Agency branding (`Branding.tsx`, `/api/agency/branding`) is scoped per agency and separate from global platform identity.
- **Custom Domain Integration:** Reuses Phase 6 `custom_domains` & `ssl_certificates` (`TenantTx` + DNS TXT + HTTPS verification), ensuring unverified hostnames cannot serve branded portals.
- **Role Enforcement:** Only `owner` and `admin` roles may mutate agency branding or custom domain mappings.
