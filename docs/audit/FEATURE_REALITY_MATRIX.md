# OPERZA — FEATURE REALITY MATRIX

Every module in the codebase is categorized according to its genuine operational reality rather than decorative UI or marketing claims.

## Classification Tiers:
- **Production Functional (PF):** Fully integrated, tested end-to-end, persists to durable storage, verified security.
- **Functional With External Credentials (FC):** Implementation is genuine and tested with mocks/stubs; requires user API credentials for live external traffic.
- **Partially Functional (PFN):** Works in core happy paths, but lacks edge case handling, recovery, or full persistence.
- **Simulation / Mock Only (SM):** Actions appear successful in the UI but only update an in-memory mock or fake record.
- **UI-Only (UI):** Screen exists with buttons and forms, but does not execute real backend logic.
- **Broken (BR):** Throws unhandled exceptions or produces corrupt state.

---

## Reality Matrix

| Module / Feature | Reality Status | Notes & Verification Evidence |
| :--- | :---: | :--- |
| **Authentication (Email/Password, Session Cookies)** | **PF** | Bcrypt/Scrypt hashing, session tokens, audit logging verified in `test-auth-and-db.mjs`. |
| **Google OAuth 2.0 Login** | **FC** | Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; auth code exchange implemented. |
| **CSRF Protection** | **PFN** | Server validates `x-operza-csrf` against session hash, but frontend cookie pickup was fragile due to missing token in `/api/auth/session` response. |
| **Agency CRM Contacts & Deals** | **PFN** | Works via in-memory array and JSON snapshot; needs full PostgreSQL relational normalization. |
| **Visual Workflow Engine** | **PF** | DAG execution, conditions, templates, approval gates, code nodes, loop prevention verified in 14 unit tests. |
| **Outbound Webhook / HTTP Nodes** | **PF** | SSRF protection blocks private IPs, metadata IP (`169.254.169.254`), and non-HTTP protocols. |
| **Copilot Enterprise AI (LLM / RAG / Memory)** | **FC** | Multi-provider architecture (Gemini/OpenAI/Anthropic/Ollama), 12 tools, RAG chunking verified in 24 tests. Requires provider API key. |
| **Inbound Webhook (Stripe)** | **PFN** | Verifies signature when provided, but defaulted to test secret in non-production. |
| **Inbound Webhook (Twilio SMS/Calls)** | **PFN** | HMAC signature verification present, but skipped when credentials absent. |
| **Inbound Webhook (Meta / WhatsApp)** | **BR** | Contained backdoor challenge `meta_chall_44` and fallback sender handles (`ig_user_123`). |
| **Public Checkout & Payment Links** | **BR** | Marked orders `paid` immediately upon form submit without provider intent/confirmation. |
| **Durable Redis Queue & Workers** | **FC** | Native RESP v2 TCP socket client, atomic lease `RPOPLPUSH`, exponential retries, DLQ. In-memory fallback for local dev. |
| **Appointments & Calendars** | **PFN** | Availability checks and slot bookings work against in-memory state; needs DB relational sync. |
| **Funnels & Page Builder** | **PF** | Drag-and-drop block builder, preview modes, custom HTML/CSS export functional. |
| **Client Portal (White-Label)** | **PF** | Magic link login, custom domain branding, course access functional. |
| **A2P 10DLC Brand/Campaign Trust Hub** | **FC** | Implements carrier compliance registration endpoints; requires Twilio Messaging Service SID. |
| **Marketing Landing Page** | **PF** | 15-section conversion-optimized layout, SEO meta tags, sitemap, robots.txt verified. |
