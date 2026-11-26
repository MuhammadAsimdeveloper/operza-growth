export function GET() {
  const pages = ['', '/features', '/integrations', '/pricing', '/contact'];
  const urls = pages
    .map((p) => `  <url>\n    <loc>https://operza.io${p || '/'}</loc>\n  </url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' }
  });
}
