# Integration Health & Diagnostics

- Added `GET /api/integrations/v2/health` in `apps/api/routes/integrations2.mjs` powered by `evaluateIntegrationHealth` (`cross-platform-events.mjs`).
- Reports explicit per-connection states (`connected`, `not_configured`, `authorization_required`, `approval_pending`, `disconnected`, `degraded`, `error`, `disabled`, `test_adapter_only`), `hasSecretRef`, `lastTestedAt`, `lastSyncedAt`, `lastErrorCode`, and `deadLetterWebhooks` without leaking secrets.
