# OPERZA — SEO ARCHITECTURE & TECHNICAL IMPLEMENTATION GUIDE

## 1. Executive Summary

This document details the production SEO architecture engineered for **Operza** (Unified Business OS & Multi-Tenant Agency CRM). The system is designed to provide search-engine discoverability, Core Web Vitals compliance, rich snippet eligibility (Google, Bing), and AI engine answer indexing (ChatGPT, Claude, Perplexity, Gemini).

All implementations are strictly aligned with modern Web Standards, Google Search Central specifications, Schema.org vocabularies, and W3C accessibility guidelines.

---

## 2. SEO Architecture Overview

```
                                  [ Incoming Crawler / Visitor ]
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                     ▼
           [ Static Ingress / Shell ]                            [ API Ingress Fallback ]
           - /robots.txt                                         - GET /robots.txt (200 OK)
           - /sitemap.xml                                        - GET /sitemap.xml (200 OK)
           - /manifest.json                                      - GET /health
           - index.html (Baseline JSON-LD + Meta)
                     │
                     ▼
           [ React 19 Frontend Shell ]
           - Dynamic Route Splitting via React.lazy()
           - Suspense Loading Fallback
           - MarketingLayout & Nav Header
                     │
                     ▼
           [ Dynamic Page Head Management: <SEO /> ]
           ├── Document Title: Page Title | Operza
           ├── Meta Description & Viewport
           ├── Canonical Link Tag (<link rel="canonical" href="..." />)
           ├── Open Graph Protocol (og:title, og:description, og:image, og:url)
           ├── Twitter/X Card (summary_large_image)
           ├── Robots Directives (index, follow vs noindex, follow)
           └── JSON-LD Structured Data Injection (<script type="application/ld+json">)
                     │
                     ▼
           [ Telemetry & Observability ]
           - Privacy-Preserving GA4 Event Dispatcher
           - Virtual Page Views & CTA Funnel Tracking
```

---

## 3. Core Modules & Component API

### 3.1. `<SEO />` Head Manager Component
- **Location:** [`apps/web/src/components/SEO.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/components/SEO.tsx)
- **Role:** Centralized document metadata synchronizer. Dynamically updates the DOM head upon client-side navigation without external heavy dependencies.

```typescript
interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  ogType?: 'website' | 'article' | 'product';
  noIndex?: boolean;
  schema?: Record<string, any> | Array<Record<string, any>>;
}
```

#### Key Capabilities:
1. **Dynamic Title Sync:** Formats titles consistently as `${title} | Operza` (or root default).
2. **Canonical Link Enforcement:** Formats relative slugs into fully qualified canonical URLs (`https://operza.io${canonical}`).
3. **Open Graph & Twitter Cards:** Ensures 1200x630 branded vector preview cards across LinkedIn, X/Twitter, Slack, and Discord.
4. **Structured Data Injection:** Replaces or injects a dedicated `<script id="operza-dynamic-jsonld" type="application/ld+json">` on every route transition.
5. **NoIndex Gating:** Immediately injects `<meta name="robots" content="noindex, follow" />` on sensitive routes (e.g., `/login`, `/signup`, `/dashboard`).

---

### 3.2. Structured Data Generators (`schema.ts`)
- **Location:** [`apps/web/src/lib/schema.ts`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/lib/schema.ts)
- **Role:** Schema.org compliant JSON-LD generator functions powering Google Rich Results.

#### Implemented Schema Generators:
- `buildOrganizationSchema()`: Schema.org `Organization` defining Operza's name, URL, logo, contact points, and social profiles.
- `buildSoftwareApplicationSchema()`: Schema.org `SoftwareApplication` with `OperatingSystem`, `ApplicationCategory` (`BusinessApplication`), user ratings, and feature list.
- `buildWebSiteSchema()`: Schema.org `WebSite` with `SearchAction` target supporting deep site searches.
- `buildFaqSchema(faqs)`: Schema.org `FAQPage` transforming accordion question-and-answer pairs into Google Search interactive Rich Snippets.
- `buildBreadcrumbSchema(items)`: Schema.org `BreadcrumbList` enabling breadcrumb trail navigation in SERPs.

---

### 3.3. Analytics & Conversion Tracking (`analytics.ts`)
- **Location:** [`apps/web/src/lib/analytics.ts`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/lib/analytics.ts)
- **Role:** Privacy-conscious Google Analytics 4 (GA4) and Google Tag Manager (GTM) abstraction layer.

#### Tracked Conversion Events:
- `page_view`: Triggered on route changes with page title and location.
- `cta_click`: Triggered when visitors click primary conversion elements (`Get Started Free`, `Start Free Trial`, `Open Workspace`).
- `pricing_select`: Captures selected subscription tiers (`starter`, `growth`, `enterprise`, `self_hosted`).
- `signup_start`: Captures user intent moving into onboarding.

---

## 4. Public Marketing Pages Suite

All 12 public marketing pages are isolated within [`apps/web/src/pages/marketing/`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/):

