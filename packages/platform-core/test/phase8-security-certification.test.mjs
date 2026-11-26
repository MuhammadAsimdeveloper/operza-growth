import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

test('Phase 8 Security Regression: API security headers, AuthContext PWA cache purge, and CycloneDX SBOM present', () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, 'apps/api/server.mjs'), 'utf8');
  assert.ok(serverSrc.includes("'content-security-policy': \"default-src 'none'; frame-ancestors 'none'\""));
  assert.ok(serverSrc.includes("'strict-transport-security': 'max-age=31536000; includeSubDomains'"));
  assert.ok(serverSrc.includes("'x-content-type-options': 'nosniff'"));

  const authCtxSrc = fs.readFileSync(path.join(ROOT, 'apps/web/src/lib/AuthContext.tsx'), 'utf8');
  assert.ok(authCtxSrc.includes('purgePwaTenantCaches()'), 'AuthContext must purge PWA caches on logout and switchLocation');

  const sbomPath = path.join(ROOT, 'docs/PHASE_8/sbom-cyclonedx.json');
  assert.ok(fs.existsSync(sbomPath), 'CycloneDX SBOM must exist');
  const sbom = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.ok(Array.isArray(sbom.components) && sbom.components.length > 100);
});
