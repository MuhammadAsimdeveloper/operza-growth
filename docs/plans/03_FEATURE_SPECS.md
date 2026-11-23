# OPERZA — FEATURE SPECS (build-ready)

Each spec: **Goal → Why (vs GHL/n8n) → Data → API → UI → Logic & edge cases → Acceptance**. Table/column names are suggestions; keep conventions from `02_MASTER_PLAN.md §C–D`.

Priority legend: **P0** = needed for credible launch, **P1** = competitive parity, **P2** = differentiator.

---

## F1. Integration Hub, Credential Vault & Integration SDK (P0)

**Goal:** make adding an integration a 1–2 day job, and make connecting one real and secure. This is n8n's moat; without it Operza is a closed CRM.

**Data**
- `credential_types(id, name, auth_kind[api_key|oauth2|basic|bearer|custom], schema_json, oauth_config_json)`
- `credentials(id, agency_id, location_id?, type_id, name, encrypted_blob, key_version, status, last_verified_at, owner_id)` — AES-256-GCM envelope encryption: per-row data key wrapped by a master key (env/KMS); rotation job re-wraps.
- `integration_connections(id, credential_id, provider, account_label, scopes, expires_at, refresh_state)`

**SDK contract** (`packages/integrations`): each integration is a folder exporting
```ts
defineIntegration({
  id: 'slack', name, icon, category,
  auth: oauth2({ authUrl, tokenUrl, scopes, pkce: true }),
  triggers: [ { id:'new_message', kind:'webhook'|'poll', inputSchema, outputSchema, subscribe(), unsubscribe(), poll() } ],
  actions:  [ { id:'send_message', inputSchema(zod), outputSchema(zod), run(ctx, input) } ],
  test(ctx) // real call to verify credential
})
```
`ctx` gives: `http` (with retry/backoff, timeouts, SSRF guard), `credential` (decrypted just-in-time), `logger`, `state` (per-trigger cursor store), `files`.
- Pagination helpers, rate-limit helper (honors `Retry-After`), error taxonomy (`AuthExpired`, `RateLimited`, `Retryable`, `UserError`).
- Auto-generated config UI from the Zod schema (fields, selects with **dynamic options** loaded via `loadOptions()` e.g. list Google Sheets).
- Auto-generated docs page per integration.

**API**
- `GET /integrations` (catalog), `POST /credentials`, `POST /credentials/:id/test`, `GET /oauth/:provider/start`, `GET /oauth/:provider/callback`, `DELETE /credentials/:id`.
- Generic **HTTP Request node** with credential reference, plus **Webhook** and **GraphQL** nodes (for anything missing).

**UI**
- Integrations page: searchable catalog with categories, status chips (Not connected / Connected / Needs re-auth / Error), "Connect" opens OAuth popup or secure form; secrets are write-only (never shown again); "Test" runs real call; usage tab shows which workflows use the credential; "Rotate" and "Revoke".
- In workflow node config: credential picker with inline "Create new".

**Logic/edge**
- Refresh tokens with locking so parallel jobs don't double-refresh; mark `AuthExpired` and notify owner; pause dependent workflows with reason.
- SSRF protection: block private IP ranges/metadata endpoints for HTTP node unless self-host admin allows.
- Per-agency egress allowlist (optional).

**Launch set (25):** Stripe, Twilio, SendGrid/SES/Mailgun/SMTP, Gmail/Outlook, Google Calendar/Outlook Calendar, Google Sheets/Drive, Slack, Discord, Telegram, WhatsApp Cloud, Facebook/Instagram, Google Business Profile, Zoom/Meet, Notion, Airtable, HubSpot (import), Zapier/Make inbound webhooks, OpenAI/Anthropic/Gemini (AI), Calendly import, Shopify, WooCommerce, QuickBooks (invoices), Zoho (import), Meta Ads/Google Ads (reporting).

**Acceptance:** add a new integration with 1 trigger + 1 action in < 1 day using only the SDK; secrets never appear in logs/API responses; token refresh race test passes; a credential used by an active workflow can't be deleted without a confirm that lists dependents.

---

## F2. Workflow Engine v2 + Canvas (P0)

**Goal:** n8n-grade power with GHL-grade CRM context.

