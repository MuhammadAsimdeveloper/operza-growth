import { createHash } from 'node:crypto';
import { escapeHtml } from './sites/ssr-renderer.mjs';

export const PAGE_SCHEMA_VERSION = 2;

export const SITE_COMPONENT_LIBRARY = Object.freeze({
  layout: ['container', 'section', 'grid', 'columns', 'stack', 'spacer', 'divider'],
  navigation: ['header', 'navbar', 'mobile_nav', 'footer', 'breadcrumbs'],
  content: ['heading', 'text', 'rich_text', 'image', 'video_embed', 'icon', 'list', 'quote', 'logo_list'],
  marketing: ['hero', 'feature_grid', 'benefits', 'pricing', 'faq', 'cta', 'lead_capture', 'newsletter'],
  commerce: ['product_display', 'price_display', 'payment_link', 'purchase_cta', 'order_confirmation'],
  forms: ['contact_form', 'lead_form', 'booking_form', 'newsletter_form', 'custom_form']
});

const ALL_COMPONENT_TYPES = new Set(Object.values(SITE_COMPONENT_LIBRARY).flat());

const UNSAFE_HTML_RE = /<\s*script\b|javascript:|on[a-z]+\s*=|<\s*iframe\b/i;

function scanUnsafeValues(val) {
  if (typeof val === 'string') {
    return UNSAFE_HTML_RE.test(val);
  }
  if (Array.isArray(val)) {
    return val.some(scanUnsafeValues);
  }
  if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return true;
      if (scanUnsafeValues(v)) return true;
    }
  }
  return false;
}

export function validatePageSchema(page = {}) {
  const slug = String(page.slug || '/').trim();
  if (!slug.startsWith('/') || /\.\./.test(slug)) {
    return { valid: false, code: 'INVALID_PAGE_SLUG', error: 'Page slug must start with "/" and not contain ".."' };
  }
  if (!page.title || typeof page.title !== 'string' || !page.title.trim()) {
    return { valid: false, code: 'PAGE_TITLE_REQUIRED', error: 'Page title is required' };
  }
  const sections = Array.isArray(page.sections) ? page.sections : [];
  if (sections.length > 100) {
    return { valid: false, code: 'TOO_MANY_SECTIONS', error: 'Page cannot exceed 100 sections' };
  }
  for (let i = 0; i < sections.length; i += 1) {
    const sec = sections[i];
    if (!sec || typeof sec !== 'object' || !sec.id || !sec.type) {
      return { valid: false, code: 'INVALID_SECTION', error: `Section at index ${i} requires id and type` };
    }
    if (!ALL_COMPONENT_TYPES.has(sec.type)) {
      return { valid: false, code: 'UNKNOWN_COMPONENT_TYPE', error: `Unsupported component type: ${sec.type}` };
    }
    if (scanUnsafeValues(sec)) {
      return { valid: false, code: 'UNSAFE_PAGE_CONTENT', error: `Unsafe script, handler, or prototype key detected in section ${sec.id}` };
    }
  }
  if (scanUnsafeValues(page.seoMeta || {})) {
    return { valid: false, code: 'UNSAFE_SEO_META', error: 'Unsafe content in SEO metadata' };
  }
  return { valid: true, schemaVersion: PAGE_SCHEMA_VERSION, sectionCount: sections.length };
}

