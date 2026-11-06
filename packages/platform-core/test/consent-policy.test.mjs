import test from 'node:test';
import assert from 'node:assert/strict';
import { recordConsent, evaluateCommunicationPolicy } from '../src/consent-policy.mjs';

const identity = {
  tenantId: 'tenant_001',
  locationId: 'location_001',
  contactId: 'contact_001',
  channel: 'email',
  purpose: 'marketing'
};
const provider = {
  tenantId: 'tenant_001',
  locationId: 'location_001',
  channel: 'email',
  status: 'verified'
};

test('requires explicit, current consent for exact tenant, contact, channel and purpose', () => {
  const consent = recordConsent({ ...identity, status: 'granted', source: 'web_form' }, { id: 'consent_001', now: 1_700_000_000_000 });
  const result = evaluateCommunicationPolicy({ consentRecords: [consent], identity, providerConnection: provider, now: 1_700_000_000_001 });
  assert.equal(result.allowed, true);
  assert.equal(result.code, 'CONSENT_VALID');
});

test('does not reuse transactional consent for marketing messages', () => {
  const consent = recordConsent({ ...identity, purpose: 'transactional', status: 'granted', source: 'api' });
  const result = evaluateCommunicationPolicy({ consentRecords: [consent], identity, providerConnection: provider });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'CONSENT_NOT_FOUND');
});

test('a newer opt-out overrides an older grant', () => {
  const granted = recordConsent({ ...identity, status: 'granted', source: 'web_form' }, { now: 1_700_000_000_000, id: 'grant' });
  const revoked = recordConsent({ ...identity, status: 'revoked', source: 'keyword_opt_out' }, { now: 1_700_000_000_100, id: 'revoke' });
  const result = evaluateCommunicationPolicy({ consentRecords: [granted, revoked], identity, providerConnection: provider, now: 1_700_000_000_200 });
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'CONSENT_REVOKED');
});

test('fails closed for missing provider, unsupported purposes and expired consent', () => {
  const consent = recordConsent({ ...identity, status: 'granted', source: 'web_form', expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(evaluateCommunicationPolicy({ consentRecords: [consent], identity, providerConnection: null }).code, 'PROVIDER_NOT_VERIFIED');
  assert.equal(evaluateCommunicationPolicy({ consentRecords: [consent], identity, providerConnection: provider, now: Date.now() }).code, 'CONSENT_EXPIRED');
  assert.throws(() => recordConsent({ ...identity, purpose: 'everything', status: 'granted', source: 'web_form' }), { code: 'INVALID_CONSENT_SCOPE' });
});