**Engine changes (`packages/workflow-engine`, keep pure; I/O via adapters)**
1. **Graph model v2:** nodes + edges with typed ports (`main`, `true`, `false`, `error`, `item`). Edges carry data items (array of JSON items like n8n) so nodes can run per-item.
2. **Expressions:** `{{ $json.email }}`, `{{ $node["HTTP"].json.id }}`, `{{ $contact.firstName }}`, `{{ $env }}`, helpers (`$now`, `$dateAdd`, `$lower`, `$jsonParse`…). Implement a sandboxed evaluator (e.g. `expr-eval`/custom parser — **not `eval`**), with autocomplete in UI.
3. **Parallel branches + Merge node** (modes: wait-all, first, append, combine-by-key). **Split in Batches** with concurrency + rate limit.
4. **Sub-workflow node** (call another workflow with inputs, await output) and **Error Workflow** per workflow.
5. **Per-node settings:** retries (count, backoff), timeout, continue-on-fail, always-output-data, notes, disable node.
6. **Code node:** JS in an isolated runtime (isolated-vm / worker with CPU+memory limits, no network unless allowed, no `require`). Return items.
7. **Wait nodes:** wait duration, wait until datetime, **wait for event** (contact reply, payment, form, webhook callback with resume URL) with timeout branch.
8. **Versioning:** `workflow_versions` immutable; Draft vs Published; rollback; diff view.
9. **Enrollment rules (GHL parity):** allow re-entry yes/no, stop on reply, stop on stage change, bulk enroll from a Smart List, "goal" events that exit contact early, per-contact history.
10. **Execution durability:** each step persisted; on worker crash, job resumes from last completed step; idempotent step keys so a message is never sent twice.
11. **Pinned data & test runs:** run single node with pinned input; "test workflow" with sample contact; live data inspector per edge.
12. **Triggers:** keep the existing ~23; add inbound call, customer replied (per channel), invoice paid/overdue, membership lesson complete, appointment status change, calendar event updated, Gmail/IMAP new email, schedule (cron with tz), manual/bulk, webhook (test URL & production URL), polling triggers from integrations, **AI intent detected**.
13. **Limits & safety:** max nodes, max loop iterations, max execution time, per-tenant concurrency, cost caps (SMS/AI) with approval gates; loop protection (cycle detection at publish).
14. **Execution retention:** configurable (e.g. 30 days) with prune job; store large payloads in object storage with pointer.

**Canvas (React Flow)**
- Infinite canvas, minimap, snap-to-grid, multi-select, copy/paste (incl. between workflows), undo/redo, keyboard shortcuts, node search palette (`Tab`/`/`), auto-layout (dagre/elk), sticky notes, node grouping, zoom-to-fit, collapsible node details.
- Node card shows icon, name, status ring (last run), item counts on edges during execution (live via WebSocket).
- Right drawer: Parameters / Settings / Input / Output / Logs; JSON + table + schema views; "Pin data".
- Executions page: filter by status/date/workflow/contact; open a past run **on the canvas**; "Retry from failed node", "Replay with edited input".
- Linear list view stays as an accessible alternative (screen-reader friendly).

**Acceptance:** 100-node workflow stays 60 fps on pan/zoom; killing the worker mid-run → run completes exactly once; sub-workflow + error workflow tests; expression sandbox can't access `process`/`require`; cycle detected on publish with clear error.

---

## F3. Conversation AI & Voice AI Agents (P0 differentiator)

**Goal:** an AI that actually answers leads on SMS/WhatsApp/webchat/email/voice, qualifies, books, hands off — safely.

**Data:** `ai_agents(id, name, channel_set, persona, goals, system_prompt, model, temperature, guardrails_json, tools_json, handoff_rules_json, working_hours, languages, status)`, `ai_agent_versions`, `knowledge_sources(id, kind[file|url|text|faq|crm], status)`, `knowledge_chunks(id, source_id, content, embedding vector(1536), metadata)`, `ai_runs`, `ai_tool_calls`, `ai_evals`, `ai_usage`.

