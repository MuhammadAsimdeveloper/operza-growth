export function GET() {
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://operza.io/sitemap.xml\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
