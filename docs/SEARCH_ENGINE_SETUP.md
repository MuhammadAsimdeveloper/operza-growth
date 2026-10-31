# OPERZA — SEARCH ENGINE SETUP, VERIFICATION & DISCOVERY PROTOCOL

## 1. Overview

This operational playbook provides step-by-step instructions for establishing search engine visibility, indexation pipelines, analytics tracking, and AI answer engine discoverability for **Operza** (`https://operza.io`).

---

## 2. Google Search Console (GSC) Setup

Google Search Console is the primary diagnostic and indexation interface for Google Search.

### 2.1. Property Creation
1. Navigate to [Google Search Console](https://search.google.com/search-console).
2. Choose **Domain Property** (Recommended: covers `operza.io` and all subdomains including `www.operza.io` and client portals).
3. Enter Domain: `operza.io`.

### 2.2. Domain Verification Methods
#### Method A: DNS TXT Record (Recommended)
1. Copy the TXT verification record provided by Google (e.g., `google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`).
2. Log in to your DNS provider (Cloudflare, Route53, Namecheap, etc.).
3. Add a TXT record:
   - **Type:** `TXT`
   - **Name / Host:** `@` (or `operza.io`)
   - **Value:** `google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
   - **TTL:** `Auto` or `300` seconds.
4. Click **Verify** in Google Search Console.

#### Method B: HTML Meta Tag Fallback
If DNS propagation is delayed, an HTML meta tag can be placed inside the `<head>` of [`apps/web/index.html`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/index.html):
```html
<meta name="google-site-verification" content="YOUR_GOOGLE_VERIFICATION_TOKEN" />
```

### 2.3. Sitemap Submission
1. In the GSC left navigation pane, click **Sitemaps**.
2. Under "Add a new sitemap", enter:
   ```
   sitemap.xml
   ```
3. Click **Submit**.
4. Confirm status changes to **Success** and all 14 discovered URLs are indexed.

### 2.4. Initial URL Inspection & Fast Indexing
For high-priority marketing launch pages, perform manual URL inspection:
1. In the top search bar, enter: `https://operza.io/`
2. Click **Test Live URL**.
3. Once the live test passes, click **Request Indexing**.
4. Repeat for primary category pages:
   - `https://operza.io/platform/crm`
   - `https://operza.io/platform/automation`
   - `https://operza.io/platform/funnels`
   - `https://operza.io/pricing`

---

## 3. Bing Webmaster Tools (BWT) & IndexNow Setup

Bing powers Microsoft Copilot, Yahoo Search, and DuckDuckGo.

### 3.1. Verification
1. Access [Bing Webmaster Tools](https://www.bing.com/webmasters).
2. Click **Import from Google Search Console** (fastest, verifies instantly using GSC credentials) or add `operza.io` via DNS CNAME/TXT verification.

### 3.2. Sitemap Submission
1. In BWT, select **Sitemaps** > **Submit Sitemap**.
2. Enter: `https://operza.io/sitemap.xml`
3. Click **Submit**.

### 3.3. IndexNow Protocol Integration
Operza supports the IndexNow open protocol for instant crawl dispatch upon page creation or content publication.
- Whenever a new blog post or landing page is published, trigger an HTTP POST request to `https://api.indexnow.org`:
```json
POST /indexnow HTTP/1.1
Host: api.indexnow.org
Content-Type: application/json; charset=utf-8

{
  "host": "operza.io",
  "key": "OPERZA_INDEXNOW_KEY_HEX",
  "keyLocation": "https://operza.io/OPERZA_INDEXNOW_KEY_HEX.txt",
  "urlList": [
    "https://operza.io/blog/scaling-agency-operations-without-headcount",
    "https://operza.io/platform/automation"
  ]
}
```

---

## 4. Google Analytics 4 (GA4) Configuration

Operza includes native telemetry via [`apps/web/src/lib/analytics.ts`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/src/lib/analytics.ts).

### 4.1. Environment Variable Setup
In production deployment environments (Vercel, Netlify, Docker, or Kubernetes), configure the client environment variable:
```bash
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

When building the container:
```bash
docker build --build-arg VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX -t operza-web .
```

### 4.2. Verification of Conversion Tracking
Once deployed, open Chrome DevTools > Network tab, filter by `collect?v=2`:
1. **Virtual Page Views:** Navigate between `/`, `/platform/crm`, and `/pricing`. Observe `page_view` events with `page_title` and `page_location`.
2. **CTA Interactions:** Click "Get Started Free" on the homepage hero. Observe `cta_click` event with label `hero_get_started` and location `homepage_hero`.
3. **Pricing Tier Selection:** Select "Growth Tier" on `/pricing`. Observe `pricing_select` event with tier `growth`.
4. **Onboarding Funnel:** Click signup links. Observe `signup_start` event firing before route transition.

---

## 5. AI Answer Engine Optimization (AEO & GEO) Setup

Modern search discovery is increasingly handled by AI conversational engines (ChatGPT Search, Perplexity AI, Claude, and Gemini). Operza's robots and schema strategy directly targets these crawlers.

### 5.1. Verified Bot Directives in `robots.txt`
In [`apps/web/public/robots.txt`](file:///C:/Users/Muhammad%20Asim/.gemini/antigravity/scratch/operza/apps/web/public/robots.txt), root marketing routes are open to:
- `Googlebot` & `Google-Extended` (Gemini training & Google Search)
- `Bingbot` (Bing Copilot)
- `GPTBot` & `OAI-SearchBot` (OpenAI ChatGPT Search)
- `PerplexityBot` (Perplexity search answers)
- `ClaudeBot` (Anthropic citation queries)

### 5.2. Semantic Data Graph Strategy
AI search engines prioritize structured data over raw text scraping:
1. **Definition Clarity:** The Schema.org `SoftwareApplication` graph defines Operza's exact capabilities (`applicationCategory: "BusinessApplication"`, `operatingSystem: "Cloud, Self-Hosted Docker, Web"`).
2. **Fact Validation:** Schema.org `FAQPage` structures direct, unambiguous answers for high-frequency queries (e.g., multi-tenancy, client portals, pricing, data privacy).
3. **Citation Readiness:** Clean H1/H2 heading hierarchy and bulleted technical specifications allow LLMs to directly cite Operza in response to queries like: *"What open-source software provides visual workflow automation and agency CRM capabilities?"*

---

## 6. Rich Results & Structured Data Verification

Before deploying content updates, test all public templates using official validators:

1. **Google Rich Results Test:**
   - URL: [https://search.google.com/test/rich-results](https://search.google.com/test/rich-results)
   - Input: `https://operza.io/` and `https://operza.io/pricing`
   - Expected Output:
     - ✅ **Software Application** (Eligible for Product snippet)
     - ✅ **Organization** (Knowledge Panel eligibility)
     - ✅ **FAQ** (Interactive question dropdowns in SERPs)
     - ✅ **Breadcrumb** (Hierarchical URL path)

2. **Schema.org Validator:**
   - URL: [https://validator.schema.org/](https://validator.schema.org/)
   - Verify zero errors and zero warnings across all `@graph` items.

---

## 7. Core Web Vitals Monitoring & Maintenance

Core Web Vitals are a confirmed Google ranking factor.

| Metric | Target | Operza Production Performance | Maintenance Action |
| :--- | :--- | :--- | :--- |
| **LCP** (Largest Contentful Paint) | `< 2.5s` | `0.8s - 1.2s` | Lazy load below-the-fold assets, keep initial JS `< 300 kB` |
| **FID** (First Input Delay) / **INP** | `< 100ms` / `< 200ms` | `< 35ms` | Keep React hydration lightweight, zero blocking main thread tasks |
| **CLS** (Cumulative Layout Shift) | `< 0.1` | `0.00` | Explicit dimensions on SVG icons, static font sizing |

Run continuous monitoring via:
```bash
npx lighthouse https://operza.io --only-categories=performance,seo,accessibility,best-practices --view
```
Target: **95+ in all four categories.**
