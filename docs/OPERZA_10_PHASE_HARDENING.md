# Operza Growth — Ten-Phase Hardening

**Working branch:** feat/operza-10-phase-hardening  
**Parent branch:** feat/operza-unified-atlas-automation  
**Purpose:** record the security, integration and operational work completed in this branch without overstating production readiness.

This is an implementation record, not a production-readiness certificate. The branch must pass CI and staging gates before merge. Provider credentials, cloud infrastructure and Microsoft Entra registration must be supplied by the deployment owner.

## Phase status

| Phase | Status | Implemented in this branch | Still required |
|---|---|---|---|
| 1. Secret vault | Code slice implemented | AES-256-GCM encryption; explicit master key; no hardcoded fallback or implicit memory store; KMS adapter contract; tenant/location-scoped PostgreSQL secret storage; migration 016; RLS readiness check | Provision production key/KMS, key rotation, encrypted backup/restore and production DB-role tests |
| 2. Real provider delivery | Fail-closed safety implemented; coverage partial | Resend, SendGrid, Twilio, Meta and Stripe no longer claim verification or delivery from credential shape; payment dispatch remains disabled | Implement and test real provider APIs, provider receipts/webhooks, sender-domain verification and consent checks at dispatch |
| 3. Microsoft Outlook | OAuth and send path implemented | Authorization-code flow with PKCE/state; Graph profile verification; encrypted refresh-token storage; Mail.Send adapter; Integrations UI; 202 is accepted, not delivered | Configure Microsoft Entra app, handle refresh-token rotation, add mailbox delta sync/notifications and reply/draft actions |
| 4. Zapier authentication | Route scopes implemented | API-key scopes enforced per route; browser sessions restricted by role; /auth/me reports effective scopes; unknown routes fail closed | Rotate existing broad API keys, expand tenant-bound route tests and configure/publish the Zapier app |
| 5. Durable webhook delivery | PostgreSQL outbox path implemented | Signed events are enqueued without storing the signing secret; worker validates targets, pins DNS before HTTPS dispatch, uses bounded timeouts and retries transient failures; non-DB mode reports not queued | Apply migrations, provision worker role, deploy worker separately and add durable delivery-history UI/end-to-end checks |
| 6. Workflow operations | Foundation only | Existing PostgreSQL outbox/lease foundation retained; enqueue failures are no longer labeled delivered; unconfigured live action execution fails closed | Wire every trigger, wait, approval resume and provider action through transactional outbox; implement real workflow handlers, action receipts, provider idempotency, retry/DLQ recovery and load tests |
| 7. Database and tenancy | Schema/readiness hardening implemented | Migration 016 adds encrypted provider-secret storage with forced tenant/location RLS; readiness requires the vault table and RLS; production readiness fails if DB/platform gates fail | Apply migrations 001–016 to PostgreSQL 16; test cross-tenant isolation; provision non-superuser app role and separate worker role; test backups |
| 8. AI Copilot / Workforce | Existing proposal foundation; incomplete | Existing tool permission and human-review proposal foundation retained; unsupported provider actions remain fail-closed | Configure production LLM, grounded tenant-scoped retrieval, evaluation suite, tool/agent permission tests and proposal execution with version checks/audit receipts |
| 9. Deployment and monitoring | Basic gates improved; production operations partial | Readiness checks PostgreSQL/platform RLS; admin telemetry requires owner/admin; public metrics no longer expose CRM/account totals | Deploy API and worker separately; add worker heartbeats/alerts, structured logs/traces, TLS/egress policy, secret rotation, backups, restore drills and incident runbooks |
| 10. Release validation | CI coverage updated; execution pending | API tests are included in scripts and CI; CI references migrations through 016 and tests durable worker contracts | Obtain green CI for Node 20/22, PostgreSQL 16, Redis, E2E, Docker and security audit; complete staging OAuth/webhook tests before merge |

## Outlook setup

Register an application in Microsoft Entra ID and configure this redirect URI:

    https://<your-operza-domain>/api/integrations/outlook/callback

Set these variables on the API server:

    MICROSOFT_CLIENT_ID=<entra-application-client-id>
    MICROSOFT_CLIENT_SECRET=<server-side-client-secret>
    MICROSOFT_TENANT_ID=common
    MICROSOFT_REDIRECT_URI=https://<your-operza-domain>/api/integrations/outlook/callback
    OPERZA_VAULT_KEY=<at-least-32-bytes-of-high-entropy-key-material>
    PLATFORM_DB_ENABLED=true

The implementation requests openid, profile, email, offline_access, User.Read and delegated Mail.Send. It sends through the signed-in mailbox at Microsoft Graph /me/sendMail. HTTP 202 is recorded as accepted, not proof the recipient received or read the message. Mail.Read is not requested because mailbox reading/sync is not yet implemented.

After app registration and database setup, open Operza → Integrations → Microsoft Outlook → Connect Outlook with Microsoft. Tokens remain on the API side and the refresh token is stored under the active agency/location vault namespace. Never put client secrets or refresh tokens in frontend code, logs or Zapier payloads.

## PostgreSQL and worker setup

1. Provision PostgreSQL 16 and apply migrations 001–016 with the migration-owner account.
2. Provision the application role with required grants; it must not be a superuser or have BYPASSRLS.
3. Provision the separate operza_worker role using the repository worker-role operations script. Do not reuse the API login.
4. Configure DATABASE_URL for the API and WORKER_DATABASE_URL for the worker in a deployment secret manager.
5. Set OPERZA_VAULT_KEY to unique high-entropy key material; do not commit it.
6. Run the worker as a separate process/service. Bundled trusted handlers load by default; only configure WORKFLOW_JOB_MODULE for a reviewed local trusted module.
7. Confirm /ready returns HTTP 200 and ready=true only after PostgreSQL, platform tables and forced RLS policies pass.

The worker can process durable Zapier webhook delivery jobs. Other workflow trigger/resume handlers still need a real workflow-runtime integration and are not production-complete.

## Validation commands

    npm ci
    npm run typecheck
    npm --workspace=@operza/platform-core test
    npm --workspace=@operza/db test
    npm --workspace=@operza/api test
    npm run build
    npm run test:e2e
    npm run test:seo

Run the full GitHub Actions workflow after these local commands. No green result should be claimed until the workflow reports success on this branch.

## Safety boundaries

- An integration is connected only after provider-specific OAuth/API verification succeeds.
- An outbox event is queued until the worker receives a real 2xx response; queue insertion is not delivery.
- A Graph 202 response means Microsoft Graph accepted the request, not that the recipient received it.
- No live email/SMS/WhatsApp/payment dispatch is enabled for adapters without real provider implementations.
- Local JSON/memory mode is for development. Staging and production require PostgreSQL platform mode and durable secret storage.
- OAuth state is currently stored through the existing application-state path. Before horizontal API scaling, move OAuth transactions and remaining core approval/execution state into shared transactional persistence.
