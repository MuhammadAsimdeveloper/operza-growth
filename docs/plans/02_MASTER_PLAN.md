# OPERZA — MASTER PLAN (Phases, Architecture, Tasks, Exit Criteria)

Read `01_BRUTAL_AUDIT.md` first. This plan fixes every finding in it (C1–C10, M1–M7) and builds the missing competitor-grade features specified in `03_FEATURE_SPECS.md`. UI/UX and SEO are in `04_UIUX_SEO_SPEC.md`.

**Golden rule: nothing in the UI may show success for something that did not really happen.** Every integration/channel has one of 4 honest states: `not_connected` → `connected` → `degraded` → `error`. A workflow that cannot really send an SMS must fail loudly, not log ✅.

---

## A. TARGET ARCHITECTURE

```
apps/
  web/            Vite + React 19 + TypeScript (authenticated app SPA)
  marketing/      Astro (SSG) — homepage, platform pages, pricing, blog, docs, vs-pages, templates gallery
  api/            Fastify + TypeScript (REST + SSE + WebSocket), Zod validation, OpenAPI generated
  worker/         Node worker(s): BullMQ consumers (workflows, messaging, imports, webhooks out, AI jobs)
  renderer/       (or inside api) SSR for tenant public pages: funnels, sites, forms, booking, blogs, custom domains
packages/
  db/             Drizzle (or Kysely) schema + migrations; RLS policies; seed for DEV ONLY
  shared/         Zod schemas + types shared by api/web/worker (single source of truth)
  workflow-engine/ Pure engine (kept & extended), no I/O; I/O via injected adapters
  integrations/   Integration SDK + first-party nodes (see F1)
  ai/             LLM gateway, tool registry, RAG (pgvector), eval harness
  ui/             Design system components (Radix + Tailwind tokens)
  sdk-js/         Generated public API client
infra/            docker-compose (dev + prod), Helm chart, Caddy/Traefik for custom domains + auto-SSL
```

**Stack decisions (change only with a written reason):**
- Language: TypeScript everywhere (API included).
- DB: PostgreSQL 16, real tables, **RLS enforced** and used on every request via a transaction-scoped `SET LOCAL app.agency_id/app.location_id` + a non-superuser app role. pgvector extension for RAG.
- Queue: **real BullMQ** on Redis 7 (delete the hand-rolled RESP client). Separate worker process.
- Object storage: S3-compatible (MinIO in dev). No binary in DB or JSON.
- Auth: sessions (HttpOnly) for the app, API keys + OAuth2 for public API, TOTP 2FA, passkeys later, SSO (OIDC/SAML) for agencies on higher plans.
- Frontend data: TanStack Query + generated typed client; **no business data in localStorage** (only UI prefs).
- UI: Tailwind v4 + Radix primitives (shadcn-style), Lucide icons, React Flow (`@xyflow/react`) for workflow canvas, Tiptap for rich text, dnd-kit for kanban/builder.
- Observability: pino logs, OpenTelemetry traces, Prometheus metrics, Sentry; per-tenant request ids.
- Testing: Vitest (unit), Supertest/Testcontainers (API+PG+Redis), Playwright (e2e + a11y via axe), k6 (load).

---

## B. PHASES (do them in order; do not start a phase until the previous exit criteria pass)

### PHASE 0 — "Stop the lies" (1 week, do on the current codebase first)
Goal: make the existing app honest and safe while you re-platform.

