import { useEffect } from 'react';

export interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  robots?: string;
  ogType?: 'website' | 'article' | 'product';
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  keywords?: string[];
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const DEFAULT_ORIGIN = 'https://operza.io';
const DEFAULT_OG_IMAGE = 'https://operza.io/og-image.svg';

function updateMetaTag(attrName: 'name' | 'property', attrValue: string, content: string | undefined) {
  if (typeof document === 'undefined') return;
  let element = document.head.querySelector(`meta[${attrName}="${attrValue}"]`) as HTMLMetaElement | null;
  if (!content) {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attrName, attrValue);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function updateLinkTag(rel: string, href: string | undefined) {
  if (typeof document === 'undefined') return;
  let element = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!href) {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', rel);
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

/**
 * Operza Centralized SEO & Meta Tag Management Component
 * Automatically binds route titles, canonical URLs, search directives, Open Graph,
 * Twitter cards, and JSON-LD structured microdata.
 */
export function SEO({
  title,
  description,
  canonical,
  robots = 'index, follow',
  ogType = 'website',
  ogImage = DEFAULT_OG_IMAGE,
  ogTitle,
  ogDescription,
  keywords,
  jsonLd,
}: SEOProps) {
  useEffect(() => {
    // 1. Update Document Title
    const formattedTitle = title ? `${title} | Operza` : 'Operza — All-in-One CRM & Business Operating System';
    document.title = formattedTitle;

    // 2. Base Metadata
    updateMetaTag('name', 'description', description);
    updateMetaTag('name', 'robots', robots);
    if (keywords && keywords.length > 0) {
      updateMetaTag('name', 'keywords', keywords.join(', '));
    }

    // 3. Canonical URL
    const canonicalUrl = canonical
      ? canonical.startsWith('http')
        ? canonical
        : `${DEFAULT_ORIGIN}${canonical.startsWith('/') ? '' : '/'}${canonical}`
      : typeof window !== 'undefined'
      ? window.location.href.split('?')[0].split('#')[0]
      : DEFAULT_ORIGIN;
    updateLinkTag('canonical', canonicalUrl);

    // 4. Open Graph Meta Tags
    updateMetaTag('property', 'og:site_name', 'Operza');
    updateMetaTag('property', 'og:type', ogType);
    updateMetaTag('property', 'og:title', ogTitle || formattedTitle);
    updateMetaTag('property', 'og:description', ogDescription || description);
    updateMetaTag('property', 'og:url', canonicalUrl);
    updateMetaTag('property', 'og:image', ogImage);

    // 5. Twitter / X Card Meta Tags
    updateMetaTag('name', 'twitter:card', 'summary_large_image');
    updateMetaTag('name', 'twitter:site', '@operza_hq');
    updateMetaTag('name', 'twitter:title', ogTitle || formattedTitle);
    updateMetaTag('name', 'twitter:description', ogDescription || description);
    updateMetaTag('name', 'twitter:image', ogImage);

    // 6. JSON-LD Structured Data
    const scriptId = 'operza-jsonld-schema';
    let scriptElement = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (jsonLd) {
      if (!scriptElement) {
        scriptElement = document.createElement('script');
        scriptElement.id = scriptId;
        scriptElement.type = 'application/ld+json';
        document.head.appendChild(scriptElement);
      }
      scriptElement.text = JSON.stringify(jsonLd);
    } else if (scriptElement) {
      scriptElement.remove();
    }

    return () => {
      const s = document.getElementById(scriptId);
      if (s) s.remove();
    };
  }, [title, description, canonical, robots, ogType, ogImage, ogTitle, ogDescription, keywords, jsonLd]);

  return null;
}
