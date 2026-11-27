/**
 * PWA Registration, Online Status & Tenant-Safe Cache Purge Helper
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
    await Promise.all(keys.filter((k) => k.startsWith('operza-')).map((k) => caches.delete(k)));
  }
}

export function subscribeOnlineStatus(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleOnline = () => onChange(true);
  const handleOffline = () => onChange(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
