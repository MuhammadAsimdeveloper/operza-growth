# Remaining Risks and Technical Debt — Stage 18

1. **Unverified External Providers:** Twilio, Resend/SMTP, Stripe, Meta, and external LLM APIs (OpenAI/Gemini/Anthropic) were not called live; provider adapters remain fail-closed or simulated locally.
2. **Distributed Infrastructure:** Multi-node Redis/BullMQ failover and distributed `auth-rate-limiter` under Redis cluster have not been exercised against a live Redis cluster.
3. **Malware Scanning Daemon:** `createClamAvScanner` is implemented and fail-closed, but no live `clamscan` daemon was executed in the local Windows environment.
4. **MFA & Hardware Keys:** TOTP/WebAuthn MFA is not implemented in the current auth schema.
5. **Dev-Only Dependency Advisories:** `npm audit` reports 10 dev-only transitive vulnerabilities (`zod` high, `eslint`/`@typescript-eslint`/`minimatch` moderate); production dependencies (`npm audit --omit=dev`) have `0` vulnerabilities.
6. **Legacy Router Consolidation:** While `route-authz.mjs` now enforces RBAC on v2 and key v1 routers (`support2`, `workflows2`, `integrations2`, `commerce2`, `portal2`, `analytics2`, `crm2`, `agency`), remaining legacy `checkScope` wrappers in older v1 routers (`conversations.mjs`, `payments.mjs`, etc.) should be migrated to `checkActorPermission` in a follow-up cleanup.
