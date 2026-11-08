# OPERZA WHOLE-PRODUCT AUDIT: SCREEN AND NAVIGATION INVENTORY

**Audit Date:** November 8, 2026
**Auditor Roles:** Chief Product Architect, Principal Software Architect, Senior Product Designer, QA Director
**Repository:** `MuhammadAsimdeveloper/operza-growth`
**Branch:** `feat/operza-unified-atlas-automation` (`389aae8`)
**Scope:** Complete inventory of all public marketing routes, public ingress endpoints, and protected agency workspace screens.

---

## 1. Executive Summary of Frontend Surface

The Operza web application (`apps/web`) is a Single-Page Application built on **React 19**, **Vite 6**, and **React Router v6**, styled with the **Rune UI design token system** (`tokens.css`).

- **Total Client Routes Routed in `App.tsx`:** 71 active routes
  - **Public Marketing & Feature Pages:** 14 routes (wrapped in `MarketingLayout`)
  - **Public Ingress & Authentication Pages:** 11 routes
  - **Protected Agency Workspace Pages:** 46 distinct routed screens (plus index/aliases, wrapped in `AuthGuard` and `AppShell`)
- **Navigation Architecture:** Dual-tier hierarchical sidebar in `AppShell.tsx`:
  - **Tier 1 (Pinned Primary Workhorses):** Dashboard, Command Center, Conversations & Inbox, Notification Center, All Apps Directory.
  - **Tier 2 (Enterprise Functional Pillars):** 6 collapsible accordion pillars (CRM & Pipelines, Marketing & Sites, Automation & AI, Commerce & Billing, Client Experience & LMS, Agency & Platform).
- **Global In-App Utilities:**
  - `CommandPalette.tsx` (Cmd+K / Ctrl+K instant jump to all 50+ modules and search contacts)
  - `CopilotHub.tsx` (Persistent floating bottom-right drawer for 10-agent AI swarm, SSE streaming, and proposal reviews)
  - `AppLauncherModal.tsx` (Full-screen grid launcher categorized by suite)
  - `OnboardingTour.tsx` (First-run interactive onboarding walkthrough for new agency administrators)

---

## 2. Public Marketing & Information Routes