| Route | Component | Focus & Keyword Cluster | Schema.org Type |
| :--- | :--- | :--- | :--- |
| `/` | [`Home.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/Home.tsx) | Business Operating System & Agency CRM | Organization, WebSite, SoftwareApplication, FAQPage |
| `/platform/crm` | [`PlatformCrm.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformCrm.tsx) | Multi-tenant CRM & Sales Pipelines | SoftwareApplication, BreadcrumbList |
| `/platform/automation` | [`PlatformAutomation.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformAutomation.tsx) | 2D Visual Automation & Orchestration | SoftwareApplication, BreadcrumbList |
| `/platform/funnels` | [`PlatformFunnels.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformFunnels.tsx) | Landing Pages, Funnels & 1-Click Bumps | SoftwareApplication, BreadcrumbList |
| `/platform/conversations` | [`PlatformConversations.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformConversations.tsx) | Unified Omnichannel Inbox & Telephony | SoftwareApplication, BreadcrumbList |
| `/platform/portal` | [`PlatformPortal.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformPortal.tsx) | White-Label Client Portal & Contracts | SoftwareApplication, BreadcrumbList |
| `/platform/courses` | [`PlatformCourses.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformCourses.tsx) | LMS Memberships & Video Training | SoftwareApplication, BreadcrumbList |
| `/platform/reporting` | [`PlatformReporting.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/PlatformReporting.tsx) | Agency Analytics & Revenue Attribution | SoftwareApplication, BreadcrumbList |
| `/pricing` | [`Pricing.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/Pricing.tsx) | Transparent SaaS & Self-Hosted Tiers | FAQPage, Product/Offer |
| `/about` | [`About.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/About.tsx) | Company Manifesto, Architecture & Values | AboutPage, Organization |
| `/docs` | [`Docs.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/Docs.tsx) | REST API, Webhooks & PostgreSQL RLS | TechArticle, SoftwareSourceCode |
| `/blog` | [`Blog.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/pages/marketing/Blog.tsx) | Agency Engineering & Playbooks | CollectionPage, Blog |

---

## 5. Crawl Budget & Routing Controls

### 5.1. `robots.txt` Policy
- File: [`apps/web/public/robots.txt`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/public/robots.txt)
- Dynamic Route: `GET /robots.txt` via [`apps/api/server.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/api/server.mjs)
- Directives:
  - Grants complete access to root marketing pages (`Allow: /`, `Allow: /platform/`, `Allow: /pricing`, `Allow: /docs`, `Allow: /blog`).
  - Explicitly disallows private workspace paths: `/dashboard`, `/contacts`, `/pipelines`, `/workflows`, `/funnels`, `/inbox`, `/templates`, `/courses`, `/portal/client`, `/settings`, `/api/`.
  - Declares canonical XML sitemap: `Sitemap: https://operza.io/sitemap.xml`.

### 5.2. `sitemap.xml` Specification
- File: [`apps/web/public/sitemap.xml`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/public/sitemap.xml)
- Contains all 14 public canonical endpoints.
- Each entry features:
  - `<loc>`: Absolute HTTPS URI.
  - `<lastmod>`: ISO 8601 timestamp.
  - `<changefreq>`: Optimized crawl hints (`weekly` for core pages, `monthly` for legal/about).
  - `<priority>`: Strategic priority weights (`1.0` for home, `0.9` for platform pillars, `0.8` for pricing/docs).

---

## 6. Performance Optimization & Bundle Metrics

To satisfy Google Core Web Vitals (Largest Contentful Paint `< 2.5s`, First Input Delay `< 100ms`, Cumulative Layout Shift `< 0.1`):
1. **Dynamic Code Splitting:** In [`apps/web/src/App.tsx`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/App.tsx), all 56 page components were converted from monolithic eager imports to `React.lazy()` dynamic imports.
2. **Initial Vendor Chunk Reduction:**
   - **Before Optimization:** Single monolithic bundle of **939.24 kB** (triggered Vite chunk warning).
   - **After Optimization:** Initial vendor bundle reduced to **270.78 kB** (81.04 kB gzip) — a **>71% reduction** in upfront payload.
3. **Route-Level Asynchronous Chunks:** Each individual marketing and dashboard view is now isolated in lightweight on-demand chunks of **14 kB – 35 kB**, loaded only when the user navigates to the route.

---

## 7. Verification & Automated CI Integration

The SEO implementation is validated by the automated test suite [`scripts/seo-audit/run-seo-checks.mjs`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/scripts/seo-audit/run-seo-checks.mjs), executing:
- XML sitemap structure and complete URL enumeration.
- Robots.txt exclusion rules and sitemap reference.
- Baseline HTML tags, viewport, Open Graph, and JSON-LD schema validity.
- Route-level uniqueness for titles, meta descriptions, and canonicals.
- Zero-tolerance brand safety scan for competitor tokens.
- API server HTTP 200 endpoint exposure.

**Execution:**
```bash
npm run test:seo
```
Result: **106 / 106 automated checks passed cleanly.**
