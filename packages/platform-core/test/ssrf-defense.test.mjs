import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateIpAddress,
  assertSafeTargetUrl,
  prePinDnsLookup,
  generateDeterministicIdempotencyKey,
  buildProviderOutboundHeaders
} from '../src/ssrf-defense.mjs';

test('isPrivateIpAddress: identifies and blocks RFC 1918, loopbacks, link-local, and cloud metadata', () => {
  // Loopbacks
  assert.equal(isPrivateIpAddress('127.0.0.1'), true);
  assert.equal(isPrivateIpAddress('127.0.0.2'), true);
  assert.equal(isPrivateIpAddress('::1'), true);

  // AWS/GCP/Azure/DigitalOcean Metadata
  assert.equal(isPrivateIpAddress('169.254.169.254'), true);
  assert.equal(isPrivateIpAddress('169.254.1.1'), true);

  // RFC 1918 Subnets
  assert.equal(isPrivateIpAddress('10.0.0.1'), true);
  assert.equal(isPrivateIpAddress('10.255.255.255'), true);
  assert.equal(isPrivateIpAddress('172.16.0.1'), true);
  assert.equal(isPrivateIpAddress('172.31.255.255'), true);
  assert.equal(isPrivateIpAddress('192.168.1.1'), true);
  assert.equal(isPrivateIpAddress('192.168.0.254'), true);

  // IPv6 unique local & link local
  assert.equal(isPrivateIpAddress('fe80::1'), true);
  assert.equal(isPrivateIpAddress('fc00::1'), true);
  assert.equal(isPrivateIpAddress('fd12:3456:789a:1::1'), true);

  // Public IP addresses (should return false)
  assert.equal(isPrivateIpAddress('8.8.8.8'), false);
  assert.equal(isPrivateIpAddress('1.1.1.1'), false);
  assert.equal(isPrivateIpAddress('104.26.12.31'), false);
  assert.equal(isPrivateIpAddress('2606:4700::6810:c1f'), false);
});

test('assertSafeTargetUrl: strictly rejects insecure schemes, user credentials, and private hostnames', () => {
  // HTTP rejected
  assert.throws(() => assertSafeTargetUrl('http://api.stripe.com/v1/charges'), { code: 'HTTPS_REQUIRED' });
  assert.throws(() => assertSafeTargetUrl('gopher://evil.com'), { code: 'HTTPS_REQUIRED' });
  assert.throws(() => assertSafeTargetUrl('file:///etc/passwd'), { code: 'HTTPS_REQUIRED' });

  // Credentials rejected
  assert.throws(() => assertSafeTargetUrl('https://admin:secret@api.example.com/'), { code: 'URL_CREDENTIALS_FORBIDDEN' });

  // Private hostnames rejected
  assert.throws(() => assertSafeTargetUrl('https://localhost:8080/webhook'), { code: 'SSRF_PRIVATE_NETWORK_TARGET' });
  assert.throws(() => assertSafeTargetUrl('https://internal.service.local/webhook'), { code: 'SSRF_PRIVATE_NETWORK_TARGET' });
  assert.throws(() => assertSafeTargetUrl('https://metadata.google.internal/computeMetadata/v1/'), { code: 'SSRF_PRIVATE_NETWORK_TARGET' });

  // IP literal private targets rejected
  assert.throws(() => assertSafeTargetUrl('https://169.254.169.254/latest/meta-data/'), { code: 'SSRF_PRIVATE_IP_TARGET' });
  assert.throws(() => assertSafeTargetUrl('https://127.0.0.1:3000/'), { code: 'SSRF_PRIVATE_IP_TARGET' });

  // Valid public HTTPS target accepted
  const valid = assertSafeTargetUrl('https://api.resend.com/emails');
  assert.equal(valid.valid, true);
  assert.equal(valid.hostname, 'api.resend.com');
});

test('generateDeterministicIdempotencyKey & buildProviderOutboundHeaders: generates stable keys for identical attempts', () => {
  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';
  const actionHash = 'a'.repeat(64);

  const key1 = generateDeterministicIdempotencyKey({ agencyId, locationId, actionHash, resourceId: 'res_123' });
  const key2 = generateDeterministicIdempotencyKey({ agencyId, locationId, actionHash, resourceId: 'res_123' });
  const keyDifferentAction = generateDeterministicIdempotencyKey({ agencyId, locationId, actionHash: 'b'.repeat(64), resourceId: 'res_123' });

  assert.equal(key1, key2, 'Identical request inputs must yield identical idempotency keys');
  assert.notEqual(key1, keyDifferentAction, 'Different action hashes must produce distinct idempotency keys');
  assert.match(key1, /^opz_idem_[a-f0-9]{32}$/);

  // Headers injection
  const headers = buildProviderOutboundHeaders({ agencyId, locationId, actionHash, resourceId: 'res_123', attempt: 2 });
  assert.equal(headers['Idempotency-Key'], key1);
  assert.equal(headers['X-Idempotency-Key'], key1);
  assert.equal(headers['X-Operza-Attempt'], '2');
  assert.match(headers['User-Agent'], /Operza-Provider-Fabric/);
});
