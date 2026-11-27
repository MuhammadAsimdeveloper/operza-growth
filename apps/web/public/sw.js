/**
 * Operza Growth — Versioned PWA Service Worker 2.0
 * Security invariants:
 * - NEVER cache /api/*, /ws, cross-origin requests, or authenticated tenant data.
 * - Scope cache cleanup strictly to `operza-` prefixes so unrelated origin data is untouched.
 * - Purge all `operza-` caches immediately upon OPERZA_PURGE_CACHE (logout / agency switch).
 */

const CACHE_PREFIX = 'operza-';
const CACHE_VERSION = 'operza-static-v2';
const STATIC_ALLOWLIST = new Set([
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/offline.html'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll([...STATIC_ALLOWLIST])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event?.data?.type === 'OPERZA_PURGE_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)))
      )
    );
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;

  // Honest offline fallback for navigation requests without caching private HTML
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  const isStaticAsset = url.pathname.startsWith('/assets/') || STATIC_ALLOWLIST.has(url.pathname);
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
