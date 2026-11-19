import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuthoritativeConsent } from '../src/trusted-handlers.mjs';

test('verifyAuthoritativeConsent unit tests (10 fail-closed conditions)', async (t) => {
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';
  const contactId = '33333333-3333-3333-3333-333333333333';
  const channel = 'email';
  const purpose = 'transactional';

  await t.test('1. Condition 1: Fails closed when pool is null, even with caller-supplied granted consent', async () => {
    const res = await verifyAuthoritativeConsent({
      pool: null,
      tenantId,
      locationId,
      contactId,
      channel,
      purpose,
      suppliedConsent: { status: 'granted', channel: 'email', contactId }
    });
    assert.equal(res, null, 'Must return null when pool is not configured');
  });

  await t.test('2. Condition 2: Fails closed when tenantId is missing', async () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) };
    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId: null,
      locationId,
      contactId,
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when tenantId is null/undefined');
  });

  await t.test('3. Condition 3: Fails closed when locationId is missing', async () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) };
    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId: null,
      contactId,
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when locationId is null/undefined');
  });

  await t.test('4. Condition 4: Fails closed when contactId is missing', async () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) };
    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId: null,
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when contactId is null/undefined');
  });

  await t.test('5. Condition 5: Fails closed when channel is missing', async () => {
    const mockPool = { connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) };
    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId,
      channel: null,
      purpose
    });
    assert.equal(res, null, 'Must return null when channel is null/undefined');
  });

  await t.test('6. Condition 6: Non-UUID contact lookup fails when record not found in location_records', async () => {
    let rolledBack = false;
    const mockClient = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        if (sql === 'ROLLBACK') { rolledBack = true; return {}; }
        if (sql.includes('set_config')) return {};
        if (sql.includes('SELECT id FROM location_records')) {
          return { rows: [] }; // Contact not found
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockPool = { connect: async () => mockClient };

    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId: 'contact@example.com',
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when contact lookup returns no record');
    assert.equal(rolledBack, true, 'Must execute ROLLBACK on contact lookup failure');
  });

  await t.test('7. Condition 7: Returns null when no consent record exists in communication_consents', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        if (sql.includes('set_config')) return {};
        if (sql.includes('communication_consents')) {
          return { rows: [] }; // No consent record
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockPool = { connect: async () => mockClient };

    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId,
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when no consent record exists');
  });

  await t.test('8. Condition 8: Returns null when consent status is revoked or denied', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        if (sql.includes('set_config')) return {};
        if (sql.includes('communication_consents')) {
          return {
            rows: [{
              id: '44444444-4444-4444-4444-444444444444',
              agency_id: tenantId,
              location_id: locationId,
              contact_id: contactId,
              channel,
              purpose,
              status: 'revoked',
              source: 'web_form',
              captured_at: new Date()
            }]
          };
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockPool = { connect: async () => mockClient };

    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId,
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when consent status is revoked');
  });

  await t.test('9. Condition 9: Returns null when consent is expired', async () => {
    const mockClient = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        if (sql.includes('set_config')) return {};
        if (sql.includes('communication_consents')) {
          return {
            rows: [{
              id: '44444444-4444-4444-4444-444444444444',
              agency_id: tenantId,
              location_id: locationId,
              contact_id: contactId,
              channel,
              purpose,
              status: 'granted',
              source: 'web_form',
              expires_at: new Date(Date.now() - 3600_000), // Expired 1 hour ago
              captured_at: new Date(Date.now() - 7200_000)
            }]
          };
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockPool = { connect: async () => mockClient };

    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId,
      channel,
      purpose
    });
    assert.equal(res, null, 'Must return null when consent is expired');
  });

  await t.test('10. Condition 10: Returns structured consent object when active, granted consent exists', async () => {
    const consentId = '44444444-4444-4444-4444-444444444444';
    const capturedAt = new Date();
    const mockClient = {
      query: async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return {};
        if (sql.includes('set_config')) return {};
        if (sql.includes('communication_consents')) {
          return {
            rows: [{
              id: consentId,
              agency_id: tenantId,
              location_id: locationId,
              contact_id: contactId,
              channel,
              purpose,
              status: 'granted',
              source: 'web_form',
              expires_at: null,
              captured_at: capturedAt
            }]
          };
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockPool = { connect: async () => mockClient };

    const res = await verifyAuthoritativeConsent({
      pool: mockPool,
      tenantId,
      locationId,
      contactId,
      channel,
      purpose
    });
    assert.ok(res, 'Must return verified consent object');
    assert.equal(res.status, 'granted');
    assert.equal(res.consentId, consentId);
    assert.equal(res.channel, channel);
    assert.equal(res.purpose, purpose);
    assert.equal(res.contactId, contactId);
    assert.equal(res.source, 'web_form');
  });
});
