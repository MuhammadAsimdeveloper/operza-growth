import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthRateLimiter, extractTrustedClientIp } from '../src/security/auth-rate-limiter.mjs';
import { createUploadQuarantineService, validateFileSignature } from '../src/security/upload-scanner.mjs';

test('Auth Rate Limiter: enforces IP & identifier limits, blocks spoofed X-Forwarded-For, and recovers after window', async () => {
  const auditEvents = [];
  const limiter = createAuthRateLimiter({
    policies: { login: { ipMax: 5, idMax: 2, windowMs: 1000 } },
    trustProxy: true,
    trustedProxies: ['127.0.0.1'],
    auditSink: (evt) => auditEvents.push(evt)
  });

  // Spoofed X-Forwarded-For from untrusted remoteAddress must be ignored
  const spoofedReq = { socket: { remoteAddress: '203.0.113.99' }, headers: { 'x-forwarded-for': '198.51.100.1' } };
  assert.equal(extractTrustedClientIp(spoofedReq, { trustProxy: true, trustedProxies: ['127.0.0.1'] }), '203.0.113.99');

  // Trusted proxy X-Forwarded-For is honored
  const trustedReq = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.42' } };
  assert.equal(extractTrustedClientIp(trustedReq, { trustProxy: true, trustedProxies: ['127.0.0.1'] }), '198.51.100.42');

  // Identifier limit (2 per 1000ms)
  assert.equal((await limiter.check({ action: 'login', req: trustedReq, identifier: 'alice@example.com', now: 1000 })).allowed, true);
  assert.equal((await limiter.check({ action: 'login', req: trustedReq, identifier: 'alice@example.com', now: 1100 })).allowed, true);
  const blocked = await limiter.check({ action: 'login', req: trustedReq, identifier: 'alice@example.com', now: 1200 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'AUTH_RATE_LIMITED');
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(auditEvents.length, 1);
  assert.ok(!JSON.stringify(auditEvents[0]).includes('alice@example.com'), 'Identifier must be hashed in audit logs');

  // Recovers after window expires (no permanent lockout DoS)
  assert.equal((await limiter.check({ action: 'login', req: trustedReq, identifier: 'alice@example.com', now: 2500 })).allowed, true);
});

test('Auth Rate Limiter: falls back safely when Redis throws', async () => {
  const limiter = createAuthRateLimiter({
    redisClient: { incr: async () => { throw new Error('ECONNREFUSED'); } }
  });
  const req = { socket: { remoteAddress: '10.0.0.5' }, headers: {} };
  const res = await limiter.check({ action: 'oauth_token', req, identifier: 'client_1' });
  assert.equal(res.allowed, true);
  assert.equal(res.backend, 'memory');
});

test('Upload Quarantine & Malware Scanner: signature validation, fail-closed policy, malware quarantine, and tenant isolation', async () => {
  const tenantA = { agencyId: '11111111-1111-4111-8111-111111111111', locationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const tenantB = { agencyId: '22222222-2222-4222-8222-222222222222', locationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };

  const fakeExeAsPdf = Buffer.from('MZ\x90\x00not-a-pdf');
  assert.equal(validateFileSignature(fakeExeAsPdf, 'application/pdf').valid, false);

  const validPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj');
  assert.equal(validateFileSignature(validPdf, 'application/pdf').valid, true);

  // Fail closed when scanner is unavailable
  const strictNoScanner = createUploadQuarantineService({ scanner: null, failClosedOnUnavailable: true });
  const unavailRes = await strictNoScanner.ingestAndScan({ ...tenantA, filename: 'doc.pdf', mimeType: 'application/pdf', buffer: validPdf });
  assert.equal(unavailRes.ok, false);
  assert.equal(unavailRes.code, 'MALWARE_SCANNER_UNAVAILABLE');
  assert.equal(strictNoScanner.getUploadForTenant({ uploadId: unavailRes.uploadId, ...tenantA }), null);

  // Infected file stays quarantined
  const infectedSvc = createUploadQuarantineService({
    scanner: { name: 'clamav', scanBuffer: async () => ({ status: 'infected', details: 'Eicar-Test-Signature' }) }
  });
  const infRes = await infectedSvc.ingestAndScan({ ...tenantA, filename: 'eicar.pdf', mimeType: 'application/pdf', buffer: validPdf });
  assert.equal(infRes.ok, false);
  assert.equal(infRes.code, 'MALWARE_DETECTED');
  assert.equal(infectedSvc.getUploadForTenant({ uploadId: infRes.uploadId, ...tenantA }), null);

  // Clean file released only for owning tenant
  const cleanSvc = createUploadQuarantineService({
    scanner: { name: 'clamav', scanBuffer: async () => ({ status: 'clean' }) }
  });
  const okRes = await cleanSvc.ingestAndScan({ ...tenantA, filename: 'clean.pdf', mimeType: 'application/pdf', buffer: validPdf });
  assert.equal(okRes.ok, true);
  assert.ok(cleanSvc.getUploadForTenant({ uploadId: okRes.upload.id, ...tenantA }));
  assert.equal(cleanSvc.getUploadForTenant({ uploadId: okRes.upload.id, ...tenantB }), null);
});
