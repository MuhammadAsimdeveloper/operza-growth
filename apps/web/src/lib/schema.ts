/**
 * Operza Semantic JSON-LD Schema Generator
 * Generates standards-compliant schema.org microdata for Google, Bing, and AI search engines.
 */

export const SCHEMA_ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Operza',
  alternateName: 'Operza Growth OS',
  url: 'https://operza.io',
  logo: 'https://operza.io/favicon.svg',
  description:
    'All-in-one business operating system, multi-tenant agency CRM, and workflow automation platform designed for modern digital agencies.',
  sameAs: [
    'https://twitter.com/operza_hq',
    'https://github.com/MuhammadAsimdeveloper/operza-growth',
  ],
};

export const SCHEMA_WEBSITE = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Operza',
  url: 'https://operza.io',
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://operza.io/blog?q={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

export const SCHEMA_SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Operza Business Operating System',
  operatingSystem: 'Cloud, Web, Self-Hosted Docker',
  applicationCategory: 'BusinessApplication',
  softwareVersion: '2.0.0',
  description:
    'Unified agency operating system featuring multi-tenant CRM, visual workflow automation engine, landing page funnel builder, omnichannel inbox, and white-label client portal.',
  offers: {
    '@type': 'AggregateOffer',
    priceCurrency: 'USD',
    lowPrice: '97.00',
    highPrice: '497.00',
    offerCount: '3',
  },
  featureList: [
    'Multi-Tenant Agency CRM with Row-Level Security',
    'Interactive 2D Visual Workflow Automation Graph Canvas',
    'Element-Level Drag-and-Drop Funnel & Landing Page Builder',
    'Unified Omnichannel Stream: SMS, WhatsApp Cloud API, Email, and Meta Messenger',
    'White-Label Client Portal with Digital Contract E-Signatures',
    'Integrated LMS Course Delivery & Progress Tracking',
    'Bi-Directional Sub-Account Blueprint Snapshots',
  ],
};

export function buildFaqSchema(faqs: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    })),
  };
}

export function buildBreadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `https://operza.io${item.url.startsWith('/') ? '' : '/'}${item.url}`,
    })),
  };
}
