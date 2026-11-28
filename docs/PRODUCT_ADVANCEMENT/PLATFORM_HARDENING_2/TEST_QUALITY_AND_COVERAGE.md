# Test Quality and Coverage Audit — Stage 18

## 1. Test Infrastructure Assessment

- **Unit & Integration Suites:** `node --test` across `@operza/action-governance`, `@operza/workflow-engine`, `@operza/platform-core`, `@operza/ui`, and `@operza/api`.
- **Real PostgreSQL & RLS Testing:** `IsolatedTestPostgres` runs real PostgreSQL with all 53 migrations and tests `operza_app` / `operza_worker` (`rolbypassrls = false`) under `FORCE ROW LEVEL SECURITY`.
- **End-to-End API Suite:** `scripts/test-e2e.mjs` runs 116 live HTTP integration scenarios against a booted API server.
- **Stage 18 Additions (`packages/platform-core/test/stage-18-hardening.test.mjs`):**
  - Negative and positive RBAC tests for all 12 built-in roles on cookie-session actors.
  - Automated verification across all 134 `public` tables that 100% of `agency_id` tables enforce `RLS + FORCE RLS + >=1 policy`.
  - Controlled local `TenantTx` performance measurement (`p50`, `p95`).
  - Updated `test-e2e.mjs` TEST 66 to assert that unauthenticated `GET /metrics` does not leak `totalUsers`.

## 2. Known Test Gaps

- `@operza/platform-core` retains 1 pre-existing skipped test unrelated to Stage 17/18.
- External providers (Twilio, Stripe, Resend, OpenAI/Gemini/Anthropic, ClamAV, multi-node Redis) remain simulated or fail-closed in local test runs.