| Screen Route | Component File | Product Area | Target Audience | Main Purpose | Key Actions | API Connection | Persistence | Loading / Empty / Error States | Responsive Behavior | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` (unauthenticated) | `pages/marketing/Home.tsx` | Marketing | Prospective Agencies & SMBs | Brand landing, value proposition, feature overview | "Start Free Trial", "Book Demo", "Explore Platform" | Public static, `/api/system/metrics` (optional) | None (Static) | Static hydration; instant render | Mobile hamburger; flex column down to 320px | **VERIFIED** |
| `/platform/crm` | `pages/marketing/PlatformCrm.tsx` | Marketing | Sales & Marketing Directors | Deep dive into CRM, Smart Lists, Contact 360 | "Try CRM Free", interactive pipeline demo | None | None (Static) | Static | Responsive hero + feature grid | **VERIFIED** |
| `/platform/automation` | `pages/marketing/PlatformAutomation.tsx` | Marketing | Operations Engineers | Workflow engine, visual canvas, n8n parity showcase | "View Workflow Templates", "Start Building" | None | None (Static) | Static | Responsive canvas preview diagram | **VERIFIED** |
| `/platform/funnels` | `pages/marketing/PlatformFunnels.tsx` | Marketing | Growth Marketers | High-converting sales funnels and order bumps | "Explore Funnel Templates", "Start Free" | None | None (Static) | Static | Responsive grid, feature tabs | **VERIFIED** |
| `/platform/conversations` | `pages/marketing/PlatformConversations.tsx` | Marketing | Customer Support & Sales Teams | Omnichannel unified inbox and softphone showcase | "See Softphone Demo", "Sign Up" | None | None (Static) | Static | Responsive phone frame mockup | **VERIFIED** |
| `/platform/portal` | `pages/marketing/PlatformPortal.tsx` | Marketing | Client-facing Agencies | White-label client portal and LMS features | "Preview Client Experience", "Get Started" | None | None (Static) | Static | Responsive portal dashboard screenshot | **VERIFIED** |
| `/platform/courses` | `pages/marketing/PlatformCourses.tsx` | Marketing | Educators & Coaches | Course creator, video hosting, and student progress | "Explore Academy", "Sign Up" | None | None (Static) | Static | Responsive curriculum preview | **VERIFIED** |
| `/platform/reporting` | `pages/marketing/PlatformReporting.tsx` | Marketing | Agency Executives | Business intelligence, revenue attribution, ROI | "View Live Analytics Demo" | None | None (Static) | Static | Responsive chart cards | **VERIFIED** |
| `/pricing` | `pages/marketing/Pricing.tsx` | Commercial | Prospective Buyers | Transparent tiered pricing (Starter $97/mo, Pro $297/mo, Agency $497/mo) | "Select Plan", billing interval toggle (Monthly/Annual 20% off) | `/api/platform/plans` | Read-only | Loading skeleton for plans; error banner on network failure | Responsive 3-column tier cards | **VERIFIED** |
| `/about` | `pages/marketing/About.tsx` | Company | General Public | Company mission, open-source principles, team | "View Open Roles", "Read GitHub Repo" | None | None (Static) | Static | Responsive text grid | **VERIFIED** |
| `/docs` | `pages/marketing/Docs.tsx` | Developer / Docs | Technical Users & Admins | Architectural guides, API reference, webhook formats | Search docs, copy code snippets, switch API version | None (Embedded MD) | Local client-side search | Instant render | Sidebar drawer on mobile, sticky nav on desktop | **VERIFIED** |
| `/blog` | `pages/marketing/Blog.tsx` | Content / SEO | Search traffic & leads | Industry insights, agency growth articles, product updates | Read articles, filter tags, newsletter subscribe | `/api/blogs/public` | Blog CMS records | Empty state if 0 articles; pagination controls | Responsive responsive masonry grid | **VERIFIED** |
| `/certification` | `pages/Academy.tsx` | Education | Agency Staff & Operators | Operza Cloud Practitioner certification & exam | "Start Exam", "Verify Certificate ID" | `/api/academy/*` | Relational / JSON Academy records | Dynamic quiz engine with instant score report | Responsive single-column quiz container | **VERIFIED** |

---

## 3. Public Ingress & Authentication Routes

| Screen Route | Component File | Product Area | Target Persona | Main Purpose | Key Actions | API Connection | Persistence | Loading / Empty / Error States | Accessibility & Security | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `/login` | `pages/Login.tsx` | Authentication | Existing Users | Password & Magic Link authentication | Email/password login, Google SSO, send magic link OTP | `POST /api/auth/login`, `POST /api/auth/magic-link`, `POST /api/auth/verify-otp` | Secure HTTP-only cookies (`operza_session`, `operza_csrf`) | Inline button spinners; error callout banner for invalid credentials | Autocomplete tags, ARIA alert roles, CSRF token handshake | **VERIFIED** |
| `/signup` | `pages/Signup.tsx` | Authentication | New Agency Owners | Create account, agency workspace, and root admin | Name, email, password, agency name inputs | `POST /api/auth/signup` | PostgreSQL `agencies`, `users`, `locations` tables | Form validation states; password strength meter; error callout | Label association, keyboard navigable tab order | **VERIFIED** |
| `/f/:slug` | `pages/PublicForm.tsx` | Ingress | Prospective Leads | Public lead capture form or survey | Input answers, file upload, submit inquiry | `GET /api/forms/public/:slug`, `POST /api/forms/submit/:slug` | Contacts table, FormSubmissions table, triggers outbox workflow | Loading spinner during fetch; 404 screen if unpublished; success screen | Form field autofocus, aria-required attributes, SSRF-safe | **VERIFIED** |
| `/book/:id` | `pages/PublicBooking.tsx` | Ingress | Clients / Leads | Real-time calendar appointment booking | Select date, pick available time slot, enter contact info | `GET /api/calendars/public/:id`, `POST /api/calendars/book/:id` | Appointments table, Google/Outlook sync verification | Interactive calendar month grid; disables conflict slots; confirmation screen | High-contrast selection rings, screen-reader time labels | **VERIFIED** |
| `/pay/:slug` | `pages/PublicCheckout.tsx` | Commerce Ingress | Customers / Clients | Direct payment link / invoice settlement | Apply coupon, input card details, complete payment | `GET /api/payments/public/:slug`, `POST /api/payments/checkout/:slug`, `POST /api/coupons/validate` | Orders table, Payments table, Billing ledger | Live total calculation; coupon discount badge; receipt card | Card field sanitization, disabled state while processing | **VERIFIED** |
| `/review/:id` | `pages/PublicReview.tsx` | Reputation Ingress | End Customers | Submit customer feedback and Google review | Star rating (1-5), written feedback, submit | `GET /api/reviews/public/:id`, `POST /api/reviews/submit/:id` | Reviews table, CRM contact sentiment update | Interactive hover stars; thank-you screen with Google Maps redirect for 5 stars | Keyboard arrow star selection, aria-valuenow | **VERIFIED** |
| `/portal/:contactId` | `pages/PublicPortal.tsx` | Client Experience | Agency Clients | Self-service access to invoices, agreements, and courses | Pay invoices, sign contracts, watch course videos | `GET /api/portal/summary/:contactId`, `POST /api/portal/invoices/:id/pay` | Contact-scoped read from invoices, documents, courses | Access denied screen if portalAccess disabled; tabbed navigation | Tab keyboard controls, download receipts | **VERIFIED** |
| `/funnel/:slug` | `pages/PublicFunnel.tsx` | Growth Ingress | Traffic & Leads | Multi-step conversion funnel with order bumps & 1-click upsells | Fill lead form, accept order bump, checkout, trigger upsell | `GET /api/funnels/public/:slug`, `POST /api/funnels/optin/:slug`, `POST /api/funnels/checkout/one-click-upsell` | Orders, Contacts, Funnel visits/optin counters | Step progression animation; instant bump total update; order confirmation | Clear pricing disclosure, form accessibility | **VERIFIED** |
| `/site/:slug` (and `/:pageSlug`) | `pages/PublicWebsite.tsx` | CMS Ingress | Site Visitors | Render published multi-page CMS website with global symbols | Page navigation, contact form submission | `GET /api/websites/public/:slug?pageSlug=...`, `POST /api/websites/optin/:slug` | Websites table, Contacts table, FormSubmissions | Custom 404 page within site; SEO meta injection (`title`, `og:image`) | Semantic HTML (`<header>`, `<main>`, `<footer>`), responsive hamburger | **VERIFIED** |

---

## 4. Protected Agency Workspace Routes (`AppShell.tsx`)

### A. Primary Workhorses

| Screen Route | Component | Pillar | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|---|
| `/` or `/dashboard` | `pages/Dashboard.tsx` | Primary | Executive business overview, pipeline totals, recent activity feed | Filter date range (7d/30d/90d), quick create contact/invoice, view pending AI proposals | `GET /api/dashboard/stats`, `GET /api/dashboard/activity`, `GET /api/copilot/proposals` | PostgreSQL `analytics_snapshots`, CRM collections, audit trail | **VERIFIED** |
| `/command-center` | `pages/CommandCenter.tsx` | Primary | Real-time operations cockpit, active background queues, live softphone status | Monitor BullMQ/in-memory queue jobs, trigger manual queue tick, view WebSocket connection state | `GET /api/admin/queue/status`, `POST /api/admin/queue/test-job`, `GET /ready` | Redis BullMQ / memory queue, WebSocket connection registry | **VERIFIED** |
| `/conversations` | `pages/Conversations.tsx` | Primary | Unified omnichannel communications inbox (Email, SMS, WhatsApp, Webchat) | Select thread, send reply, filter channels, switch canned snippet, launch softphone call | `GET /api/crm/conversations`, `POST /api/conversations/:id/messages`, `GET /api/snippets` | `conversations`, `messages`, `consent_records` | **VERIFIED** |
| `/notifications` | `pages/NotificationCenter.tsx` | Primary | Real-time system notifications and SLA reminders | Mark notification as read, clear all notifications, click-through to affected resource | `GET /api/notifications`, `POST /api/notifications/:id/read` | `notifications` table, WebSocket real-time broadcast | **VERIFIED** |
| `/apps` | `pages/AppsDirectory.tsx` | Primary | Complete directory of all 50+ built-in and connected apps | Search apps, filter by category (CRM, Marketing, Commerce, AI), click to launch | Local catalog metadata + `/api/platform/connections` | Browser state + provider connection records | **VERIFIED** |

---

### B. CRM & Pipelines Pillar

| Screen Route | Component | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|
| `/contacts` | `pages/Contacts.tsx` | Master contact & lead directory | Search, filter by tags/status, create contact, bulk tag, export CSV, trigger CSV import modal | `GET /api/crm/contacts`, `POST /api/crm/contacts`, `POST /api/crm/contacts/bulk-tag`, `POST /api/crm/contacts/import` | PostgreSQL `contacts` table (RLS enforced by agencyId & locationId) | **VERIFIED** |
| `/contacts/:id` | `pages/ContactDetail.tsx` | Complete 360-degree contact record | Edit contact fields, view activity timeline, log call/note, trigger workflow, manage portal access | `GET /api/crm/contacts/:id`, `PUT /api/crm/contacts/:id`, `GET /api/crm/contacts/:id/timeline`, `PUT /api/crm/contacts/:id/portal-access` | Relational join across contacts, activities, messages, appointments, invoices | **VERIFIED** |
| `/opportunities` | `pages/Opportunities.tsx` | Visual Kanban pipeline deal management | Drag-and-drop deals across stages, create deal, edit deal value, assign owner, track pipeline win rate | `GET /api/crm/opportunities`, `PUT /api/crm/opportunities/:id`, `POST /api/crm/opportunities` | `opportunities`, `pipelines`, `stages` | **VERIFIED** |
| `/phone` | `pages/PhoneSystem.tsx` | WebRTC virtual softphone and call history ledger | Dial phone numbers via WebRTC audio stream, view active call status, transmit DTMF tones, log missed calls | `GET /api/telephony/status`, `POST /api/telephony/token`, `POST /api/telephony/call/start`, `POST /api/telephony/call/:id/end`, `POST /api/telephony/call/:id/dtmf` | `calls`, `telephony_tokens`, Twilio/Mock state machine | **VERIFIED** |
| `/calendars` | `pages/Calendars.tsx` | Appointment scheduling, calendar management, and 2-way sync | View week/day calendar, create booking, connect Google/Outlook calendar, configure availability windows | `GET /api/crm/calendars`, `GET /api/crm/appointments`, `POST /api/calendars/:id/sync/connect`, `POST /api/calendars/:id/sync/busy` | `calendars`, `appointments`, `external_calendar_syncs` | **VERIFIED** |
| `/tasks` | `pages/Tasks.tsx` | Team task management, deadlines, and follow-up reminders | Create task, mark task completed, filter by assignee/status, link task to contact or opportunity | `GET /api/crm/tasks`, `POST /api/crm/tasks`, `PUT /api/crm/tasks/:id` | `tasks` table with foreign keys to contacts and users | **VERIFIED** |
| `/reputation` | `pages/Reputation.tsx` | Online review management, NPS monitoring, and review generation | Send review request SMS/Email, reply to reviews, filter reviews by rating, copy public review link | `GET /api/crm/reviews`, `POST /api/reviews/request`, `POST /api/reviews/:id/reply` | `reviews`, `review_requests`, outbox SMS producer | **VERIFIED** |
| `/smart-lists` | `pages/SmartLists.tsx` | Dynamic contact segmentation and criteria-based filters | Create Smart List with AST predicate rules, evaluate live contact matches, export list | `GET /api/crm/smartLists`, `POST /api/crm/smartLists`, `GET /api/crm/smart-lists/:id/evaluate` | `smart_lists` table, AST filter evaluator | **VERIFIED** |

---

### C. Marketing & Sites Pillar

| Screen Route | Component | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|
| `/funnels` | `pages/Funnels.tsx` | Sales funnel manager and conversion tracker | Create funnel, add steps (Opt-in, Checkout, OTO, Thank You), configure order bump, copy public URL | `GET /api/crm/funnels`, `POST /api/crm/funnels`, `PUT /api/crm/funnels/:id` | `funnels`, `funnel_steps` tables | **VERIFIED** |
| `/websites` | `pages/Websites.tsx` | Multi-page website builder and custom domain manager | Create website, add/edit pages in visual builder, verify DNS CNAME/A records, export static HTML pack | `GET /api/crm/websites`, `POST /api/crm/websites`, `POST /api/websites/:id/publish`, `POST /api/websites/:id/verify-dns`, `GET /api/websites/:id/export-pack` | `websites`, `website_pages`, DNS verification state | **VERIFIED** |
| `/campaigns` | `pages/Campaigns.tsx` | Email and SMS broadcast campaign engine | Design broadcast message, choose target Smart List, send test email, dispatch campaign, view open rates | `GET /api/crm/campaigns`, `POST /api/crm/campaigns`, `POST /api/campaigns/:id/test-send`, `POST /api/campaigns/:id/send` | `campaigns`, `campaign_deliveries`, `consent_records` | **VERIFIED** |
| `/social` | `pages/Social.tsx` | Social media multi-account post scheduler | Compose post with media, select accounts (X, LinkedIn, Facebook), schedule date/time, publish instantly | `GET /api/crm/socialPosts`, `POST /api/crm/socialPosts`, `POST /api/social/publish/:id` | `social_posts`, provider sandbox tokens | **VERIFIED** |
| `/prospecting` | `pages/Prospecting.tsx` | B2B lead generation, scraping, and enrichment scoring | Search business directory by industry/location, calculate ICP fit score (0-100), 1-click import to CRM | `GET /api/crm/prospects`, `POST /api/crm/prospects/enrich`, `POST /api/crm/contacts` | `prospects`, `contacts`, activity ledger | **VERIFIED** |
| `/forms` | `pages/Forms.tsx` | Form and survey builder with drag-and-drop fields | Build form schema, toggle published status, embed HTML iframe, inspect customer submission records | `GET /api/crm/forms`, `POST /api/crm/forms`, `POST /api/forms/:id/publish`, `GET /api/forms/:id/submissions` | `forms`, `form_submissions` | **VERIFIED** |
| `/templates` | `pages/Templates.tsx` | Reusable email and SMS rich text templates | Create template, insert merge tokens (`{{contact.firstName}}`), test token resolution | `GET /api/crm/templates`, `POST /api/crm/templates`, `POST /api/templates/:id/use` | `templates` table, token resolution engine | **VERIFIED** |
| `/media` | `pages/MediaLibrary.tsx` | Digital asset manager for images, videos, and PDFs | Upload files, organize folders, copy asset CDN URL, delete media | `GET /api/crm/mediaAssets`, `POST /api/media/upload`, `DELETE /api/media/:id` | In-memory base64 / local disk storage | **PARTIAL** (Cloud S3/R2 not integrated; stored locally) |
| `/blogs` | `pages/Blogs.tsx` | SEO blog CMS and article authoring suite | Write markdown articles, set slug & meta tags, publish article, preview public post | `GET /api/crm/blogs`, `POST /api/crm/blogs`, `PUT /api/blogs/publish/:id` | `blogs` table, public SEO reader | **VERIFIED** |
| `/qr-codes` | `pages/QrCodes.tsx` | Dynamic QR code generation and scan tracking | Generate QR code pointing to review/form/booking page, download SVG, track scan counts | `GET /api/crm/qrCodes`, `POST /api/crm/qrCodes`, `GET /api/qr/:id.svg`, `GET /api/qr/:id/scan` | `qr_codes` table, scan counter increment | **VERIFIED** |

---

### D. Automation & AI Pillar

| Screen Route | Component | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|
| `/workflows` | `pages/Workflows.tsx` | Visual workflow orchestrator (14 node types) | Drag nodes on 2D canvas, connect edge links, evaluate AST expressions, test individual node, activate workflow, inspect execution run timeline | `GET /api/crm/workflows`, `POST /api/crm/workflows`, `POST /api/workflows/:id/run`, `POST /api/workflows/:id/nodes/:nodeId/test`, `GET /api/workflows/runs/:runId/nodes` | `workflows`, `workflow_executions`, `workflow_step_runs` | **VERIFIED** |
| `/copilot-inbox` | `pages/CopilotInbox.tsx` | Two-phase governance approval queue for AI proposals | Review pending proposals created by 10-agent AI swarm, inspect diff, approve or reject proposal, execute mutation | `GET /api/copilot/proposals`, `POST /api/copilot/proposals/:id/approve`, `POST /api/copilot/proposals/:id/reject`, `POST /api/copilot/proposals/:id/execute` | `copilot_proposals`, `billing_ledger`, `audit_events` | **VERIFIED** |
| `/ai-trainer` | `pages/AiTrainer.tsx` | RAG bot knowledge base and instruction training | Ingest text/PDF/URL documents, test similarity queries against knowledge base, customize tone and persona | `GET /api/ai/config`, `PUT /api/ai/config`, `GET /api/ai/knowledge`, `POST /api/ai/knowledge`, `POST /api/ai/test` | In-memory RAG index, AI config records | **VERIFIED** |
| `/links` | `pages/TriggerLinks.tsx` | Smart redirection links with workflow triggers | Create short link, define target URL, associate automated workflow on click, track clicks | `GET /api/crm/triggerLinks`, `POST /api/crm/triggerLinks`, `GET /api/links/click/:slug` | `trigger_links` table, click ledger | **VERIFIED** |

---

### E. Commerce & Billing Pillar

| Screen Route | Component | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|
| `/payments` | `pages/Payments.tsx` | Transaction ledger, Stripe connect status, payouts | View completed transactions, issue refund, inspect gateway status, export payment CSV | `GET /api/crm/payments`, `POST /api/payments/checkout/:slug` | `payments`, `orders` tables, transactional ledger | **VERIFIED** |
| `/store` | `pages/Store.tsx` | Digital and physical product catalog | Add product, set pricing, upload product image, toggle digital download vs service | `GET /api/crm/products`, `POST /api/crm/products` | `products` table | **VERIFIED** |
| `/documents` | `pages/Documents.tsx` | Legal proposals, contracts, and e-signatures | Draft contract, send signature link to contact, collect signature with timestamp & IP | `GET /api/crm/documents`, `POST /api/crm/documents`, `POST /api/documents/:id/sign` | `documents` table with signature metadata | **VERIFIED** |
| `/subscriptions` | `pages/Subscriptions.tsx` | Recurring billing, MRR tracker, and renewals | Provision recurring plan, cancel subscription, resume subscription, inspect renewal dates | `GET /api/subscriptions`, `POST /api/subscriptions`, `POST /api/subscriptions/:id/cancel`, `POST /api/subscriptions/:id/resume` | `subscriptions` table | **VERIFIED** |
| `/payment-links` | `pages/PaymentLinks.tsx` | Standalone hosted payment URLs | Generate payment link for specific product or service, pause link, copy link to clipboard | `GET /api/crm/paymentLinks`, `POST /api/crm/paymentLinks` | `payment_links` table | **VERIFIED** |
| `/orders` | `pages/Orders.tsx` | Customer order fulfillment and order ledger | View customer order history, inspect line items, update fulfillment status (paid/fulfilled) | `GET /api/crm/orders`, `POST /api/crm/orders` | `orders`, `order_items` tables | **VERIFIED** |
| `/coupons` | `pages/Coupons.tsx` | Promotional discount code engine | Create percentage or fixed discount code, set expiration date, validate coupon code against cart | `GET /api/crm/coupons`, `POST /api/crm/coupons`, `POST /api/coupons/validate` | `coupons` table | **VERIFIED** |
| `/affiliates` | `pages/Affiliates.tsx` | Partner referral tracking and commission payouts | Invite affiliate partner, track conversions by referral code, settle batch payout, export report | `GET /api/crm/affiliates`, `POST /api/affiliates/track/:code`, `POST /api/affiliates/:id/payout`, `GET /api/affiliates/payout-report` | `affiliates`, `affiliate_conversions`, payout invoice ledger | **VERIFIED** |

---

### F. Client Experience & LMS Pillar

| Screen Route | Component | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|
| `/academy` | `pages/Academy.tsx` | Operza Cloud Academy LMS & certification exams | Browse training modules, complete video lessons, take certification exam, generate verifiable badge | `GET /api/crm/courses`, `POST /api/courses/:id/lessons`, `POST /api/academy/certify` | `courses`, `lessons`, `certifications` tables | **VERIFIED** |
| `/portal` | `pages/ClientPortal.tsx` | Client portal administration and preview | View client portal activity, toggle client access permissions, preview contact experience | `GET /api/crm/contacts`, `PUT /api/crm/contacts/:id/portal-access`, `GET /api/portal/summary/:id` | Relational portal views | **VERIFIED** |
| `/memberships` | `pages/Memberships.tsx` | Course membership enrollments and student tracking | Enroll contact in course, view course progress percentage, revoke student access | `GET /api/crm/courses`, `POST /api/memberships/enroll`, `POST /api/portal/courses/:id/progress` | `course_enrollments` table | **VERIFIED** |
| `/reporting` | `pages/Reporting.tsx` | Unified business intelligence and conversion metrics | View total revenue, pipeline value, deals won, lead sources breakdown, appointment show rate | `GET /api/reporting/overview` | Aggregated analytics view across CRM, payments, and appointments | **VERIFIED** |
| `/snippets` | `pages/Snippets.tsx` | Quick canned responses with merge token resolution | Create snippet, insert variables (`{{contact.firstName}}`), resolve tokens against contact | `GET /api/crm/snippets`, `POST /api/crm/snippets`, `POST /api/snippets/:id/use` | `snippets` table, token resolution engine | **VERIFIED** |

---

### G. Agency & Platform Pillar

| Screen Route | Component | Main Purpose | Key Actions | API Endpoints | Data Persistence | Status |
|---|---|---|---|---|---|---|
| `/integrations` | `pages/Integrations.tsx` | App marketplace and external provider connections | Browse 50+ integrations, connect provider with API key, execute latency ping test, disconnect provider | `GET /api/integrations`, `POST /api/integrations/:id/connect`, `POST /api/integrations/:id/test`, `POST /api/integrations/:id/disconnect` | `provider_connections`, encrypted secret vault | **VERIFIED** |
| `/sub-accounts` | `pages/SubAccounts.tsx` | Multi-location hierarchy and tenant isolation | Provision new sub-account location, switch active location context, manage location settings | `GET /api/agency/locations`, `POST /api/agency/locations`, `PUT /api/agency/locations/:id`, `DELETE /api/agency/locations/:id` | `locations` table (enforces tenant isolation) | **VERIFIED** |
| `/snapshots` | `pages/Snapshots.tsx` | Full-account configuration templates and sync | Export location snapshot, deploy snapshot to sub-account, calculate schema diff, selective sync | `GET /api/agency/snapshots`, `POST /api/agency/snapshots`, `POST /api/agency/snapshots/:id/deploy`, `GET /api/agency/snapshots/:id/diff/:target`, `POST /api/agency/snapshots/:id/sync/:target` | `snapshots` table with JSON template definitions | **VERIFIED** |
| `/branding` | `pages/Branding.tsx` | White-label custom domain, logo, and SMTP branding | Upload custom logo, set brand primary color, configure custom domain CNAME, verify domain DNS | `GET /api/agency/branding`, `PUT /api/agency/branding`, `POST /api/agency/branding/verify-domain`, `POST /api/agency/branding/verify-email` | `branding` settings in agency metadata | **VERIFIED** |
| `/developers` | `pages/Developers.tsx` | API keys, outbound webhooks, and delivery logs | Generate scoped API key, register outbound webhook URL, test webhook dispatch, inspect delivery history | `GET /api/developers/keys`, `POST /api/developers/keys`, `GET /api/developers/webhooks`, `POST /api/developers/webhooks`, `POST /api/developers/webhooks/:id/test`, `GET /api/developers/webhooks/deliveries` | `api_keys`, `webhooks`, `webhook_deliveries` | **VERIFIED** |
| `/consent-ledger` | `pages/ConsentLedger.tsx` | TCPA/GDPR communication consent audit trail | View consent records by contact and channel (SMS, Email, WhatsApp), record consent opt-in/opt-out | `GET /api/platform/consents`, `POST /api/platform/consents`, `POST /api/platform/consents/:id/revoke` | `consent_records` table with cryptographic proof reference | **VERIFIED** |
| `/plan-usage` | `pages/PlanUsage.tsx` | Commercial plan quota meters and billing upgrades | View monthly AI token usage, contact quota, SMS credits, upgrade plan tier | `GET /api/platform/plans`, `GET /api/platform/usage`, `GET /api/platform/entitlements`, `POST /api/platform/plans/upgrade` | `billing_ledger`, `usage_records`, `agency_subscriptions` | **VERIFIED** |
| `/custom-values` | `pages/CustomValues.tsx` | Agency-wide merge variables and dynamic tokens | Create custom key-value pairs (`{{custom.support_phone}}`), resolve values dynamically | `GET /api/crm/customValues`, `POST /api/crm/customValues`, `POST /api/custom-values/resolve` | `custom_values` table | **VERIFIED** |
| `/audit-log` | `pages/AuditLog.tsx` | Immutable security audit trail and compliance log | Filter audit log by action/actor, search events, export full audit trail to CSV format | `GET /api/audit`, `GET /api/audit?format=csv` | PostgreSQL migration 014 immutable audit triggers / in-memory audit store | **VERIFIED** |
| `/settings` | `pages/Settings.tsx` | Agency business profile and team management | Update agency business profile, invite team members, assign admin/user roles, remove team members | `GET /api/agency/profile`, `PUT /api/agency/profile`, `GET /api/agency/team`, `POST /api/agency/team/invite`, `PUT /api/agency/team/:id/role`, `DELETE /api/agency/team/:id` | `agencies`, `users`, `agency_memberships` | **VERIFIED** |

---

## 5. Summary of Navigation Health & Anomalies

1. **Orphaned Routes:** 0 orphaned routes. Every route defined in `App.tsx` is accessible either from `AppShell` sidebar, the Apps Directory (`/apps`), the `CommandPalette` (Cmd+K), or contextual links (e.g. `/contacts/:id` from `/contacts`).
2. **Duplicate Routes:** Fixed in recent convergence; legacy aliases (e.g. `/command` -> `/command-center`, `/notification-center` -> `/notifications`, `/directory` -> `/apps`, `/home` -> `/`) cleanly redirect or point to canonical components.
3. **Dead Navigation Links:** None identified. All sidebar links match active route definitions in `App.tsx`.
4. **Loading States:** Consistent `PageLoadingFallback` spinning indicator with `#4f46e5` accent color across all lazy-loaded routes.
5. **Empty States:** Implemented across CRM tables (Contacts, Tasks, Opportunities, Invoices, Workflows) with clear call-to-action buttons ("Add First Contact", "Create Workflow").
6. **Error States:** Handled via `try/catch` in components with toast notifications or inline error alert banners.
