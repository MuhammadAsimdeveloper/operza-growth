#!/usr/bin/env node
/**
 * Operza Build-Time Static Prerendering Script for Public Marketing Routes
 * 
 * Generates route-specific HTML files for the 12 public marketing pages from apps/web/dist/index.html.
 * Pre-injects route-specific <title>, meta description, canonical link, Open Graph tags,
 * and JSON-LD schemas so search engines, crawlers, and link-preview bots receive full,
 * instant metadata without waiting for client-side JavaScript execution.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const DIST_INDEX_PATH = path.join(ROOT_DIR, 'apps/web/dist/index.html');
const MARKETING_DIR = path.join(ROOT_DIR, 'apps/web/src/pages/marketing');

if (!fs.existsSync(DIST_INDEX_PATH)) {
  console.error(`❌ Dist index.html not found at ${DIST_INDEX_PATH}. Please run "npm run build" first.`);
  process.exit(1);
}

const baseHtml = fs.readFileSync(DIST_INDEX_PATH, 'utf8');

const PUBLIC_PAGES = [
  { file: 'Home.tsx', route: '/' },
  { file: 'PlatformCrm.tsx', route: '/platform/crm' },
  { file: 'PlatformAutomation.tsx', route: '/platform/automation' },
  { file: 'PlatformFunnels.tsx', route: '/platform/funnels' },
  { file: 'PlatformConversations.tsx', route: '/platform/conversations' },
  { file: 'PlatformPortal.tsx', route: '/platform/portal' },
  { file: 'PlatformCourses.tsx', route: '/platform/courses' },
  { file: 'PlatformReporting.tsx', route: '/platform/reporting' },
  { file: 'Pricing.tsx', route: '/pricing' },
  { file: 'About.tsx', route: '/about' },
  { file: 'Docs.tsx', route: '/docs' },
  { file: 'Blog.tsx', route: '/blog' }
];

console.log('═══════════════════════════════════════════════════════════════════');
console.log('         OPERZA STATIC ROUTE PRERENDER PIPELINE                    ');
console.log('═══════════════════════════════════════════════════════════════════');

let generatedCount = 0;

for (const { file, route } of PUBLIC_PAGES) {
  const srcPath = path.join(MARKETING_DIR, file);
  if (!fs.existsSync(srcPath)) {
    console.warn(`⚠️ Warning: Source file ${file} not found.`);
    continue;
  }

  const srcContent = fs.readFileSync(srcPath, 'utf8');

  // Extract SEO props
  const titleMatch = srcContent.match(/title="([^"]+)"/);
  const descMatch = srcContent.match(/description="([^"]+)"/);
  const canonMatch = srcContent.match(/canonical="([^"]+)"/);

  const title = titleMatch ? titleMatch[1] : 'Operza — Unified Agency Business Operating System';
  const description = descMatch ? descMatch[1] : 'Scale your agency with Operza: unified agency business operating system.';
  const canonicalRel = canonMatch ? canonMatch[1] : route;
  const canonicalUrl = `https://operza.io${canonicalRel.startsWith('/') ? canonicalRel : `/${canonicalRel}`}`;

  // Replace tags in base HTML
  let prerendered = baseHtml;

  // Title tag
  prerendered = prerendered.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);

  // Meta description
  prerendered = prerendered.replace(
    /<meta\s+name="description"\s+content=".*?"\s*\/>/s,
    `<meta name="description" content="${description.replace(/"/g, '&quot;')}" />`
  );

  // Canonical link
  prerendered = prerendered.replace(
    /<link\s+rel="canonical"\s+href=".*?"\s*\/>/s,
    `<link rel="canonical" href="${canonicalUrl}" />`
  );

  // Open Graph
  prerendered = prerendered.replace(
    /<meta\s+property="og:title"\s+content=".*?"\s*\/>/s,
    `<meta property="og:title" content="${title.replace(/"/g, '&quot;')}" />`
  );
  prerendered = prerendered.replace(
    /<meta\s+property="og:description"\s+content=".*?"\s*\/>/s,
    `<meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />`
  );
  prerendered = prerendered.replace(
    /<meta\s+property="og:url"\s+content=".*?"\s*\/>/s,
    `<meta property="og:url" content="${canonicalUrl}" />`
  );

  // Twitter
  prerendered = prerendered.replace(
    /<meta\s+name="twitter:title"\s+content=".*?"\s*\/>/s,
    `<meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}" />`
  );
  prerendered = prerendered.replace(
    /<meta\s+name="twitter:description"\s+content=".*?"\s*\/>/s,
    `<meta name="twitter:description" content="${description.replace(/"/g, '&quot;')}" />`
  );
  prerendered = prerendered.replace(
    /<meta\s+name="twitter:url"\s+content=".*?"\s*\/>/s,
    `<meta name="twitter:url" content="${canonicalUrl}" />`
  );

  // Determine output directory
  let targetFile;
  if (route === '/') {
    targetFile = DIST_INDEX_PATH;
  } else {
    const routeDir = path.join(ROOT_DIR, 'apps/web/dist', route.replace(/^\//, ''));
    fs.mkdirSync(routeDir, { recursive: true });
    targetFile = path.join(routeDir, 'index.html');
  }

  fs.writeFileSync(targetFile, prerendered, 'utf8');
  console.log(`  ✓ Prerendered ${route} -> ${path.relative(ROOT_DIR, targetFile)}`);
  generatedCount++;
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log(`✅ Successfully prerendered ${generatedCount} canonical public routes with static metadata.`);
