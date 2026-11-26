/**
 * Phase 6 — Server-Side Site/Funnel HTML Renderer, Multi-Tenant SEO & Host-Version Cache
 * Renders published page snapshots safely (escaping untrusted text), generates per-domain
 * canonical URLs, JSON-LD, sitemap.xml, and robots.txt, and caches by verified host + version.
 */

export function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCanonicalUrl(baseUrl, slug = '') {
  const cleanBase = String(baseUrl || 'https://operza.io').replace(/\/+$/, '');
  const cleanSlug = String(slug || '').replace(/^\/+/, '');
  return cleanSlug ? `${cleanBase}/${cleanSlug}` : `${cleanBase}/`;
}

export function renderPublishedSiteHtml({
  site = {},
  page = {},
  versionNumber = 1,
  canonicalBaseUrl = 'https://operza.io',
  isPreview = false
} = {}) {
  const title = escapeHtml(page.seoTitle || page.title || site.name || 'Operza Site');
  const description = escapeHtml(page.seoDescription || site.description || '');
  const canonical = buildCanonicalUrl(canonicalBaseUrl, page.slug || '');
  const robots = isPreview || page.noIndex ? 'noindex, nofollow' : 'index, follow';

  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  const faqItems = blocks.filter((b) => b.type === 'faq' && b.question && b.answer);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: page.seoTitle || page.title || site.name || 'Page',
      url: canonical,
      description: page.seoDescription || site.description || ''
    }
  ];

  if (faqItems.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.map((f) => ({
        '@type': 'Question',
        name: String(f.question),
        acceptedAnswer: { '@type': 'Answer', text: String(f.answer) }
      }))
    });
  }

  const bodyHtml = blocks
    .map((block) => {
      if (block.type === 'headline') return `<h1>${escapeHtml(block.text || '')}</h1>`;
      if (block.type === 'faq') {
        return `<section><h3>${escapeHtml(block.question)}</h3><p>${escapeHtml(block.answer)}</p></section>`;
      }
      if (block.type === 'cta') {
        const href = /^https?:\/\//i.test(String(block.href || '')) || String(block.href || '').startsWith('/')
          ? escapeHtml(block.href)
          : '#';
        return `<a href="${href}">${escapeHtml(block.label || 'Continue')}</a>`;
      }
      return `<p>${escapeHtml(block.text || '')}</p>`;
    })
    .join('\n    ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta name="robots" content="${robots}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta name="operza-site-version" content="${Number(versionNumber)}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

export function generateTenantSitemapXml({ baseUrl, pages = [] } = {}) {
  const publishedPages = pages.filter((p) => p.published !== false && !p.noIndex && p.status !== 'draft');
  const urls = publishedPages
    .map((p) => {
      const loc = escapeHtml(buildCanonicalUrl(baseUrl, p.slug || ''));
      const lastmod = p.updatedAt ? `<lastmod>${escapeHtml(String(p.updatedAt).slice(0, 10))}</lastmod>` : '';
      return `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    ${lastmod}` : ''}\n  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

export function generateTenantRobotsTxt({ baseUrl, allowIndexing = true } = {}) {
  const cleanBase = String(baseUrl || 'https://operza.io').replace(/\/+$/, '');
  if (!allowIndexing) {
    return `User-agent: *\nDisallow: /\n`;
  }
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /preview/\nSitemap: ${cleanBase}/sitemap.xml\n`;
}

export function createPublicPageCache() {
  const store = new Map();

  return {
    get({ host, siteId, version, slug }) {
      return store.get(`${host}:${siteId}:v${version}:${slug}`) || null;
    },
    set({ host, siteId, version, slug }, html) {
      store.set(`${host}:${siteId}:v${version}:${slug}`, html);
    },
    invalidateSite(siteId) {
      for (const key of store.keys()) {
        if (key.includes(`:${siteId}:`)) store.delete(key);
      }
    },
    invalidateHost(host) {
      for (const key of store.keys()) {
        if (key.startsWith(`${host}:`)) store.delete(key);
      }
    },
    size: () => store.size
  };
}
