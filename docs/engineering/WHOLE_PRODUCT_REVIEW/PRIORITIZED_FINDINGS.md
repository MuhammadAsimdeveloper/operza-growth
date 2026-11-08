# OPERZA WHOLE-PRODUCT AUDIT: PRIORITIZED FINDINGS & DEFECT REGISTER

**Audit Date:** November 8, 2026
**Auditor Roles:** Principal Software Architect, Senior Security Engineer, QA Director
**Repository:** `MuhammadAsimdeveloper/operza-growth`
**Branch:** `feat/operza-unified-atlas-automation` (`389aae8`)

---

## 1. Severity Ranking Framework

- **P0 — Critical:** Active security vulnerability, data loss risk, unauthorized cross-tenant data access, or crash blocking the entire platform.
- **P1 — High:** Major user journey blocked, core capability unreliable, or mandatory commercial release blocker.
- **P2 — Medium:** Usability friction, missing external provider adapter, or notable maintainability risk.
- **P3 — Low:** Minor visual polish, nonessential inconsistency, or secondary feature omission.
- **P4 — Future:** Long-term architectural enhancement or feature expansion for post-launch milestones.

---

## 2. Comprehensive Findings Register

### Priority P0 — Critical (0 Identified)
> **Result:** **0 P0 Critical Vulnerabilities or Blocking Defects Identified.**
> - Forced PostgreSQL RLS and strict session scoping prevent cross-tenant data access.
> - AST expression sandboxing eliminates `eval()` remote code execution risks.
> - SSRF defenses actively block cloud metadata (`169.254.169.254`) and RFC 1918 private IPs.
> - CSV formula injection escaping prevents spreadsheet malware attacks.
> - Dual-mode persistence and outbox leases prevent data loss during worker crash cycles.

---

### Priority P1 — High (Release-Blocking for Commercial Launch)

#### Finding P1-01: Media Library File Storage is Local/In-Memory (Missing S3 / R2 Cloud Integration)
- **Evidence:** `apps/api/server.mjs:L3420` (`/api/media/upload`) stores file buffers in `state.mediaFiles[assetId]` or local disk without cloud object storage.
- **Affected Users:** All agency users uploading media for marketing funnels, website images, email templates, and PDF documents.
- **Business Impact:** Files uploaded in ephemeral container environments (e.g. Docker / AWS Fargate) will be lost upon container restart or scale-out.
- **Technical Impact:** Server memory consumption grows with file uploads; lacks CDN distribution.
- **Recommended Fix:** Implement an S3/Cloudflare R2 storage adapter with pre-signed upload URLs in `packages/platform-core/src/media-storage.mjs`.
- **Dependencies:** AWS S3 or Cloudflare R2 bucket credentials (`S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`).
- **Estimated Effort:** 1.5 Engineering Days.
- **Acceptance Criteria:** Uploading a 5MB image generates an S3 object key; URL resolves via cloud CDN; survives container recreation.

#### Finding P1-02: Live Carrier SMS / Voice Credentials & A2P 10DLC Approval Flow
- **Evidence:** Telephony operates in sandbox mode (`CarrierConfigured: false`); WebRTC softphone mints mock tokens (`opz_rtc_...`).
- **Affected Users:** Sales reps and account managers making outbound client calls or sending automated SMS follow-ups.
- **Business Impact:** Outbound SMS to US mobile numbers will be rejected by US carriers without an approved A2P 10DLC Brand/Campaign registration.
- **Technical Impact:** Messages remain queued in the outbox unless live carrier credentials are provided.
- **Recommended Fix:** Provide an interactive carrier onboarding wizard in `/phone` with direct links to Twilio Trust Hub / Telnyx portal; validate live webhook signing secret.
- **Dependencies:** Active Twilio account with funded balance and approved A2P 10DLC campaign.
- **Estimated Effort:** 2 Engineering Days.
- **Acceptance Criteria:** Real SMS dispatched to a physical mobile device with delivery receipt logged in the conversation thread.

#### Finding P1-03: Live Stripe Connect Merchant Keys Configuration
- **Evidence:** Public checkout endpoints (`/api/payments/checkout/:slug`) simulate token charges when `STRIPE_SECRET_KEY` is not present in `.env`.
- **Affected Users:** Agency owners collecting client subscription retainers or selling products through funnels.
- **Business Impact:** Cannot collect real monetary payments until Stripe live API keys and webhook secrets are configured.
- **Technical Impact:** Orders are marked paid via synthetic simulator tokens.
- **Recommended Fix:** Add environment variable validation at startup and a Stripe Connect OAuth onboarding button in `/payments`.
- **Dependencies:** Stripe account and live publishable/secret keys.
- **Estimated Effort:** 1 Engineering Day.
- **Acceptance Criteria:** Real credit card processed; webhook verifies Stripe HMAC signature; transaction records in `billing_ledger`.