| ID | Task | Detail / files |
|---|---|---|
| 0.1 | Delete the false docs | Remove `FINAL_ENTERPRISE_READINESS_REPORT.md` 100/100 claims; replace `docs/` status with `01_BRUTAL_AUDIT.md`; fix README (React version, Tailwind, file tree, "BullMQ", test badge, RLS claim, RAG/AI claim). Remove "Educational project / mirrors…" from `apps/web/package.json`. |
| 0.2 | Fail-closed webhooks | If `NODE_ENV=production` and `STRIPE_WEBHOOK_SECRET`/`TWILIO_AUTH_TOKEN`/etc. are missing → refuse to boot (or reject webhook with 503). Twilio URL from `PUBLIC_BASE_URL`, not hardcoded `https`. |
| 0.3 | Boot guards | In prod: refuse default `SESSION_SECRET`, refuse default DB passwords, require `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`. Replace 3 hardcoded `localhost:5173` CORS headers with one `corsFor(origin)` helper using the allowlist. |
| 0.4 | Kill free checkout | `POST /api/payments/checkout/:slug`: if no real payment provider connected → return `503 payments_not_configured`; never create `paid` orders. Orders may only become `paid` from a verified Stripe event (Phase 3 finishes this). |
| 0.5 | Honest integrations | Remove fabricated defaults (Stripe "connected"); `connect` stores the credential encrypted (AES-256-GCM, key from env) and `test` performs a real provider call or returns `not_implemented`; remove `Math.random()` latency. |
| 0.6 | Honest messaging | `sendEmail/sendSms` adapters: if no provider configured → throw `ChannelNotConfigured`; workflow step status = `failed` with reason; UI shows red badge "SMS not connected" with CTA. Never write a "sent" message record without a provider message id. |
| 0.7 | Honest AI | Rename current copilot to "Command shortcuts (no AI)" or hide behind feature flag until Phase 5. Remove fake SSE echo. |
| 0.8 | API key middleware | Implement `Authorization: Bearer op_live_…` → resolve agency/location/scopes; enforce scopes per route; update `lastUsedAt`; rate limit per key. |
| 0.9 | Fix QR | Use `qrcode` npm package (SVG/PNG, error correction level M, size & margin options). Add a unit test that decodes with `jsqr`. |
| 0.10 | Fix media | Stop storing Buffers in state; write to disk volume (interim) or S3; serve with correct `content-type`, `cache-control`, `nosniff`; validate mime/size; strip SVG scripts. |
| 0.11 | A2P honesty | Status must come only from a provider response; until Phase 3, show "Registration not submitted — manual". |
| 0.12 | Bot protection | Add honeypot + time-to-submit check + Cloudflare Turnstile (optional env) to all public POSTs (form, booking, funnel opt-in, widget message, review submit, checkout). Per-IP + per-tenant rate limits. |
| 0.13 | Remove demo data in prod | `seed.ts` only loads when `VITE_DEMO=true` or a "Load sample data" button in a sandbox location. |
| 0.14 | ESLint + CI | Add flat `eslint.config.js` (typescript-eslint, react-hooks, jsx-a11y); CI runs lint, typecheck, unit, e2e, build; fail on warnings. |

**Exit criteria P0:** `npm run lint && typecheck && test` green; no endpoint returns success for an action that didn't happen; `curl` to public checkout cannot create a paid order; forged webhook returns 4xx; app refuses to boot in prod with default secrets.

### PHASE 1 — Foundation re-platform (3–4 weeks)
Goal: replace the blob with a real data layer and break the monolith without changing the UI contract.

1. **Schema.** Design normalized tables (see §C). Every table has `id uuid pk`, `agency_id`, `location_id` (nullable for agency-level), `created_at`, `updated_at`, `deleted_at`, `created_by`, `version int` (optimistic concurrency). RLS policy on each: `USING (agency_id = current_setting('app.agency_id')::uuid)` plus location scope where applicable. App DB role has no `BYPASSRLS`.
2. **Repository layer** per aggregate (`ContactsRepo`, `OpportunitiesRepo`…) taking a `TenantTx`; no raw SQL outside repos. A lint rule/test forbids `db.query` outside `packages/db`.
3. **Data migration script** from `store.json`/`operza_app_state` blob → tables (idempotent, dry-run mode, row counts report).
4. **Fastify app** with plugins: request-id, pino, helmet, CORS allowlist, cookie/session, CSRF, rate-limit (Redis store), zod type-provider, error handler (RFC 7807 problem+json), OpenAPI at `/openapi.json` + Scalar/Swagger UI at `/docs/api`.
5. **Split `server.mjs`** by module (`modules/contacts`, `/opportunities`, `/workflows`, `/payments`, …) each with routes, schema, service, repo, tests. Port route-by-route; old and new may coexist behind a reverse-proxy path switch until parity.
6. **Generic CRUD → typed CRUD.** Every collection gets Zod schema, field-level validation, list endpoint with cursor pagination, `sort`, `filter` (typed operators), `q` search (pg_trgm), `fields`, `expand`. Bulk endpoints with background job + progress.
7. **Queue/worker.** BullMQ queues: `workflow`, `messaging`, `webhook-out`, `import-export`, `ai`, `scheduler`. Idempotency keys, retries with backoff+jitter, DLQ, job dashboard (bull-board behind super-admin).
8. **Events.** Introduce an internal event bus (`domain_events` table + outbox pattern → queue). Workflow triggers, outbound webhooks, websocket pushes and audit all consume the same events. No more `broadcast()` sprinkled in handlers.
9. **Auth hardening.** Email verification, password reset, session list/revoke, lockout/backoff, TOTP 2FA, RBAC permission matrix (see F14), invitation flow.
10. **File storage** to S3/MinIO with signed URLs; virus scan hook (ClamAV optional).
11. **Tests.** Contract tests from OpenAPI; tenancy tests that attempt cross-tenant reads on **every** endpoint (generated from the route table) and must get 404/403.

