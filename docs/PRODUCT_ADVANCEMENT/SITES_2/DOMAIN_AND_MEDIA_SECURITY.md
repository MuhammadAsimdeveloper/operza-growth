# Sites 2.0 — Custom Domains & Media Security

- **Custom Domains (`038_phase6_sites_domains_ssl.sql`, `domains.mjs`):** Global `UNIQUE (lower(hostname)) WHERE status <> 'disconnected'`, DNS TXT verification, and SSL lifecycle states. Live DNS/ACME provisioning remains an external staging gate.
- **Media Assets (`site_media_assets`, `canTransitionMediaAsset`):** Enforces `uploaded` -> `quarantined` -> `scanned_clean` -> `published` transitions; refuses marking quarantined media clean/published unless `clamAvVerified: true`.