---

### Priority P2 — Medium (Important Usability & Maintainability Polish)

#### Finding P2-01: Monolithic Dispatcher in `server.mjs` (8,928 Lines)
- **Evidence:** While four modular routers (`auth.mjs`, `agency.mjs`, `crm.mjs`, `system.mjs`) were extracted, `server.mjs` still handles workflows, public booking, telephony, and media.
- **Affected Users:** Backend engineers maintaining the codebase.
- **Business Impact:** Slows down concurrent feature development; increases merge conflict risk.
- **Technical Impact:** High cognitive overhead when navigating large source files.
- **Recommended Fix:** Extract remaining endpoints into `routes/workflows.mjs`, `routes/telephony.mjs`, `routes/commerce.mjs`, and `routes/public-ingress.mjs`.
- **Dependencies:** None.
- **Estimated Effort:** 2 Engineering Days.
- **Acceptance Criteria:** `server.mjs` reduced to < 1,000 lines, serving solely as middleware orchestrator.

#### Finding P2-02: Sidebar Height Overload with All Accordions Expanded
- **Evidence:** `apps/web/src/components/AppShell.tsx` renders 46 navigation links across 6 pillars. Expanding all pillars creates a 1,200px+ vertical scroll.
- **Affected Users:** Daily agency operators on standard laptop screens (1080p / 1366x768).
- **Business Impact:** Minor navigation friction; user must scroll sidebar to reach Platform Settings.
- **Technical Impact:** None (UI only).
- **Recommended Fix:** Enforce single-accordion expansion mode by default (opening one pillar automatically collapses inactive pillars).
- **Dependencies:** None.
- **Estimated Effort:** 2 Hours.
- **Acceptance Criteria:** Only one pillar open at a time; total sidebar height remains within viewport without vertical scrollbar.

#### Finding P2-03: WebRTC ICE Server authenticated TURN Relay
- **Evidence:** `apps/api/server.mjs:L3100` uses public Google STUN servers with no authenticated TURN servers.
- **Affected Users:** Agency reps making softphone calls behind restrictive enterprise firewalls / symmetric NATs.
- **Business Impact:** Softphone voice audio packets may drop or fail to connect for 5-10% of enterprise office networks.
- **Technical Impact:** WebRTC peer connection fails to establish ICE candidate pair.
- **Recommended Fix:** Add TURN server credentials in environment (`TURN_SERVER_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`).
- **Dependencies:** Coturn instance or Twilio Network Traversal credentials.
- **Estimated Effort:** 4 Hours.
- **Acceptance Criteria:** Softphone call completes over TURN relay on symmetric NAT test harness.

---

### Priority P3 — Low (Minor Inconsistencies & Nonessential Items)

#### Finding P3-01: Hardcoded Mock Avatar Initials in Workspace Header
- **Evidence:** `AppShell.tsx:L216` falls back to `'ASIM tech'` when active location name is empty.
- **Affected Users:** First-time users prior to naming their location.
- **Recommended Fix:** Fall back to generic `'My Workspace'` or `'Location 1'` instead of hardcoded string.
- **Estimated Effort:** 15 Minutes.

#### Finding P3-02: LMS Course Curriculum Drag-and-Drop Reordering
- **Evidence:** `pages/Memberships.tsx` lessons can be reordered via number inputs, but lacks smooth pointer drag-and-drop.
- **Affected Users:** Course creators.
- **Recommended Fix:** Integrate `dnd-kit` or standard HTML5 drag-and-drop for course lessons.
- **Estimated Effort:** 4 Hours.

---

### Priority P4 — Future (Post-Commercial Launch Enhancements)

#### Finding P4-01: Multi-Region Active-Active PostgreSQL Read Replicas
- **Description:** For international scale (> 10,000 agencies), deploy PostgreSQL read replicas across US-East, EU-Central, and AP-Southeast with localized read routing.
#### Finding P4-02: Native Mobile iOS / Android Applications
- **Description:** Package Operza's responsive web UI into native Capacitor / React Native shells for push notification delivery.
