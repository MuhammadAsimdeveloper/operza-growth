import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webPublic = path.join(repoRoot, 'apps', 'web', 'public');

test('PWA 2.0: manifest.json declares valid standalone metadata and existing icon assets', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(webPublic, 'manifest.json'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);
  for (const icon of manifest.icons) {
    const filePath = path.join(webPublic, icon.src.replace(/^\//, ''));
    assert.equal(fs.existsSync(filePath), true, `Missing manifest icon: ${icon.src}`);
  }
  assert.equal(fs.existsSync(path.join(webPublic, 'offline.html')), true);
});

test('PWA 2.0: sw.js enforces strict non-API caching, same-origin guard, and operza-scoped purge', () => {
  const sw = fs.readFileSync(path.join(webPublic, 'sw.js'), 'utf8');
  assert.equal(sw.includes("url.origin !== self.location.origin"), true);
  assert.equal(sw.includes("url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')"), true);
  assert.equal(sw.includes("OPERZA_PURGE_CACHE"), true);
  assert.equal(sw.includes("k.startsWith(CACHE_PREFIX)"), true);
  assert.equal(sw.includes("caches.match('/offline.html')"), true);
});

test('PWA 2.0: AuthContext clears tenant & PWA caches on logout and location switch', () => {
  const authCtx = fs.readFileSync(path.join(repoRoot, 'apps', 'web', 'src', 'lib', 'AuthContext.tsx'), 'utf8');
  const purgeCalls = authCtx.match(/purgePwaTenantCaches\(\)/g) || [];
  assert.ok(purgeCalls.length >= 2, 'Expected purgePwaTenantCaches() on both logout and switchLocation');
});