export const STARTER_TEMPLATES = Object.freeze([
  {
    id: 'tpl-agency-growth',
    name: 'Agency Growth Starter',
    category: 'agency_website',
    description: 'Clean responsive agency homepage with editable hero, feature grid, FAQ, and lead form.',
    pages: [
      {
        slug: '/',
        title: 'Home (Starter Placeholder)',
        sections: [
          { id: 'sec-hero', type: 'hero', props: { heading: '[Editable Headline] Grow With Clarity', subheading: 'Replace with your agency value proposition.', ctaLabel: 'Book Strategy Call', ctaHref: '#lead-form' } },
          { id: 'sec-features', type: 'feature_grid', props: { heading: 'Core Services', items: ['CRM & Pipeline Management', 'Workflow Automation', 'Reporting & Attribution'] } },
          { id: 'sec-form', type: 'lead_form', props: { heading: 'Request a Consultation', formSlug: 'contact' } }
        ]
      }
    ]
  },
  {
    id: 'tpl-saas-landing',
    name: 'SaaS Product Launch',
    category: 'saas_landing',
    description: 'Conversion-focused SaaS landing page with pricing section, FAQ, and newsletter capture.',
    pages: [
      {
        slug: '/',
        title: 'Product Overview (Starter Placeholder)',
        sections: [
          { id: 'sec-hero', type: 'hero', props: { heading: '[Editable Headline] Modern Operations Platform', subheading: 'Customize this starter copy for your product.', ctaLabel: 'Get Started', ctaHref: '/signup' } },
          { id: 'sec-faq', type: 'faq', props: { items: [{ question: 'How does onboarding work?', answer: 'Replace with your onboarding details.' }] } }
        ]
      }
    ]
  },
  {
    id: 'tpl-appointment-booking',
    name: 'Appointment & Consultation',
    category: 'appointment_business',
    description: 'Consultation landing page wired directly to Calendar V2 booking.',
    pages: [
      {
        slug: '/',
        title: 'Book an Appointment (Starter Placeholder)',
        sections: [
          { id: 'sec-hero', type: 'hero', props: { heading: '[Editable Headline] Schedule Your Session', subheading: 'Select an available time slot below.', ctaLabel: 'Choose Time', ctaHref: '#booking' } },
          { id: 'sec-book', type: 'booking_form', props: { calendarSlug: 'discovery-strategy' } }
        ]
      }
    ]
  }
]);

export function validateFunnelSequence(steps = []) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { valid: false, code: 'EMPTY_FUNNEL', error: 'Funnel must have at least one step' };
  }
  const slugs = new Set();
  for (const step of steps) {
    if (!step.id || !step.slug || !step.kind) {
      return { valid: false, code: 'INVALID_FUNNEL_STEP', error: 'Each funnel step requires id, slug, and kind' };
    }
    const normSlug = String(step.slug).toLowerCase();
    if (slugs.has(normSlug)) {
      return { valid: false, code: 'DUPLICATE_FUNNEL_SLUG', error: `Duplicate funnel step slug: ${step.slug}` };
    }
    slugs.add(normSlug);
  }
  return { valid: true, stepCount: steps.length };
}

const MEDIA_TRANSITIONS = Object.freeze({
  uploaded: new Set(['quarantined', 'scanned_clean', 'infected']),
  quarantined: new Set(['scanned_clean', 'infected']),
  scanned_clean: new Set(['published']),
  infected: new Set([]),
  published: new Set([])
});

export function canTransitionMediaAsset(fromStatus, toStatus, { clamAvVerified = false } = {}) {
  if ((toStatus === 'scanned_clean' || toStatus === 'published') && fromStatus === 'quarantined' && !clamAvVerified) {
    return false;
  }
  return Boolean(MEDIA_TRANSITIONS[fromStatus]?.has(toStatus));
}

export function buildConversionDedupKey({ siteId = '', funnelId = '', pageId = '', eventType, sessionKey = '', timestampBucket = '' }) {
  return createHash('sha256')
    .update(`${siteId}:${funnelId}:${pageId}:${eventType}:${sessionKey}:${timestampBucket}`)
    .digest('hex')
    .slice(0, 32);
}

export function renderSafeSectionsHtml(sections = []) {
  return sections
    .map((sec) => {
      const props = sec.props || {};
      if (sec.type === 'hero' || sec.type === 'heading') {
        return `<section data-section-id="${escapeHtml(sec.id)}"><h1>${escapeHtml(props.heading || props.text || '')}</h1>${props.subheading ? `<p>${escapeHtml(props.subheading)}</p>` : ''}</section>`;
      }
      if (sec.type === 'faq' && Array.isArray(props.items)) {
        const inner = props.items
          .map((item) => `<div><h3>${escapeHtml(item.question || '')}</h3><p>${escapeHtml(item.answer || '')}</p></div>`)
          .join('');
        return `<section data-section-id="${escapeHtml(sec.id)}">${inner}</section>`;
      }
      if (sec.type === 'cta') {
        const href = /^https?:\/\//i.test(String(props.href || '')) || String(props.href || '').startsWith('/') || String(props.href || '').startsWith('#')
          ? escapeHtml(props.href)
          : '#';
        return `<section data-section-id="${escapeHtml(sec.id)}"><a href="${href}">${escapeHtml(props.label || 'Continue')}</a></section>`;
      }
      return `<section data-section-id="${escapeHtml(sec.id)}" data-component="${escapeHtml(sec.type)}"><p>${escapeHtml(props.heading || props.text || '')}</p></section>`;
    })
    .join('\n');
}
