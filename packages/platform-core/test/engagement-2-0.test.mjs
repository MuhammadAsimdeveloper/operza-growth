import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionConversation,
  canTransitionMessageState,
  canTransitionCampaign,
  validateTemplate,
  renderSafeTemplate,
  evaluateRecipientEligibility,
  buildRecipientIdempotencyKey,
  classifyProviderDeliveryError,
  generateAiInboxSuggestion
} from '../src/engagement-2-0.mjs';

test('Engagement 2.0: conversation & message state machines enforce lifecycle and callback-only delivery', () => {
  assert.equal(canTransitionConversation('open', 'assigned'), true);
  assert.equal(canTransitionConversation('archived', 'resolved'), false);
  assert.equal(canTransitionConversation('archived', 'open'), true);

  // Delivered requires provider callback
  assert.equal(canTransitionMessageState('sent', 'delivered', { viaProviderCallback: false }), false);
  assert.equal(canTransitionMessageState('sent', 'delivered', { viaProviderCallback: true }), true);
  assert.equal(canTransitionMessageState('draft', 'queued'), true);
});

test('Engagement 2.0: template validation blocks XSS, unknown vars, and unapproved WhatsApp templates', () => {
  const xss = validateTemplate({ channel: 'email', body: '<script>alert(1)</script>' });
  assert.equal(xss.valid, false);
  assert.equal(xss.code, 'UNSAFE_TEMPLATE_CONTENT');

  const unknownVar = validateTemplate({ channel: 'sms', body: 'Hi {{secret.apiKey}}' });
  assert.equal(unknownVar.valid, false);
  assert.equal(unknownVar.code, 'UNKNOWN_TEMPLATE_VARIABLE');

  const waUnapproved = validateTemplate({
    channel: 'whatsapp',
    body: 'Hi {{contact.first_name}}',
    approvalStatus: 'approved',
    providerTemplateId: null
  });
  assert.equal(waUnapproved.valid, false);
  assert.equal(waUnapproved.code, 'WHATSAPP_PROVIDER_APPROVAL_REQUIRED');

  const rendered = renderSafeTemplate({
    channel: 'email',
    body: 'Hello {{contact.first_name}} from {{contact.company}}',
    context: { contact: { first_name: '<b>Alice</b>', company: 'Acme & Co' } }
  });
  assert.equal(rendered, 'Hello &lt;b&gt;Alice&lt;/b&gt; from Acme &amp; Co');
});

test('Engagement 2.0: consent, suppression, quiet hours, and frequency caps fail closed', () => {
  const contact = { id: 'c1', email: 'a@example.com', phone: '+15550101234' };
  const daytime = new Date('2026-11-27T14:00:00Z');
  const nighttime = new Date('2026-11-27T02:00:00Z');

  // Missing marketing consent
  const noConsent = evaluateRecipientEligibility({ contact, channel: 'sms', purpose: 'marketing', now: daytime });
  assert.equal(noConsent.eligible, false);
  assert.equal(noConsent.code, 'CONSENT_REQUIRED');

  // Granted consent + daytime
  const granted = [{ contactId: 'c1', channel: 'sms', status: 'granted', capturedAt: '2026-11-26T10:00:00Z' }];
  const ok = evaluateRecipientEligibility({ contact, channel: 'sms', purpose: 'marketing', consents: granted, now: daytime });
  assert.equal(ok.eligible, true);

  // Quiet hours
  const quiet = evaluateRecipientEligibility({ contact, channel: 'sms', purpose: 'marketing', consents: granted, now: nighttime });
  assert.equal(quiet.eligible, false);
  assert.equal(quiet.code, 'QUIET_HOURS_ACTIVE');

  // Later revocation overrides prior grant
  const revoked = [
    ...granted,
    { contactId: 'c1', channel: 'sms', status: 'revoked', capturedAt: '2026-11-27T12:00:00Z' }
  ];
  const revCheck = evaluateRecipientEligibility({ contact, channel: 'sms', purpose: 'marketing', consents: revoked, now: daytime });
  assert.equal(revCheck.eligible, false);
  assert.equal(revCheck.code, 'CONSENT_REVOKED');

  // Suppression list & frequency cap
  const supCheck = evaluateRecipientEligibility({
    contact,
    channel: 'sms',
    purpose: 'marketing',
    consents: granted,
    suppressions: [{ channel: 'sms', contactId: 'c1' }],
    now: daytime
  });
  assert.equal(supCheck.eligible, false);
  assert.equal(supCheck.code, 'SUPPRESSED_CONTACT');

  const capCheck = evaluateRecipientEligibility({
    contact,
    channel: 'sms',
    purpose: 'marketing',
    consents: granted,
    recentSendCount: 3,
    maxSendsPerWindow: 3,
    now: daytime
  });
  assert.equal(capCheck.eligible, false);
  assert.equal(capCheck.code, 'FREQUENCY_CAP_REACHED');
});

test('Engagement 2.0: campaign lifecycle, idempotency, error classification, and AI human approval gate', () => {
  assert.equal(canTransitionCampaign('draft', 'ready_for_review'), true);
  assert.equal(canTransitionCampaign('draft', 'sending'), false);
  assert.equal(canTransitionCampaign('approved', 'scheduled'), true);

  const k1 = buildRecipientIdempotencyKey({ agencyId: 'a1', locationId: 'l1', campaignId: 'camp1', contactId: 'c1' });
  const k2 = buildRecipientIdempotencyKey({ agencyId: 'a1', locationId: 'l1', campaignId: 'camp1', contactId: 'c1' });
  assert.equal(k1, k2);

  assert.equal(classifyProviderDeliveryError(400).retryable, false);
  assert.equal(classifyProviderDeliveryError(429).retryable, true);

  const ai = generateAiInboxSuggestion({
    contact: { firstName: 'Sam' },
    messages: [{ direction: 'inbound', channel: 'sms', body: 'Can I book a demo and see pricing?' }],
    kbSnippets: [{ id: 'kb-9', title: 'Pricing Guide', excerpt: 'Starter plans start cleanly.' }],
    autoSendPolicyEnabled: false
  });
  assert.equal(ai.isAiSuggestion, true);
  assert.equal(ai.requiresHumanApproval, true);
  assert.equal(ai.intent, 'sales_buying_intent');
  assert.equal(ai.citations.length, 1);
});