**Runtime (`packages/ai`)**
- Provider-agnostic gateway (OpenAI, Anthropic, Gemini, local via OpenAI-compatible) with per-tenant BYO key or platform key (metered). Streaming over SSE; timeouts; fallbacks.
- **Tool registry** (Zod-typed): `search_knowledge`, `get_contact`, `update_contact`, `add_tag`, `create_task`, `check_availability`, `book_appointment`, `move_opportunity`, `send_message` (rate-limited), `create_payment_link`, `escalate_to_human`, `trigger_workflow`, `http_call` (allowlisted).
- **RAG:** ingestion pipeline (upload PDF/DOCX/URL crawl/FAQ/CRM fields) → chunk (semantic, 400–800 tokens, overlap) → embed → pgvector (HNSW) with `agency_id` filter; hybrid search (BM25 + vector) + rerank; citations returned; "no answer → handoff" rule.
- **Memory:** conversation window + rolling summary + contact facts.
- **Guardrails:** forbidden topics, price/discount limits, PII redaction in logs, jailbreak/prompt-injection filters on inbound text and retrieved docs, max messages per contact per day, quiet hours, compliance footers, language detection.
- **Approval policy:** per tool: `auto | require_approval | forbidden`, with value thresholds (e.g., deals > $5k need approval — matches existing `requireApprovalForDealsOver`). Approval requests appear in Inbox + notification + Slack.
- **Handoff:** triggers (sentiment negative, asked for human, confidence low, N failed turns) → assign to user/team, add internal note summary, pause AI on that conversation; "AI resume" button.
- **Voice agent:** Twilio Media Streams / SIP → STT (streaming) → LLM → TTS (streaming) with barge-in, <800 ms turn latency target, call recording, transcript, summary, outcome tagging, voicemail detection, warm transfer. (Ship after text agent; P1.)
- **Evals:** golden conversation sets, rubric graders (LLM-as-judge + deterministic checks), regression run on every prompt/version change, red-team pack. Show pass rates in UI before publishing a version.
- **Costs:** per-run token + provider cost recorded; plan limits; hard stop and alert at thresholds.

**UI:** Agent builder (Persona • Knowledge • Tools & permissions • Guardrails • Channels & hours • Test chat • Evals • Versions • Analytics). Test chat shows tool calls, retrieved chunks, and cost live. Inbox shows "AI replied" label with "Why this answer?" panel.

**Acceptance:** inbound SMS "Do you open Sundays? Book me Tuesday 3 pm" → agent retrieves hours, checks availability, books, confirms, logs activity, in < 10 s; "refund me $5000" → escalated, no refund executed; prompt-injection in a PDF doesn't change behavior; eval suite gates publish.

---

## F4. Unified Inbox v2 (P0)

**Goal:** the daily-driver screen. Real channels, fast, collaborative.

- **Channels:** SMS/MMS, email (threaded, with attachments and signatures), WhatsApp (templates + 24 h window logic), FB Messenger, Instagram DM, Google Business Messages (if available), webchat widget, internal chat, call log.
- **Model:** `conversations` per contact+channel group, `messages` with `status` lifecycle `queued → sent → delivered → read | failed` driven by provider callbacks; failures show error reason with "Retry".
- **Features:** assignment & round-robin, teams, statuses (open/snoozed/closed), snooze with wake time, labels, saved replies/snippets with merge fields, internal notes and @mentions, collision detection ("Sam is typing"), scheduled send, translate, **AI assist** (summarize thread, suggest reply in brand voice, tone fix, extract tasks), SLA timers (first response / resolution) with breach alerts, bulk actions, keyboard shortcuts (J/K, E, S, R), search across messages (pg full-text), contact sidebar (timeline, deals, tasks, custom fields, consents), unsubscribe/DND badges, typing indicators over WebSocket, desktop/mobile push.
- **Rules before send (server-enforced):** consent check per channel/purpose, DND/quiet hours (contact timezone), message length/segment counter, opt-out keywords (STOP/UNSUBSCRIBE/START/HELP), WhatsApp window/template rule, rate limits per number.
- **Acceptance:** message sent from UI reaches a real phone and updates to `delivered` via webhook; STOP reply auto-sets SMS consent=false and blocks further sends (including from workflows); two agents can't double-reply (soft lock).

---

## F5. Email Marketing & Deliverability Engine (P0)

- **Sending domains:** add domain → show DNS records (SPF, DKIM, DMARC, return-path, tracking CNAME) → verify via DNS lookup → status; support provider modes: SES, Mailgun, SendGrid, SMTP, or **built-in via Postal/Haraka** for self-host.
- **Builder:** drag-and-drop email editor (MJML → HTML) with blocks, brand kit, dark-mode preview, merge tags + fallbacks, dynamic content blocks by segment, plain-text auto, spam-score + link checker, inbox preview (litmus-style optional), save as template.
- **Campaigns:** audience from Smart List/tags/segments, exclusion lists, send now/scheduled/time-zone aware/best-time (P2), **A/B tests** (subject, content, send time) with auto-winner, throttle (per hour), warm-up schedules for new domains/IPs, resend to non-openers.
- **Tracking:** open (pixel, with Apple MPP caveat flagged), click (rewritten links), unsubscribe (one-click `List-Unsubscribe` + RFC 8058), bounces (hard/soft), complaints (FBL), suppression list management, per-contact event timeline.
- **Compliance:** CAN-SPAM footer enforcement, physical address required, double opt-in option, preference center, GDPR consent log.
- **Reports:** sent/delivered/open/click/bounce/complaint/unsub, link heatmap, revenue attribution, device/client breakdown.
- **Acceptance:** DKIM-signed mail passes in Gmail "Show original"; unsubscribed contacts are never emailed again by any workflow or campaign; bounce webhook suppresses address.

