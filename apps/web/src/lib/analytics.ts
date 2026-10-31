/**
 * Operza Privacy-First Analytics & Conversion Tracking Utility
 * Safely dispatches standard analytics events to Google Analytics 4 (GA4) or custom
 * telemetry endpoints without crashing if blockers or offline mode are active.
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export type ConversionEvent =
  | 'page_view'
  | 'cta_click'
  | 'pricing_select'
  | 'signup_start'
  | 'signup_complete'
  | 'demo_request'
  | 'doc_view';

export function trackEvent(name: ConversionEvent, properties: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;

  const eventPayload = {
    ...properties,
    timestamp: new Date().toISOString(),
    path: window.location.pathname,
  };

  // 1. Google Analytics 4 dispatch if configured
  if (typeof window.gtag === 'function') {
    try {
      window.gtag('event', name, eventPayload);
    } catch {
      // safe fallback
    }
  }

  // 2. DataLayer push for Google Tag Manager
  if (Array.isArray(window.dataLayer)) {
    try {
      window.dataLayer.push({ event: name, ...eventPayload });
    } catch {
      // safe fallback
    }
  }
}

export function initAnalytics() {
  if (typeof window === 'undefined') return;
  const gaId = (import.meta as any).env?.VITE_GA_MEASUREMENT_ID;
  if (!gaId || document.getElementById('operza-ga-script')) return;

  const script = document.createElement('script');
  script.id = 'operza-ga-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer?.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', gaId, { send_page_view: true });
}
