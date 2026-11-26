import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSubscriptionActive } from '../../db/lib/saas-subscriptions-repository.mjs';
import { resolveEntitlements, checkFeatureAccess } from '../src/entitlements.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

test('SaaS Subscription Lifecycle: active, trialing, grace period, and expired/cancelled enforcement', () => {
  const now = Date.now();
  assert.equal(isSubscriptionActive({ status: 'active' }, now), true);
  assert.equal(isSubscriptionActive({ status: 'trialing', trial_ends_at: new Date(now + 60_000).toISOString() }, now), true);
  assert.equal(isSubscriptionActive({ status: 'trialing', trial_ends_at: new Date(now - 60_000).toISOString() }, now), false);
  assert.equal(isSubscriptionActive({ status: 'past_due', grace_period_ends_at: new Date(now + 60_000).toISOString() }, now), true);
  assert.equal(isSubscriptionActive({ status: 'past_due', grace_period_ends_at: new Date(now - 60_000).toISOString() }, now), false);
  assert.equal(isSubscriptionActive({ status: 'cancelled' }, now), false);
  assert.equal(isSubscriptionActive({ status: 'paused' }, now), false);

  const betaEnt = resolveEntitlements({ planId: 'beta' });
  assert.equal(checkFeatureAccess(betaEnt, 'customDomains').allowed, false);
  const growthEnt = resolveEntitlements({ planId: 'growth' });
  assert.equal(checkFeatureAccess(growthEnt, 'customDomains').allowed, true);
});

test('PWA Service Worker Security: versioned cache, zero /api/ caching, and OPERZA_PURGE_CACHE handler', () => {
  const swPath = path.join(ROOT, 'apps/web/public/sw.js');
  const manifestPath = path.join(ROOT, 'apps/web/public/manifest.json');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const sw = fs.readFileSync(swPath, 'utf8');
  assert.ok(sw.includes("CACHE_VERSION = 'operza-static-v1'"));
  assert.ok(sw.includes("url.pathname.startsWith('/api/')"), 'sw.js must explicitly bypass /api/ routes');
  assert.ok(sw.includes('OPERZA_PURGE_CACHE'), 'sw.js must purge all caches on logout/agency switch');
});