**Exit criteria P1:** zero reads from the JSON blob; killing the API mid-request loses no committed data; a generated test proves tenant A can't read/write tenant B on all routes; 10k contacts list p95 < 150 ms; two API instances run concurrently without conflict.

### PHASE 2 — Frontend rebuild on a real data layer (3 weeks, overlaps P1 end)
1. Remove `store.tsx` business state; page-by-page migrate to TanStack Query hooks generated from OpenAPI. Keep `localStorage` only for theme/sidebar/active-location.
2. New design system package (`packages/ui`) — tokens, components, patterns (see `04`).
3. Replace custom CSS with Tailwind + component library; keep `tokens.css` values as theme source.
4. App shell: collapsible nav grouped by job-to-be-done, command palette (⌘K), global search, notifications center, workspace/location switcher with search, breadcrumbs.
5. Optimistic updates + conflict handling via `version`; real-time updates via WebSocket events invalidating queries.
6. Route-level code splitting, skeletons, error boundaries, empty states, offline banner.
7. Accessibility pass and Playwright+axe tests per page.
8. Onboarding wizard + checklist (F19) replaces seeded demo.

**Exit criteria P2:** no page imports `seed`; data persists across devices; Lighthouse (app) ≥ 90 perf/100 a11y on key pages; axe has 0 serious violations on top 20 pages.

### PHASE 3 — Real channels & real money (4 weeks)
Implements F4 (Inbox), F5 (Email engine), F6 (Payments), F10 (Voice, first version), F14 compliance parts (consent, DND, A2P via Twilio Trust Hub).
Exit: send & receive a real SMS, WhatsApp template, email (with SPF/DKIM verified), take a real Stripe test payment, receive the webhook, order flips to paid, workflow fires, invoice PDF generated; refund works; failed payment triggers dunning workflow. All covered by sandbox e2e tests (Stripe test mode, Twilio test credentials, Mailpit).

### PHASE 4 — Automation v2 + Integration Hub (5 weeks)
Implements F1 (Integration SDK, vault, OAuth), F2 (Workflow engine v2 + React Flow canvas), F16 (AI builder + recipes/templates).
Exit: build "new lead → enrich → AI reply → book → Slack + Sheets" with credentials from the vault; replay a failed execution from the failed node; export/import workflow JSON; 25 launch integrations live; 1,000 concurrent executions on a worker with zero lost jobs (k6 + chaos kill of a worker).

### PHASE 5 — Real AI (3 weeks)
Implements F3 (Conversation/Voice AI agents with RAG, tools, handoff, evals), Copilot v2 (command agent with approval gates), AI everywhere (summaries, reply drafts, lead scoring).
Exit: eval suite ≥ agreed pass rate on 100 golden conversations; every AI-initiated write passes through the approval policy; token/cost metering per tenant; kill-switch works.

### PHASE 6 — Funnels/Sites v2, Calendar v2, SEO platform (4 weeks)
Implements F8, F9, marketing site on Astro, SEO engine (see `04`), custom domains + SSL.
Exit: a published funnel is served as server-rendered HTML with correct meta/OG/JSON-LD on a customer domain with auto-SSL; Core Web Vitals pass; sitemap/robots generated per domain.

### PHASE 7 — SaaS mode, white-label, marketplace, reporting (4 weeks)
Implements F7, F13, F11, F12, F15 (public API + OAuth apps + webhooks), F17 (PWA), F18 (platform admin).
Exit: agency can launch its own branded SaaS plan with Stripe Connect, wallet-metered SMS/AI usage, custom domain login, and deploy a snapshot to a new sub-account in < 10 s.

### PHASE 8 — Launch hardening (2–3 weeks)
Security review (OWASP ASVS L2 checklist), dependency + SBOM, pen-test, load test at 10× expected, backup/restore drill (RPO ≤ 15 min, RTO ≤ 1 h), chaos tests, GDPR export/delete, status page, docs site, pricing, public beta.

---

## C. DATA MODEL (core tables; add `agency_id`, `location_id`, timestamps, `deleted_at`, `version` to all)

