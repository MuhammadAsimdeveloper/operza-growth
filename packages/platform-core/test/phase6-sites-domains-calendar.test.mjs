import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHostname,
  generateDomainVerificationToken,
  verifyDnsTxtOwnership,
  createSslProvisioningAdapter,
  resolvePublicHost
} from '../src/domains/custom-domains.mjs';
import {
  renderPublishedSiteHtml,
  generateTenantSitemapXml,
  generateTenantRobotsTxt,
  createPublicPageCache
} from '../src/sites/ssr-renderer.mjs';
import { computeAvailableSlots } from '../src/scheduling/availability-v2.mjs';

test('Custom Domains: hostname normalization, reserved blocking, DNS TXT verification, and host spoofing protection', async () => {
  assert.equal(normalizeHostname('HTTPS://Portal.Example.COM./path'), 'portal.example.com');
  assert.throws(() => normalizeHostname('operza.io'), (e) => e.code === 'RESERVED_HOSTNAME');
  assert.throws(() => normalizeHostname('sub.operza.io'), (e) => e.code === 'RESERVED_HOSTNAME');
  assert.throws(() => normalizeHostname('*.example.com'), (e) => e.code === 'INVALID_HOSTNAME');
  assert.throws(() => normalizeHostname('127.0.0.1'), (e) => e.code === 'INVALID_HOSTNAME');

  const token = generateDomainVerificationToken();
  assert.ok(token.startsWith('operza-verify-'));

  const expired = await verifyDnsTxtOwnership({
    hostname: 'portal.example.com',
    expectedToken: token,
    expiresAt: Date.now() - 1000,
    resolveTxt: async () => [[token]]
  });
  assert.equal(expired.verified, false);
  assert.equal(expired.code, 'TOKEN_EXPIRED');

  const valid = await verifyDnsTxtOwnership({
    hostname: 'portal.example.com',
    expectedToken: token,
    expiresAt: Date.now() + 60_000,
    resolveTxt: async (host) => (host === '_operza-challenge.portal.example.com' ? [[token]] : [])
  });
  assert.equal(valid.verified, true);

  // Unverified or disconnected domains must never resolve public traffic
  const resolvedPending = resolvePublicHost({
    rawHost: 'portal.example.com:443',
    verifiedDomains: [{ id: 'd1', hostname: 'portal.example.com', status: 'verified', agencyId: 'a1', locationId: 'l1', siteId: 's1' }]
  });
  assert.equal(resolvedPending, null);

  const resolvedActive = resolvePublicHost({
    rawHost: 'PORTAL.EXAMPLE.COM',
    verifiedDomains: [{ id: 'd1', hostname: 'portal.example.com', status: 'active', agencyId: 'a1', locationId: 'l1', siteId: 's1' }]
  });
  assert.equal(resolvedActive.siteId, 's1');
});

test('SSL Provisioning Adapter: requires both certificate issuance and HTTPS verification before active', async () => {
  const unverifiedHttps = createSslProvisioningAdapter({
    provider: 'acme_letsencrypt',
    issueCertificate: async () => ({ ok: true, issuer: 'Let\'s Encrypt Staging' }),
    verifyHttps: async () => ({ ok: false, code: 'TLS_HANDSHAKE_FAILED', message: 'Connection refused' })
  });
  const resFail = await unverifiedHttps.provision({ hostname: 'portal.example.com' });
  assert.equal(resFail.ok, false);
  assert.equal(resFail.status, 'issued');

  const verifiedAdapter = createSslProvisioningAdapter({
    provider: 'acme_letsencrypt',
    issueCertificate: async () => ({ ok: true, issuer: 'Let\'s Encrypt Staging', serialNumber: 'sn_123' }),
    verifyHttps: async () => ({ ok: true })
  });
  const resOk = await verifiedAdapter.provision({ hostname: 'portal.example.com' });
  assert.equal(resOk.ok, true);
  assert.equal(resOk.status, 'active');
  assert.equal(resOk.serialNumber, 'sn_123');
});

test('Sites SSR Renderer & Multi-Tenant SEO: XSS escaping, canonicals, FAQPage JSON-LD, sitemap draft exclusion, and cache invalidation', () => {
  const html = renderPublishedSiteHtml({
    site: { id: 'site_1', name: 'Agency Site' },
    page: {
      slug: 'services',
      seoTitle: 'Services <script>alert(1)</script>',
      seoDescription: 'Agency growth services',
      blocks: [
        { type: 'headline', text: 'Welcome <img src=x onerror=alert(1)>' },
        { type: 'faq', question: 'Do you offer retainers?', answer: 'Yes, monthly.' }
      ]
    },
    versionNumber: 3,
    canonicalBaseUrl: 'https://portal.example.com'
  });

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('<link rel="canonical" href="https://portal.example.com/services" />'));
  assert.ok(html.includes('FAQPage'));

  const sitemap = generateTenantSitemapXml({
    baseUrl: 'https://portal.example.com',
    pages: [
      { slug: '', published: true, status: 'published' },
      { slug: 'draft-secret', published: false, status: 'draft' },
      { slug: 'hidden', published: true, noIndex: true }
    ]
  });
  assert.ok(sitemap.includes('https://portal.example.com/'));
  assert.ok(!sitemap.includes('draft-secret'));
  assert.ok(!sitemap.includes('hidden'));

  const robots = generateTenantRobotsTxt({ baseUrl: 'https://portal.example.com', allowIndexing: true });
  assert.ok(robots.includes('Sitemap: https://portal.example.com/sitemap.xml'));

  const cache = createPublicPageCache();
  cache.set({ host: 'portal.example.com', siteId: 'site_1', version: 3, slug: 'services' }, html);
  assert.equal(cache.size(), 1);
  cache.invalidateSite('site_1');
  assert.equal(cache.size(), 0);
});

test('Calendar V2 Availability: timezone conversion, DST boundary, buffers, min-notice, and time-off blocks', () => {
  // 2026-03-08 is US DST spring-forward day in America/New_York
  const now = new Date('2026-03-08T10:00:00Z').getTime();
  const slots = computeAvailableSlots({
    dateStr: '2026-03-08',
    durationMin: 60,
    rules: {
      timezone: 'America/New_York',
      bufferBeforeMin: 15,
      bufferAfterMin: 15,
      minNoticeMin: 30,
      maxFutureDays: 30,
      weeklyWindows: { sunday: [{ start: '09:00', end: '13:00' }] },
      timeOffBlocks: [{ startsAt: '2026-03-08T15:00:00Z', endsAt: '2026-03-08T16:00:00Z' }]
    },
    existingAppointments: [
      { startsAt: '2026-03-08T13:00:00Z', endsAt: '2026-03-08T14:00:00Z', status: 'confirmed' }
    ],
    now
  });

  // 09:00 EDT = 13:00Z (booked), 10:00 EDT = 14:00Z (blocked by 15m bufferAfter),
  // 11:00 EDT = 15:00Z (blocked by timeOffBlocks), 12:00 EDT = 16:00Z (available!)
  assert.equal(slots.length, 1);
  assert.equal(slots[0].localTime, '12:00');
  assert.equal(slots[0].startsAt, '2026-03-08T16:00:00.000Z');
});