---

## F6. Payments, Billing & Commerce (P0)

- **Stripe Connect** (Standard or Express) for agencies and sub-accounts; platform fee support; also allow PayPal/Razorpay/local gateways via adapter (a Pakistan/South-Asia gateway adapter such as Easypaisa/JazzCash/PayFast is a real regional differentiator — verify provider APIs before committing).
- **Catalog:** products, prices (one-time, recurring, tiered, usage), coupons, taxes (Stripe Tax or manual rules), shipping (digital default).
- **Checkout:** server creates Stripe Checkout Session / PaymentIntent; order bumps, upsells/downsells (one-click using saved payment method), cart abandonment event, address/tax collection, **order created `pending` → `paid` only from verified webhook**.
- **Invoices:** create, send, remind, partial payments, recurring invoices, PDF (branded), payment links, customer portal.
- **Subscriptions:** trial, proration, pause, cancel at period end, dunning (smart retries + email/SMS sequence via workflow), failed-payment triggers.
- **Refunds/disputes:** refund from UI → Stripe → webhook; dispute alerts; revoke access automatically (membership, course) via workflow.
- **Affiliates:** link tracking with cookie + server-side attribution, commission rules, refund clawback, payout reports (Stripe Connect payouts or CSV).
- **Ledger:** double-entry-light `payments`, `refunds`, `payouts`, `wallet_transactions` reconcilable to Stripe balance transactions.
- **Idempotency & safety:** all payment mutations require `Idempotency-Key`; amounts in minor units (integers); currency per price; webhook handler is the **only** place that marks money state.
- **Acceptance:** Stripe test-card payment completes, order paid, invoice PDF made, workflow "payment received" runs once even if webhook is delivered 3×; refund reverses access; tampering with price in the request is ignored (server prices only).

---

## F7. SaaS Mode, White-Label & Usage Billing (P1)

- **Plans:** agency defines plans (features, limits, price) → sells to sub-accounts via Stripe subscriptions; auto-provision sub-account + snapshot on purchase; auto-suspend on non-payment.
- **Wallet & rebilling:** prepaid wallet per sub-account; metered usage events (SMS segments, email, call minutes, AI tokens, phone numbers) priced at agency markup; auto-recharge; low-balance alerts; usage reports; hard stop at 0.
- **White-label:** custom app domain (`app.agency.com`) with auto-SSL (Caddy on-demand TLS or Cloudflare for SaaS), branded login, logo/colors/favicons, custom email sender domain, custom support links, hide "Operza" branding, branded PWA manifest per agency.
- **Feature gating:** `plans.features` + permission checks; upsell prompts for locked features.
- **Snapshots v2 / Marketplace:** versioned snapshots (workflows, pipelines, forms, funnels, calendars, custom fields/values, templates, AI agents) with dependency resolution, variable placeholders, **diff & selective sync** (keep existing differentiator), "install from link", public/private marketplace with pricing.
- **Acceptance:** buying Plan A on agency's own checkout creates a sub-account with the snapshot in < 10 s and bills usage from the wallet.

---

## F8. Funnel, Website & Form Builder v2 + Page Renderer (P0/P1)

