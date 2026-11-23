# OPERZA — BRUTAL AUDIT
Repo audited: `operza-growth-main.zip` (201 files, ~2.5 MB). Audit date: 22 Nov 2026.
Method: static read of the code. I did not run it. Line numbers refer to `apps/api/server.mjs` unless stated.

---

## 0. VERDICT IN ONE PARAGRAPH

Operza is a **very convincing demo, not yet a product.** The UI surface is wide (60+ pages, 73 routes, ~40 collections, ~30 workflow node types, ~23 triggers) and the architecture diagrams are good. But the parts that make GoHighLevel and n8n worth paying for are **simulated**: no message is ever sent, no card is ever charged, no LLM is ever called, no integration ever connects, API keys authenticate nothing, and the "PostgreSQL RLS" is a single JSON blob. The repo's own docs score every category "100/100 – production ready." That is false and is the most dangerous thing in the repo, because it will make you (and Antigravity) believe the work is finished.

**Honest maturity score (my assessment, not the repo's):**

| Area | Repo claims | Reality |
|---|---|---|
| Backend architecture | 100 | 35 — monolith, in-memory state, blob persistence |
| Multi-tenant security | 100 | 25 — app-level filtering only; RLS not in the read path |
| Messaging (SMS/email/WhatsApp) | 100 | 10 — inbound webhook parsing only; zero outbound provider calls |
| Payments | 100 | 5 — checkout marks orders paid with no processor |
| AI Copilot | 100 | 5 — regex keyword matching, no LLM |
| Workflow engine | 100 | 55 — decent pure state machine; missing n8n-class features |
| Integrations | 100 | 0 — a boolean toggle |
| Frontend | 100 | 50 — big UI, split-brain data layer |
| SEO | 100 | 40 — client-side meta only, SVG OG image |
| Testing | 100 | 25 — one engine unit-test file + one e2e script; no frontend tests |

---

## 1. WHAT THE REPO ACTUALLY CONTAINS

**Monorepo (npm workspaces)**
- `apps/api` — `server.mjs` (6,741 lines, ~300 KB, ONE file, one giant `if (pathname === …)` router), `queue.mjs` (362 lines).
- `apps/web` — Vite + React **18.3.1** + react-router 6, hand-written CSS (`app.css` 46 KB, `tokens.css`). 40+ authenticated pages, 12 marketing pages, public pages (funnel, form, booking, checkout, review, portal).
- `packages/workflow-engine` — `engine.mjs` (700 lines), 8 unit tests.
- `packages/db` — 6 SQL migrations (agency/tenant core, form registry, workflow executions, templates, snapshots, telephony).
- `packages/shared` — a 2.6 KB types file.
- `scripts` — a 139 KB e2e script, k6 load tests, SEO checker.
- 14 audit/report docs, all self-congratulatory.

**What is genuinely good (keep it):**
1. Breadth of domain model — contacts, opportunities, pipelines, forms, calendars, funnels, memberships, affiliates, coupons, reputation, snapshots, documents/e-sign, phone numbers. This is a real GHL-shaped map.
2. Workflow engine is a clean, mostly pure `executeStep()` with ~30 node types (email, sms, tag, task, stage, if_else, webhook, http_request, delay, wait, split_test, loop, set_variable, math, filter, slack_notify, update_contact, create_opportunity, assign_to, send_review_request, ai_agent…) and a **unit test file**. Keep and extend.
3. ~23 trigger types are actually wired to events (form, tag, stage, payment, review, appointment, missed_call, sms, whatsapp, meta, schedule, webhook, trigger-link click…).
4. Security basics done right: scrypt password hashing, SHA-256 hashed session tokens, `timingSafeEqual`, CSRF header check on mutations, `HttpOnly` cookies, `__Host-` cookie prefix in prod, webhook replay de-dup cache, Stripe 300 s timestamp tolerance.
5. Snapshot **diff + selective sync** concept (genuinely a GHL gap).
6. Human-approval gate concept for dangerous workflow actions.
7. Lazy-loaded app shell, CSS design tokens, dark-mode switch, structured logging, health/ready/metrics endpoints, Docker + CI + CodeQL + Dependabot scaffolding.

---

## 2. CRITICAL FINDINGS (P0 — fake or dangerous; fix before anything else)

### C1. The "AI Copilot" is not AI
- `POST /api/copilot/chat` (line ~3622) is a pile of `lowerMsg.includes('create contact')` / regex branches that call local functions. There is **no LLM call anywhere in the API.** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in `.env.example` are never read.
- `GET /api/copilot/stream` (line ~3593) is a `setInterval` that echoes the user's own text word-by-word with a hardcoded "You have 0 pending human approvals". It is a typing animation, not streaming inference.
- The workflow `ai_agent` node throws "AI Handler not configured" unless `aiHandler` is injected, and the injected handler (line ~775) is a stub.
- The "knowledge base / RAG" (`/api/ai/knowledge`) stores text; nothing embeds, retrieves, or grounds a response.
- README claims "Semantic Grounding (RAG)", "Autonomous AI Copilot". **This is misleading marketing.**

### C2. Nothing is ever sent
- Grep across `server.mjs`, `engine.mjs`, `queue.mjs`: **no outbound request to Twilio, SendGrid/SMTP, Meta Graph, WhatsApp Cloud, Stripe, OpenAI or Anthropic.** (The only `fetch` in the API file is inside the embeddable widget's client JS string.)
- `crmActions.sendEmail` (line ~648) does `console.log` and appends a message to a conversation record. SMS (line ~685) follows the same pattern.
- Result: a user sets up a workflow "send SMS on form submit", sees ✅ in the UI and in the run log, and **no SMS exists.** For a CRM this is a trust-destroying bug.
- The campaign "dispatch" endpoints (lines ~3885–3980) likewise only change state.

### C3. Checkout "charges" nobody
- `POST /api/payments/checkout/:slug` (line ~1949) is a public, unauthenticated endpoint that creates a contact, creates an order with `status: 'paid'`, creates a paid invoice, and marks the opportunity `won` — with **no card data, no PaymentIntent, no Stripe call.**
- Anyone can `curl` it and get a "paid" order for any product. Combined with workflows that fire on `payment`, this can trigger fulfilment, memberships, affiliate commissions, and course access for free.
- The Stripe webhook handler (line ~2682) verifies a signature, then only `broadcast()`s a websocket event. It never marks anything paid, refunded, or failed.

### C4. Integrations are a switch, not a connection
- `getDefaultIntegrations()` (line ~6009) ships Stripe pre-set as `connected: true, accountName: 'Operza Alpha Agency (acct_1928)'`. This is fabricated.
- `POST /api/integrations/:id/connect` (line ~6029) **discards the API key** (`hasApiKey: Boolean(body.apiKey)`), flips `connected = true`, done.
- `POST /api/integrations/:id/test` (line ~6075) returns `latencyMs: 25 + Math.random()*30` and "Active connection confirmed." That is a lie generator.

### C5. API keys authenticate nothing
- `/api/developers/keys` creates `op_live_…` keys (hashed, good) — but **no code path ever reads an `Authorization: Bearer` or `x-api-key` header.** Grep for `Bearer|x-api-key|authorization` finds nothing in auth logic. The "Developers" page documents an API that cannot be called.
- Outbound webhooks "deliveries" page exists; delivery is simulated.

### C6. Persistence is a single JSON blob; "RLS" is decorative
- Runtime truth is `state = {…}` in memory. `saveState()` (line ~555) does `JSON.stringify(state, null, 2)` (pretty-printed!) of **the entire database** on every mutation, writes it to disk, then upserts it as one JSONB row `operza_app_state/active_state`.
  - O(total data) per write, single-writer, one process only, will melt at a few thousand contacts, and any crash mid-write on PG or a second instance = data loss/overwrite.
- The six SQL migrations (real tables + RLS policies) are **not the system of record.** `syncRelationalWrite()` (line ~432) mirrors writes best-effort (I verified `contacts`; it swallows errors with a `console.warn`). Reads never touch those tables.
- Therefore: tenant isolation is enforced only by `.filter(x => x.agencyId === agency.id)` scattered across 6,700 lines. One missed filter = cross-tenant leak. The README's "cross-tenant data leakage is physically impossible" is **false for the running system.**
- Uploaded media are stored as `Buffer`s inside `state.mediaFiles` (line ~4845). `JSON.stringify(Buffer)` yields `{type:'Buffer',data:[…]}`, so after a restart the buffers won't rehydrate as Buffers — media serving will break, and the blob balloons (each byte becomes a JSON number).
- Sessions, audit log, and executions all live in the same blob.

### C7. Fail-open security defaults
- Stripe and Twilio webhook signature checks are **skipped when the secret env var is empty** (lines ~2705–2710, ~2775): "No STRIPE_WEBHOOK_SECRET configured — skipping signature check". A forgotten env var = anyone can forge payment events. Must fail closed in production.
- Twilio signature URL is hardcoded `https://${host}${url}` (behind a proxy this will mismatch; behind http it will mismatch).
- `SESSION_SECRET` falls back to a literal string (line 68) with no production guard. `docker-compose.yml` and `.env.example` ship real-looking default DB passwords and a session secret.
- CORS is hardcoded to `http://localhost:5173` in three places (lines ~369, ~1209, ~3598). Fine for dev, a break or a bad habit in prod.
- Rate limiter is an in-memory `Map` (per-process; useless with 2+ instances; resets on deploy).
- **No bot protection** (no captcha, honeypot, or Turnstile) on public form submit, booking, funnel opt-in, webchat widget, review submit. These endpoints create CRM records and trigger workflows → spam/lead-poisoning and workflow-cost attacks.
- Public portal endpoints (`/api/portal/*`) authorize by contact identifiers in the URL; needs a signed, expiring magic-link/session model.

### C8. Compliance theater
- A2P 10DLC registration (line ~4973) transitions straight to `VERIFIED_10DLC`. There is no Twilio Trust Hub / TCR call. If you sell this to agencies as "carrier compliance," a real carrier will block their traffic and they will blame you.
- No quiet-hours, DND, STOP/HELP handling guarantees, consent ledger, or per-contact channel opt-in enforcement before send.
- "E-signature" has a `signedAt` and name field; no certificate of completion, IP/UA capture, hash of the signed PDF, or tamper evidence. Not legally defensible as shipped.

### C9. QR codes are not QR codes
- `generateQrSvg()` (line ~141) draws **pseudo-random squares seeded by a hash** around three finder patterns. It will not scan. A "QR Codes" feature that cannot be scanned is worse than no feature.

### C10. Docs lie, and contradict each other
- README: "React 19", "Tailwind" — `package.json`: React **18.3.1**, **no Tailwind** anywhere.
- README repo tree lists `CopilotWidget.tsx` and `Layout.tsx` — neither exists (`CopilotHub.tsx`, `AppShell.tsx` do).
- README badge: "72/72 tests". Readiness report: "85/85" (8 engine + 77 e2e). The two docs disagree with each other, and I could not confirm either count by reading (I did not execute them). The e2e suite is a single custom 139 KB script, not a standard runner, so there is no coverage report, no per-test isolation and no parallelism.
- README calls the queue "BullMQ"; `queue.mjs` is a **hand-rolled RESP client** doing `LPUSH`/`ZADD` — compatible with nothing, supports no BullMQ features (stalled-job recovery, rate limiting, flows, dashboards).
- `apps/web/package.json` description: "an original, from-scratch agency CRM workspace that **mirrors the module layout of an all-in-one marketing platform. Educational project.**" That sentence is a legal/branding liability in a product that markets itself as a GHL competitor. Remove it.
- `FINAL_ENTERPRISE_READINESS_REPORT.md` grades every area 100/100 "A+ CERTIFIED". Delete it or replace it with this audit. An AI agent reading it will skip work.

---

## 3. MAJOR FINDINGS (P1)

### M1. Frontend has two sources of truth
- `store.tsx` (1,978 lines) is a reducer persisted to **`localStorage` key `operza.workspace.v14`**, bootstrapped from a **62 KB `seed.ts`** of demo data. ~40 pages read/write this store.
- ~50 pages import the API client; some pages (Calendars, Forms, Orders, Affiliates, Conversations) call `api.crm.*` — others never do. The same entity can exist in the browser only, the server only, or both and diverge.
- Consequences: data created on laptop A isn't on laptop B; "multi-user" collaboration is impossible; clearing the browser deletes the CRM; new signups see demo contacts; and bugs are untraceable because you don't know which layer a page is using.
- `uid()` uses `Math.random()` (collision-prone).

### M2. Workflow engine is a good start, not n8n
Missing vs n8n: **credential vault**, expression language (only `{{template}}` substitution), parallel branches & **merge/join**, sub-workflows, error-workflow routing, per-node retry/timeout/continue-on-fail config, execution **replay/resume from node**, real data pinning (README claims it), test-vs-production webhook URLs, versioning/drafts/publish, environments, a **code node (sandboxed JS)**, 400+ app nodes, loops over batches with rate control, queue-mode horizontal workers, execution pruning, AI agent node with tools/memory.
Missing vs GHL: contact-centric triggers like "customer replied", "appointment status", "invoice paid/overdue", "membership progress", "inbound call", "IVR"; GoTo-style wait-until conditions; goal events; workflow **enrolment rules** (re-entry, stop-on-response), bulk enrol, and per-contact **workflow history UI**.
Also: the visual canvas is custom SVG (28 KB). Fine for a demo; for n8n-grade UX, move to a maintained graph lib (React Flow).

### M3. Monolith, no validation, no contract
- One 6.7k-line file; no router, no middleware pipeline, no schema validation (the `collections` map has `required`/`fields` lists, nothing checks types/lengths), no OpenAPI, no versioned API, no error taxonomy. Generic CRUD `/api/crm/:collection` accepts arbitrary fields subject to a field list — good start but needs per-field validation, permissions, and hooks.
- No pagination/sort/filter contract (list endpoints return arrays); will not scale.
- `RATE_LIMIT_AUTH_MAX` etc. exist but no account lockout, no 2FA, no password reset flow, no email verification, no session listing/revocation UI, no RBAC beyond a `role` string (verify per-route enforcement before trusting it).

### M4. Tooling gaps
- `npm run lint` is defined, but **no ESLint config file exists** — lint is broken.
- **Zero frontend tests**, no component tests, no Playwright, no visual regression, no a11y tests.
- `api/package.json` depends on `pg` and `ws` only; no `zod`, `pino`, `helmet`, etc. `.env.example` lists SendGrid/SMTP/Twilio/Stripe keys that no code reads.
- No `tsc` for the API (plain `.mjs`) → no types shared with the web app (`packages/shared` is 2.6 KB and unused by the API).

### M5. SEO / metadata is half-done
- `SEO.tsx` sets meta tags in `useEffect` — **client-side only.** Crawlers that don't execute JS (many social scrapers, some AI crawlers, Bing in some cases) see only the static `index.html` tags — the same title/canonical (`https://operza.io/`) for every route.
- `og:image` / `twitter:image` is an **SVG** (`og-image.svg`). Facebook, LinkedIn, X, Slack and WhatsApp generally do not render SVG OG images. Need a 1200×630 PNG/JPG per page.
- Sitemap is static (2.5 KB) — doesn't include blog posts, platform pages, docs articles dynamically.
- Marketing pages, blog and docs live inside the same SPA bundle — no prerendering/SSG, so LCP/INP suffer and indexing is slower.
- No hreflang, no per-page JSON-LD verification, no breadcrumb schema, no pricing `Offer` schema, no FAQ schema (can't verify without running; confirm in implementation).
- **Tenant-facing pages** (funnels `/funnel/`, forms `/f/`, booking `/book/`) are the real SEO product for agencies. They are SPA-rendered from API JSON — no server-rendered HTML, no per-page meta from the builder, no custom-domain canonicalization.

### M6. Accessibility & UX debt (from code skim)
- 119 `aria-`/`role=` occurrences across ~100 files is thin for a dashboard this size; modals, menus, kanban drag-and-drop, and the canvas need keyboard and screen-reader paths.
- No i18n layer (strings inline), no RTL support, no timezone/locale strategy beyond defaults.
- Navigation: ~40 sidebar destinations is the GHL problem copied 1:1. No command palette, no global search, no recents/favorites.

### M7. Product/IP risk
- Feature names are GHL's trade vocabulary almost verbatim (Snapshots, Smart Lists, Trigger Links, Custom Values, Sub-Accounts, Sites & Funnels, Reputation, Memberships). Not illegal per se, but naming/trade-dress closeness invites trouble and weakens your brand. Decide deliberately which to rename. (This is not legal advice — get counsel before launch.)

---

## 4. WHAT YOU ARE MISSING TO ACTUALLY COMPETE

### Versus GoHighLevel (the CRM + marketing + white-label side)
1. **Real channels:** outbound SMS/MMS, email with domain auth (SPF/DKIM/DMARC), WhatsApp Business, Facebook/Instagram DMs, Google Business messages, live chat — with delivery status, retries, opt-out and consent handling.
2. **Real money:** Stripe Connect (agency + sub-account), products/prices, checkout sessions, subscriptions, invoices, dunning, refunds, taxes, and **SaaS mode** (resell Operza with wallet rebilling and markup).
3. **Voice:** browser dialer (WebRTC), call recording, voicemail drop, call tracking numbers, IVR, transcription.
4. **Calendar sync:** Google/Outlook two-way, conferencing links, reminders, round-robin, payments at booking.
5. **Reputation:** Google Business Profile reviews, review request automation, sentiment.
6. **Social planner:** real publishing to FB/IG/LinkedIn/TikTok/GBP.
7. **Funnels/websites:** server-rendered pages, custom domains with auto-SSL, A/B tests, form/page analytics.
8. **Reporting/attribution:** UTM + pixel capture, first/last/multi-touch revenue attribution, ad-spend import, scheduled reports.
9. **White-label:** custom domain per agency, branded login, branded mobile PWA/app, plan & feature gating, usage metering.
10. **Mobile experience** (PWA at minimum) and push notifications.

### Versus n8n (the automation side)
1. **Integration breadth + credential vault + OAuth2 flows** (this is n8n's moat; you need an SDK so integrations are cheap to add).
2. Expressions, code node, sub-workflows, error workflows, parallel/merge, replay, versioning.
3. Queue-mode scalability, observability, execution retention policies.
4. Self-host story: Helm/Docker, backups, upgrades, license/telemetry policy.
5. AI agent nodes, tool nodes, memory, vector store nodes, evals.

### Your possible wedge (so you don't just clone both)
"**GHL's business objects with n8n-grade automation and a real AI workforce, open-source and self-hostable.**" Pick 3 killer demos and make them flawless: (1) lead comes in → AI replies in <10 s on SMS/WhatsApp, qualifies, books on calendar; (2) pay → onboard → course/portal access automatically; (3) agency snapshot deploy to 50 sub-accounts with diff/sync.

---

## 5. RISK REGISTER (top 12)

| # | Risk | Likelihood | Impact |
|---|---|---|---|
| 1 | Free orders via public checkout | Certain | High |
| 2 | Forged webhooks when secret unset | High | High |
| 3 | Cross-tenant leak from a missed `.filter` | Medium | Critical |
| 4 | Data loss from single-blob write / multi-instance | High | Critical |
| 5 | Users trust fake "sent/connected" statuses | Certain | High (reputation) |
| 6 | Carrier blocking due to fake A2P | High | High |
| 7 | Misleading AI/RAG claims | Certain | High (legal/brand) |
| 8 | Spam through unprotected public endpoints | High | Medium |
| 9 | Media serving breaks after restart | High | Medium |
| 10 | AI agent skips work because docs say 100/100 | High | High (project) |
| 11 | Trademark/trade-dress exposure | Medium | Medium–High |
| 12 | No tests = regressions on every change | Certain | High |

---

## 6. WHAT I COULD NOT VERIFY (be honest)
- I did not run the app, so UI polish, bugs at runtime, and the 85 claimed tests were not executed.
- I read engine/server hot spots (copilot, checkout, integrations, webhooks, persistence, API keys, triggers, media, A2P) but not every one of the ~130 route branches, nor every page's UI. Antigravity must treat this audit as a starting map and re-verify each finding before changing code (see Master Prompt, Rule 3).
- `docs/KEYWORD_STRATEGY.md`, `CONTENT_STRATEGY.md`, `SEO_*` reports were not reviewed line by line; reuse what is sound.
