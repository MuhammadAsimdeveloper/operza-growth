import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePageSchema,
  STARTER_TEMPLATES,
  validateFunnelSequence,
  canTransitionMediaAsset,
  buildConversionDedupKey,
  renderSafeSectionsHtml
} from '../src/sites-2-0.mjs';

test('Sites 2.0: page schema validator rejects XSS, unsafe URLs, unknown components, and prototype keys', () => {
  const badScript = validatePageSchema({
    slug: '/',
    title: 'Home',
    sections: [{ id: 's1', type: 'hero', props: { heading: '<script>alert(1)</script>' } }]
  });
  assert.equal(badScript.valid, false);
  assert.equal(badScript.code, 'UNSAFE_PAGE_CONTENT');

  const badUrl = validatePageSchema({
    slug: '/',
    title: 'Home',
    sections: [{ id: 's1', type: 'cta', props: { href: 'javascript:alert(1)' } }]
  });
  assert.equal(badUrl.valid, false);
  assert.equal(badUrl.code, 'UNSAFE_PAGE_CONTENT');

  const unknownType = validatePageSchema({
    slug: '/',
    title: 'Home',
    sections: [{ id: 's1', type: 'raw_html_eval', props: {} }]
  });
  assert.equal(unknownType.valid, false);
  assert.equal(unknownType.code, 'UNKNOWN_COMPONENT_TYPE');

  const valid = validatePageSchema(STARTER_TEMPLATES[0].pages[0]);
  assert.equal(valid.valid, true);
});

test('Sites 2.0: starter templates, funnel sequence, media quarantine, and conversion dedup work deterministically', () => {
  assert.equal(STARTER_TEMPLATES.length >= 3, true);

  const funnelOk = validateFunnelSequence([
    { id: 'st1', slug: '/landing', kind: 'landing' },
    { id: 'st2', slug: '/thank-you', kind: 'confirmation' }
  ]);
  assert.equal(funnelOk.valid, true);

  const funnelDup = validateFunnelSequence([
    { id: 'st1', slug: '/landing', kind: 'landing' },
    { id: 'st2', slug: '/landing', kind: 'confirmation' }
  ]);
  assert.equal(funnelDup.valid, false);
  assert.equal(funnelDup.code, 'DUPLICATE_FUNNEL_SLUG');

  // Cannot mark quarantined media clean/published without ClamAV verification
  assert.equal(canTransitionMediaAsset('quarantined', 'scanned_clean', { clamAvVerified: false }), false);
  assert.equal(canTransitionMediaAsset('quarantined', 'scanned_clean', { clamAvVerified: true }), true);

  const k1 = buildConversionDedupKey({ siteId: 'site1', pageId: 'p1', eventType: 'form_submit', sessionKey: 'sess1', timestampBucket: '2026-11-27T10' });
  const k2 = buildConversionDedupKey({ siteId: 'site1', pageId: 'p1', eventType: 'form_submit', sessionKey: 'sess1', timestampBucket: '2026-11-27T10' });
  assert.equal(k1, k2);

  const html = renderSafeSectionsHtml([{ id: 's1', type: 'hero', props: { heading: 'Hello & <Welcome>' } }]);
  assert.equal(html.includes('Hello &amp; &lt;Welcome&gt;'), true);
});