- **Block schema:** pages are JSON trees (`section → row → column → block`), versioned, validated by Zod; **one renderer** used by editor preview and server SSR so what you edit = what's served.
- **Blocks:** headline, text, image, video, button, form, calendar embed, countdown, testimonial, FAQ (with FAQ schema), pricing table, checkout, order bump, survey/quiz, popup, custom HTML/CSS (sandboxed), reusable global sections, navigation/footer.
- **Editor:** drag/drop (dnd-kit), responsive breakpoints with per-breakpoint overrides, undo/redo, autosave, version history, comments, AI copy/image helper, brand kit, 100+ templates (via marketplace).
- **Server rendering:** HTML with critical CSS inline, image optimization (AVIF/WebP, srcset), lazy-load, preload fonts, no layout shift; ISR-style caching with purge on publish; target LCP < 2 s.
- **Per-page settings:** title, meta description, canonical, robots, OG image (auto-generated 1200×630), JSON-LD builder, tracking scripts (GA4/Meta pixel/TikTok) with consent-mode, favicon, custom head/body code, redirects (301 manager), slug.
- **Funnel logic:** steps, A/B split (sticky variants), conditional routing, UTM persistence, form → contact + workflow, abandoned-step events.
- **Domains:** connect custom domain → DNS instructions → verify → auto-SSL; `www` ↔ apex redirects; per-domain sitemap.xml & robots.txt generated.
- **Analytics:** views, unique visitors, conversion by step, source/medium, device, revenue per visitor; heatmaps/session replay (P2).
- **Acceptance:** `curl` of a published page returns full HTML with title/meta/OG/JSON-LD (no JS needed); passes Lighthouse SEO 100 and a11y ≥ 95; edits in builder appear identically on public page.

---

## F9. Scheduling & Calendar v2 (P1)

- Two-way **Google/Outlook** sync (OAuth, webhooks/push channels, free/busy), conferencing auto-links (Meet/Zoom/Teams).
- Calendar types: 1:1, round-robin (weighted, with availability), collective, class/group, service with resources (rooms/equipment).
- Rules: availability windows per user, buffers, min-notice, max/day, date overrides, holidays, timezone detection, **no double-booking** enforced with DB constraint (`EXCLUDE USING gist` on tstzrange per resource) + transactional slot lock.
- Booking page: embed/inline/popup, custom questions, payment at booking (Stripe), deposit, cancellation/reschedule links, SMS/email reminders (workflow-driven), no-show handling, ICS attachments.
- Team views, calendar day/week/month, drag to reschedule.
- **Acceptance:** two simultaneous requests for the same slot → exactly one succeeds; external calendar event blocks availability within 1 min.

---

## F10. Voice, Dialer & Call Tracking (P1)

- Twilio Voice SDK WebRTC softphone in app (mute/hold/transfer/DTMF), call from contact record, incoming call popup with contact context.
- Number management: search/buy/port numbers, local presence, call tracking numbers per campaign (dynamic number insertion on pages, P2), IVR builder (drag/drop menu → queue/voicemail/forward/workflow), business hours routing, call queues, whisper/barge (P2).
- Power/auto dialer with lists, dispositions, local-time compliance, DNC scrub, abandonment control; voicemail drop; call recording with consent announcement by region; transcription + AI summary + sentiment; missed-call text-back (existing trigger — make it real).
- **Acceptance:** outbound call connects and recording + transcript attach to the timeline; DNC contact blocked server-side.

---

## F11. Reputation Management (P1)

