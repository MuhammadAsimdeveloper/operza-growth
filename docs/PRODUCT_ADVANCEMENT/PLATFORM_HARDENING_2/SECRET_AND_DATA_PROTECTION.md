# Secret and Data Protection — Stage 18

## 1. Secret Lifecycle (`packages/platform-core/src/secret-vault.mjs`)

- **Encryption at Rest:** `vault:` references are encrypted with `AES-256-GCM` (`v1:<16B-salt>:<16B-iv>:<16B-tag>:<ciphertext>`) using `scryptSync` key derivation from `OPERZA_VAULT_KEY` (minimum 16 characters enforced).
- **KMS & Env Separation:** `kms:` references delegate to an explicit `kmsAdapter`; `env:` references resolve named environment variables. Master key (`OPERZA_VAULT_KEY`) is never persisted alongside ciphertext.
- **API & Frontend Exposure:** `publicProviderConnection` strips credentials from API responses; no secrets or private keys are embedded in `apps/web/src` or `apps/marketing/src`.
- **Audit & Debugger Redaction:** `redactSensitivePayload` (`graph-validator-v2.mjs`) and `redactExportRows` (`analytics-2-0.mjs`) scrub tokens, passwords, and PII before persistence or CSV export.

## 2. Honest Limitations

- AWS KMS / Secrets Manager integration (`kms:` adapter) is abstracted behind `kmsAdapter` and has not been tested against live AWS KMS in this local environment.
