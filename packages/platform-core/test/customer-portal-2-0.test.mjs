import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePortalToken,
  hashPortalToken,
  validatePortalRedirect,
  verifyMagicLinkRecord,
  verifyPortalSessionRecord,
  assertCustomerOwnsRecord,
  sanitizeCustomerProfilePatch,
  filterCustomerVisibleMessages,
  canTransitionPortalRequest,
  isSensitiveSelfServiceRequest
} from '../src/customer-portal-2-0.mjs';

test('Customer Portal 2.0: magic link hashing, single-use, expiry, agency binding, and redirect safety', () => {
  const { rawToken, tokenHash } = generatePortalToken();
  assert.equal(hashPortalToken(rawToken), tokenHash);
  assert.notEqual(rawToken, tokenHash);

  const future = new Date(Date.now() + 600_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  const valid = verifyMagicLinkRecord({ agency_id: 'ag1', expires_at: future });
  assert.equal(valid.valid, true);
  assert.equal(valid.role, 'external_customer');

  assert.equal(verifyMagicLinkRecord({ agency_id: 'ag1', expires_at: past }).code, 'MAGIC_LINK_EXPIRED');
  assert.equal(verifyMagicLinkRecord({ agency_id: 'ag1', expires_at: future, consumed_at: new Date().toISOString() }).code, 'MAGIC_LINK_ALREADY_USED');
  assert.equal(verifyMagicLinkRecord({ agency_id: 'ag1', expires_at: future }, { expectedAgencyId: 'ag2' }).code, 'MAGIC_LINK_AGENCY_MISMATCH');

  assert.equal(validatePortalRedirect('https://evil.example/steal'), '/portal');
  assert.equal(validatePortalRedirect('//evil.example'), '/portal');
  assert.equal(validatePortalRedirect('/portal/invoices'), '/portal/invoices');
});

test('Customer Portal 2.0: IDOR ownership, session revocation, internal-note isolation, and profile allowlist', () => {
  const session = {
    agency_id: 'ag1',
    location_id: 'loc1',
    contact_id: 'cust1',
    expires_at: new Date(Date.now() + 3600_000).toISOString()
  };
  const check = verifyPortalSessionRecord(session, { expectedAgencyId: 'ag1' });
  assert.equal(check.valid, true);
  assert.equal(check.role, 'external_customer');

  assert.throws(
    () => assertCustomerOwnsRecord({ agency_id: 'ag1', location_id: 'loc1', contact_id: 'cust2' }, { agencyId: 'ag1', locationId: 'loc1', contactId: 'cust1' }),
    { code: 'CUSTOMER_OWNERSHIP_DENIED' }
  );

  assert.throws(
    () => sanitizeCustomerProfilePatch({ firstName: 'Alice', portalAccess: true, tags: ['vip'] }),
    { code: 'RESTRICTED_PROFILE_FIELD' }
  );

  const visible = filterCustomerVisibleMessages([
    { id: '1', senderType: 'agent', body: 'Hello!' },
    { id: '2', senderType: 'internal_note', body: 'Private agency note' },
    { id: '3', senderType: 'agent', isInternal: true, body: 'Hidden' },
    { id: '4', senderType: 'contact', body: 'Thanks!' }
  ]);
  assert.equal(visible.length, 2);
  assert.deepEqual(visible.map((m) => m.id), ['1', '4']);
});

test('Customer Portal 2.0: self-service request lifecycle requires approval for sensitive actions', () => {
  assert.equal(isSensitiveSelfServiceRequest('refund_review'), true);
  assert.equal(isSensitiveSelfServiceRequest('order_cancellation'), true);
  assert.equal(canTransitionPortalRequest('requested', 'approved'), true);
  assert.equal(canTransitionPortalRequest('requested', 'completed'), false);
  assert.equal(canTransitionPortalRequest('approved', 'completed'), true);
});
