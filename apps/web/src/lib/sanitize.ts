/**
 * Sanitizes user-provided custom HTML for safe embedding in the DOM.
 * Strips script tags, javascript: links, inline on* event attributes,
 * and dangerous executable objects.
 */
export function sanitizeCustomHtml(html: string): string {
  if (!html || typeof html !== 'string') return '';
  return html
    // Remove <script ...>...</script>
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove inline event handlers (onclick=, onerror=, onload=, etc.)
    .replace(/\s*on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove javascript: pseudo-protocols in href and src attributes
    .replace(/(href|src)\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, '$1="#"')
    // Remove dangerous executable plugins
    .replace(/<\/?(object|embed|applet)\b[^>]*>/gi, '');
}
