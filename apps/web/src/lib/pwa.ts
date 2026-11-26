/**
 * Phase 7 — PWA Registration & Tenant-Safe Cache Purge Helper
 */

export async function registerOperzaServiceWorker(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    // Service worker registration is progressive enhancement
  }
}

export async function purgePwaTenantCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'OPERZA_PURGE_CACHE' });
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
}
