import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listPlans, resolveEntitlements, checkFeatureAccess, checkUsageLimit, createUsageEvent, aggregateUsage
} from '../src/entitlements.mjs';

test('plans expose capabilities and limits without inventing prices', () => {
  const plans = listPlans();
  assert.ok(plans.length >= 3);
  assert.ok(plans.every(plan => plan.pricing === null));
  const beta = resolveEntitlements({ planId: 'beta' });
  assert.equal(checkFeatureAccess(beta, 'payments').allowed, false);
  assert.equal(checkFeatureAccess(beta, 'crm').allowed, true);
});

test('limit overrides are bounded and usage is checked before consumption', () => {
  const entitlements = resolveEntitlements({ planId: 'beta', limitOverrides: { monthlyWorkflowRuns: 2 } });
  assert.equal(checkUsageLimit(entitlements, { monthlyWorkflowRuns: 1 }, 'monthlyWorkflowRuns').allowed, true);
  assert.equal(checkUsageLimit(entitlements, { monthlyWorkflowRuns: 2 }, 'monthlyWorkflowRuns').code, 'LIMIT_REACHED');
});

test('usage events are idempotently aggregatable and cannot contain secrets', () => {
  const first = createUsageEvent({ tenantId: 'tenant_001', eventId: 'event_001', metric: 'workflow.run', quantity: 1, occurredAt: '2026-11-06T10:00:00Z' });
  const second = createUsageEvent({ tenantId: 'tenant_001', eventId: 'event_002', metric: 'workflow.run', quantity: 2, occurredAt: '2026-11-06T10:01:00Z' });
  const totals = aggregateUsage([first, second, first], { tenantId: 'tenant_001', from: '2026-11-01T00:00:00Z', to: '2026-12-01T00:00:00Z' });
  assert.equal(totals['workflow.run'], 3);
  assert.throws(() => createUsageEvent({ tenantId: 'tenant_001', metric: 'ai.request', metadata: { apiToken: 'secret' } }), { code: 'INVALID_USAGE_METADATA' });
});