- Google Business Profile API: fetch reviews, reply from Operza, post updates; Facebook recommendations; Yelp (read-only where API permits); Trustpilot (via API if available).
- Review request campaigns (SMS/email/QR/NFC) with smart routing: happy → public review link, unhappy → private feedback form + alert (comply with platform review-gating rules — don't gate in ways platforms forbid; keep this configurable and documented).
- AI reply drafts, sentiment tagging, widgets (embed reviews with schema `AggregateRating`), monthly report.
- Fix QR codes (P0 item 0.9).

---

## F12. Social Planner (P1)
- OAuth to FB Pages, Instagram (Graph API), LinkedIn, X, TikTok, GBP, YouTube (provider APIs change; verify limits before build). Compose once, customize per network, media editor, scheduling with queue, calendar view, approval workflow, hashtag/caption AI, link shortener with UTM, analytics pull, failed-post retries with clear errors.

---

## F13. Attribution, Analytics & Reporting (P1)
- First-party tracking script (cookie-less option) capturing visitor, session, UTMs, referrer, click IDs (gclid/fbclid) → stitched to contact on form/checkout/email click.
- Attribution models: first, last, linear, position-based; revenue per source/campaign/ad; ad-spend imports (Meta/Google) → ROAS/CAC/LTV.
- Dashboard builder (widgets: KPI, funnel, cohort, table, time series), saved reports, scheduled PDF/email reports, CSV/Sheets export, white-label share links.
- Query layer: materialized views/rollups (or ClickHouse/DuckDB option) so dashboards stay fast at scale; define metrics in one semantic layer.
- **Acceptance:** a contact who came from `utm_source=fb` and paid shows revenue under that campaign across models.

---

## F14. Security, RBAC & Compliance Center (P0)

- **RBAC:** roles (Owner, Admin, Manager, Agent, Viewer, Custom) × permissions (resource.action) × scope (agency / location / assigned-only). UI matrix editor. Enforcement in one middleware; tests assert every route has a permission.
- **Auth:** TOTP 2FA (enforce per agency), passkeys (WebAuthn), SSO (OIDC/SAML) for higher plans, session management, IP allowlist, login alerts, device list.
- **Audit:** immutable audit log with export (CSV/JSON/SIEM webhook), filters, retention.
- **Privacy:** consent ledger, DSAR export/delete (contact-level), data retention policies, PII masking in logs, regional data residency flag (self-host), cookie-consent banner builder for funnels.
- **Messaging compliance:** A2P 10DLC via Twilio Trust Hub (brand → campaign → number assignment; real status polling), TCPA quiet hours, STOP/HELP, DNC; email CAN-SPAM/GDPR; WhatsApp opt-in rules.
- **Platform:** CSP, HSTS, rate limits, WAF recommendations, dependency scanning, secret scanning, SBOM, backup encryption, security.txt, responsible-disclosure page.

---

## F15. Public API, Webhooks & App Platform (P1)
- **REST v1** auto-documented (OpenAPI), stable versioning, cursor pagination, filtering, idempotency keys, rate-limit headers, problem+json errors; scopes per key; **OAuth2** (auth code + PKCE) for third-party apps; app marketplace listing.
- **Outbound webhooks:** event catalog (contact.*, opportunity.*, message.*, order.*, appointment.*…), HMAC-SHA256 signatures + timestamp, retries with exponential backoff, dead-letter, delivery log with replay, test event button.
- **SDKs:** JS/TS generated; Python generated; Postman collection; CLI (`operza`) for snapshots & workflows as code (GitOps: export/import workflows as JSON/YAML).
- **Embeds:** JS widget for chat/booking/forms; iframe SSO.
- **Acceptance:** API key with `contacts:read` can't write; webhook consumer verifies signature using the documented snippet.

---

## F16. AI Workflow Builder & Recipe Library (P2 differentiator)
- "Describe it" → generates a draft workflow graph (validated against the node schema; user reviews on canvas before enabling; never auto-activates).
- Recipe gallery (50+): speed-to-lead, missed call text-back, review request, no-show recovery, abandoned checkout, onboarding, webinar funnel, invoice dunning, referral program, birthday, reactivation, AI receptionist, etc. One-click install with variable mapping wizard.
- "Explain this workflow" and "Why did this fail?" AI helpers reading execution logs.

---

## F17. Mobile PWA & Notifications (P1)
- Installable PWA (manifest per white-label agency, service worker for shell caching, offline read for recent conversations), Web Push, mobile-first inbox/contacts/pipeline/calendar/dialer, camera upload, biometric unlock. Native wrapper (Capacitor) later for store distribution.

---

## F18. Platform Admin / Super-Admin Console (P1, needed to run it as a business)
- Tenant list, plan, usage, health; impersonation with audit and customer consent; queue & worker dashboards; feature flags per tenant; abuse tools (suspend, rate-limit, spam detection); billing for self-hosted-cloud; system status; migrations control; webhook/integration health; AI cost dashboards.

---

## F19. Onboarding, Activation & Sandbox (P0)
- Replace seeded demo with: signup → choose goal (agency / local business / coach / ecommerce) → connect first channel → import contacts (CSV mapper with dedupe & preview, or HubSpot/GHL-export import) → install a recipe → checklist with progress → "Send test lead" button to see the whole loop in 5 minutes.
- Sandbox location with sample data (labelled "Demo") that's one click to delete; interactive product tour; empty states with CTAs; in-app help search with docs.
- **Migration tools:** "Import from GoHighLevel/HubSpot/Zoho/CSV" (contacts, tags, pipelines, custom fields) — critical for winning switchers.

---

## F20. Lead Capture Safety & Quality (P0)
- Honeypot, time-trap, Turnstile/hCaptcha, disposable-email and email/phone validation (syntax + MX + optional paid verify API), duplicate detection with merge suggestions (already `merge` endpoint — add rules UI), consent checkbox text stored with each submission, double-opt-in, per-form spam score, quarantine folder with review.

---

## BUILD ORDER SUMMARY (matches phases)
P0: 0.x fixes → F14 (RBAC/2FA) → data layer → F19, F20 → F4 → F5 → F6 → F1 → F2 → F3 (text) → F8 → marketing/SEO.
P1: F9, F10, F11, F12, F13, F15, F17, F18, F7.
P2: voice AI, F16, session replay, ClickHouse analytics, native apps.
