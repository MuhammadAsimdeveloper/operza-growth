/**
 * Operza Automated SEO & Metadata Verification Suite
 * 
 * Validates:
 * 1. Sitemap integrity (valid XML, all canonical URLs, priority, changefreq, lastmod, no private routes)
 * 2. Robots.txt rules (User-agent, public allowances, private route exclusions, sitemap declaration)
 * 3. index.html baseline (meta tags, viewport, Open Graph, Twitter cards, valid JSON-LD graph)
 * 4. Marketing pages uniqueness (SEO component usage, distinct titles & descriptions, canonical URLs)
 * 5. Competitor keyword exclusion policy (strict zero-tolerance check)
 * 6. API dynamic robots and sitemap route registration
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  ✓ ${message}`);
  } else {
    failedChecks++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log('       OPERZA ENTERPRISE SEO & METADATA AUDIT SUITE               ');
console.log('═══════════════════════════════════════════════════════════════════\n');

// -------------------------------------------------------------
// CHECK 1: SITEMAP.XML AUDIT
// -------------------------------------------------------------
console.log('▶ Test Suite 1: Sitemap.xml Verification');
const sitemapPath = path.join(ROOT_DIR, 'apps/web/public/sitemap.xml');
assert(fs.existsSync(sitemapPath), 'sitemap.xml exists at apps/web/public/sitemap.xml');

const sitemapContent = fs.readFileSync(sitemapPath, 'utf8');
assert(sitemapContent.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'sitemap.xml has valid XML declaration');
assert(sitemapContent.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'sitemap.xml defines standard urlset namespace');

const expectedPages = [
  'https://operza.io/',
  'https://operza.io/platform/crm',
  'https://operza.io/platform/automation',
  'https://operza.io/platform/funnels',
  'https://operza.io/platform/conversations',
  'https://operza.io/platform/portal',
  'https://operza.io/platform/courses',
  'https://operza.io/platform/reporting',
  'https://operza.io/pricing',
  'https://operza.io/about',
  'https://operza.io/docs',
  'https://operza.io/blog'
];

for (const url of expectedPages) {
  assert(sitemapContent.includes(`<loc>${url}</loc>`), `sitemap includes canonical URL: ${url}`);
}

// Disallowed private paths check in sitemap (including noindex auth routes)
const forbiddenInSitemap = [
  '/dashboard',
  '/contacts',
  '/pipelines',
  '/workflows',
  '/funnels',
  '/inbox',
  '/templates',
  '/portal/client',
  '/settings',
  '/api/',
  '/login',
  '/signup'
];

let privateRouteInSitemap = false;
for (const badRoute of forbiddenInSitemap) {
  if (sitemapContent.includes(`https://operza.io${badRoute}`)) {
    privateRouteInSitemap = true;
    break;
  }
}
assert(!privateRouteInSitemap, 'sitemap.xml contains 0 private or noindex application routes (/login, /signup, /dashboard, etc.)');

// Check priority and changefreq tags
const locMatches = sitemapContent.match(/<loc>/g) || [];
const priorityMatches = sitemapContent.match(/<priority>/g) || [];
const changefreqMatches = sitemapContent.match(/<changefreq>/g) || [];
const lastmodMatches = sitemapContent.match(/<lastmod>/g) || [];

assert(locMatches.length === 12, `sitemap contains exactly 12 public canonical URLs (found: ${locMatches.length})`);
assert(priorityMatches.length === locMatches.length, 'Every sitemap entry has a <priority> directive');
assert(changefreqMatches.length === locMatches.length, 'Every sitemap entry has a <changefreq> directive');
assert(lastmodMatches.length === locMatches.length, 'Every sitemap entry has a valid <lastmod> timestamp');

console.log('');

// -------------------------------------------------------------
// CHECK 2: ROBOTS.TXT AUDIT
// -------------------------------------------------------------
console.log('▶ Test Suite 2: Robots.txt Rules & Directives Verification');
const robotsPath = path.join(ROOT_DIR, 'apps/web/public/robots.txt');
assert(fs.existsSync(robotsPath), 'robots.txt exists at apps/web/public/robots.txt');

const robotsContent = fs.readFileSync(robotsPath, 'utf8');
assert(robotsContent.includes('User-agent: *'), 'robots.txt includes generic "User-agent: *" block');
assert(robotsContent.includes('Allow: /'), 'robots.txt permits indexing of root marketing ingress');
assert(robotsContent.includes('Disallow: /dashboard'), 'robots.txt disallows /dashboard');
assert(robotsContent.includes('Disallow: /api/'), 'robots.txt disallows /api/ backend endpoints');
assert(robotsContent.includes('Disallow: /settings'), 'robots.txt disallows /settings');
assert(robotsContent.includes('Disallow: /workflows'), 'robots.txt disallows /workflows');
assert(robotsContent.includes('Sitemap: https://operza.io/sitemap.xml'), 'robots.txt includes valid Sitemap URL');

console.log('');

// -------------------------------------------------------------
// CHECK 3: INDEX.HTML BASELINE METADATA AUDIT
// -------------------------------------------------------------
console.log('▶ Test Suite 3: Baseline HTML Shell & Open Graph Audit');
const indexPath = path.join(ROOT_DIR, 'apps/web/index.html');
assert(fs.existsSync(indexPath), 'index.html exists');

const indexContent = fs.readFileSync(indexPath, 'utf8');
assert(indexContent.includes('<meta charset="UTF-8" />') || indexContent.includes('<meta charset="utf-8" />'), 'index.html has UTF-8 charset');
assert(indexContent.includes('name="viewport"'), 'index.html has responsive viewport meta');
assert(indexContent.includes('name="description"'), 'index.html has baseline meta description');
assert(!indexContent.toLowerCase().includes('demo data only'), 'index.html does not contain legacy "demo data only" string');
assert(indexContent.includes('rel="canonical"'), 'index.html has canonical link tag');
assert(indexContent.includes('property="og:title"'), 'index.html has og:title tag');
assert(indexContent.includes('property="og:description"'), 'index.html has og:description tag');
assert(indexContent.includes('property="og:image"'), 'index.html has og:image tag');
assert(indexContent.includes('name="twitter:card"'), 'index.html has twitter:card tag');

// Check JSON-LD in index.html
const jsonLdMatch = indexContent.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert(!!jsonLdMatch, 'index.html has structured data <script type="application/ld+json"> tag');
if (jsonLdMatch) {
  let parsedJsonLd = null;
  try {
    parsedJsonLd = JSON.parse(jsonLdMatch[1]);
  } catch (err) {
    // ignore
  }
  assert(parsedJsonLd !== null && Array.isArray(parsedJsonLd['@graph']), 'Baseline JSON-LD in index.html is valid JSON with @graph schema array');
}

console.log('');

// -------------------------------------------------------------
// CHECK 4: MARKETING PAGES & UNIQUE METADATA AUDIT
// -------------------------------------------------------------
console.log('▶ Test Suite 4: Marketing Page SEO Implementation Audit');
const marketingDir = path.join(ROOT_DIR, 'apps/web/src/pages/marketing');
assert(fs.existsSync(marketingDir), 'Marketing pages directory exists');

const marketingPages = [
  'Home.tsx',
  'PlatformCrm.tsx',
  'PlatformAutomation.tsx',
  'PlatformFunnels.tsx',
  'PlatformConversations.tsx',
  'PlatformPortal.tsx',
  'PlatformCourses.tsx',
  'PlatformReporting.tsx',
  'Pricing.tsx',
  'About.tsx',
  'Docs.tsx',
  'Blog.tsx'
];

const foundTitles = new Set();
const foundDescriptions = new Set();
const foundCanonicals = new Set();

for (const pageFile of marketingPages) {
  const filePath = path.join(marketingDir, pageFile);
  assert(fs.existsSync(filePath), `Page file ${pageFile} exists`);
  const content = fs.readFileSync(filePath, 'utf8');

  // Verify SEO component usage
  const usesSEO = content.includes('<SEO') && content.includes('title=') && content.includes('description=');
  assert(usesSEO, `${pageFile} integrates <SEO /> component with title and description props`);

  // Extract title
  const titleMatch = content.match(/title="([^"]+)"/);
  if (titleMatch) {
    const title = titleMatch[1];
    assert(!foundTitles.has(title), `${pageFile} has unique title: "${title.slice(0, 40)}..."`);
    foundTitles.add(title);
  }

  // Extract description
  const descMatch = content.match(/description="([^"]+)"/);
  if (descMatch) {
    const desc = descMatch[1];
    assert(!foundDescriptions.has(desc), `${pageFile} has unique meta description`);
    foundDescriptions.add(desc);
  }

  // Extract canonical
  const canonMatch = content.match(/canonical="([^"]+)"/);
  if (canonMatch) {
    const canon = canonMatch[1];
    assert(!foundCanonicals.has(canon), `${pageFile} has unique canonical URL: ${canon}`);
    foundCanonicals.add(canon);
  }
}

// Check that auth views (Login & Signup) enforce noindex to prevent indexing low-value auth pages
const loginContent = fs.readFileSync(path.join(ROOT_DIR, 'apps/web/src/pages/Login.tsx'), 'utf8');
const signupContent = fs.readFileSync(path.join(ROOT_DIR, 'apps/web/src/pages/Signup.tsx'), 'utf8');
assert(loginContent.includes('robots="noindex, follow"'), 'Login.tsx explicitly sets robots="noindex, follow"');
assert(signupContent.includes('robots="noindex, follow"'), 'Signup.tsx explicitly sets robots="noindex, follow"');

console.log('');

// -------------------------------------------------------------
// CHECK 5: COMPETITOR PLATFORM KEYWORD FILTER
// -------------------------------------------------------------
console.log('▶ Test Suite 5: Brand Authenticity & Competitor Negative Filter Audit');
const filesToScanForKeywords = [
  ...marketingPages.map(f => path.join(marketingDir, f)),
  path.join(ROOT_DIR, 'apps/web/src/components/SEO.tsx'),
  path.join(ROOT_DIR, 'apps/web/src/lib/schema.ts'),
  path.join(ROOT_DIR, 'apps/web/public/robots.txt'),
  path.join(ROOT_DIR, 'apps/web/public/sitemap.xml'),
  path.join(ROOT_DIR, 'apps/web/index.html')
];

// Regex for competitor platform tokens as whole words or identifiers
const competitorPatterns = [
  /\bghl\b/i,
  /\bgohighlevel\b/i,
  /\bn8n\b/i
];

let competitorLeakFound = false;
for (const file of filesToScanForKeywords) {
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of competitorPatterns) {
    if (pattern.test(content)) {
      console.error(`  ✗ Competitor keyword match (${pattern}) in ${path.relative(ROOT_DIR, file)}`);
      competitorLeakFound = true;
    }
  }
}
assert(!competitorLeakFound, 'Strict zero-competitor keyword policy passed across all public & SEO assets');

console.log('');

// -------------------------------------------------------------
// CHECK 6: API BACKEND ROUTE VERIFICATION
// -------------------------------------------------------------
console.log('▶ Test Suite 6: API Server Public Directives Verification');
const apiServerPath = path.join(ROOT_DIR, 'apps/api/server.mjs');
const apiServerContent = fs.readFileSync(apiServerPath, 'utf8');

assert(apiServerContent.includes("pathname === '/robots.txt'") || apiServerContent.includes("'/robots.txt'"), 'API server exposes dynamic /robots.txt endpoint');
assert(apiServerContent.includes("pathname === '/sitemap.xml'") || apiServerContent.includes("'/sitemap.xml'"), 'API server exposes dynamic /sitemap.xml endpoint');

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(`SUMMARY: ${totalChecks} Checks Run | ${passedChecks} Passed | ${failedChecks} Failed`);
console.log('═══════════════════════════════════════════════════════════════════');

if (failedChecks > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All SEO & Metadata audits passed with 100% compliance.\n');
  process.exit(0);
}