**Identity & tenancy:** `users`, `agencies`, `locations`, `memberships(user_id, agency_id, role_id)`, `roles`, `role_permissions`, `invitations`, `sessions`, `api_keys`, `oauth_apps`, `oauth_grants`, `audit_log` (append-only, partition by month).

**CRM:** `contacts` (+ `contact_identities` for multiple emails/phones with `verified`, `primary`, `channel_consent`), `companies`, `custom_field_defs`, `custom_field_values` (typed columns: text/num/date/bool/json) or JSONB + GIN with schema-validated defs, `tags`, `contact_tags`, `notes`, `tasks`, `pipelines`, `pipeline_stages`, `opportunities`, `opportunity_stage_history`, `smart_lists` (stored as a typed filter AST), `activities` (timeline, one table, typed `kind`).

**Comms:** `channels` (per location: sms/email/whatsapp/fb/ig/gbp/webchat; provider, credential_id, status), `conversations`, `messages` (direction, status, provider_message_id, error), `message_events` (delivered/opened/clicked/bounced), `templates`, `snippets`, `email_domains`, `suppressions`, `consents` (contact, channel, purpose, source, timestamp, ip, text shown), `numbers`, `calls`, `call_recordings`, `a2p_brands`, `a2p_campaigns`.

**Automation:** `workflows`, `workflow_versions` (immutable JSON graph), `workflow_enrollments`, `executions`, `execution_steps` (input/output/error/logs), `credentials` (encrypted), `credential_types`, `integration_connections`, `triggers_registry`, `schedules`, `webhook_endpoints` (test/prod), `webhook_deliveries`.

**Commerce:** `products`, `prices`, `coupons`, `orders`, `order_items`, `payments`, `refunds`, `invoices`, `invoice_items`, `subscriptions`, `subscription_events`, `payment_links`, `affiliates`, `affiliate_conversions`, `payouts`, `wallets`, `wallet_transactions`, `usage_events`, `plans`.

**Content:** `sites`, `pages`, `page_versions` (JSON block tree), `domains`, `forms`, `form_submissions`, `blogs`, `posts`, `media_assets`, `courses`, `modules`, `lessons`, `enrollments`, `progress`, `documents`, `signature_requests`, `signature_events`, `qr_codes`.

**Scheduling/Reputation/Social:** `calendars`, `calendar_availability`, `appointments`, `external_calendar_links`, `review_sources`, `reviews`, `review_requests`, `social_accounts`, `social_posts`.

**AI:** `ai_agents`, `ai_agent_versions`, `knowledge_sources`, `knowledge_chunks(embedding vector)`, `ai_runs`, `ai_tool_calls`, `ai_evals`, `ai_usage`.

**Analytics:** `events` (append-only: page_view, form_view, click, purchase…, with UTM/session/visitor), `attribution_touches`, `reports`, `dashboards`, `scheduled_reports`.

Indexes: all FK + `(agency_id, location_id, created_at desc)`; `pg_trgm` GIN on contact name/email/phone/company; partial indexes on `deleted_at is null`.

---

## D. CROSS-CUTTING REQUIREMENTS (apply to every feature)

1. **Tenant safety:** every handler runs inside a `TenantTx`. No handler touches DB outside it.
2. **Validation:** Zod at the edge; reject unknown fields; sanitize HTML (DOMPurify server-side) for rich text.
3. **Permissions:** declare required permission per route (`contacts.read`, `workflows.publish` …); a test fails if a route lacks one.
4. **Idempotency:** all POSTs that create money/messages accept `Idempotency-Key`.
5. **Audit:** every mutation emits a domain event → `audit_log` (who, what, before/after diff, ip, ua).
6. **Observability:** structured logs with `request_id`, `agency_id`, `execution_id`.
7. **Secrets:** only in the credential vault / env; never logged; redact in errors.
8. **Feature flags:** per-agency flags table; every new feature ships dark.
9. **Docs:** each module gets `README.md`, OpenAPI examples, and a user-facing docs page in `apps/marketing/docs`.
10. **Definition of done (DoD):** code + types + unit + integration + e2e + a11y + docs + metrics + feature flag + migration + rollback note.

---

## E. WORK BREAKDOWN FORMAT FOR ANTIGRAVITY
For every task, create `/docs/tasks/<phase>-<id>.md` with: Goal • Files touched • Steps • Tests added • Acceptance checks • Rollback. Commit per task (`feat(contacts): …`). After each phase write `/docs/PHASE_N_REPORT.md` that lists **what was NOT done** honestly. No 100/100 scorecards.
