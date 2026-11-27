import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateFinancialsByCurrency,
  buildSafeReportQuery,
  computeFunnelConversion,
  evaluateThresholdAlert,
  formatSafeCsv,
  METRIC_CATALOG_V2,
  redactExportRows
} from '../src/analytics-2-0.mjs';

test('Metric Catalog V2 covers all 10 categories and separates currencies in minor units', () => {
  const categories = new Set(METRIC_CATALOG_V2.map(m => m.category));
  for (const c of ['crm', 'sales', 'financial', 'scheduling', 'communication', 'workflow', 'integration', 'ai', 'marketplace', 'saas']) {
    assert.ok(categories.has(c), `Missing metric category ${c}`);
  }

  const fin = aggregateFinancialsByCurrency([
    { currency: 'usd', status: 'succeeded', amount_cents: 10000 },
    { currency: 'usd', status: 'refunded', amount_cents: 2500 },
    { currency: 'usd', status: 'failed', amount_cents: 99000 },
    { currency: 'pkr', status: 'paid', amount_cents: 500000 }
  ]);
  assert.equal(fin.length, 2);
  const usd = fin.find(f => f.currency === 'usd');
  const pkr = fin.find(f => f.currency === 'pkr');
  assert.equal(usd.grossCollectedCents, 10000);
  assert.equal(usd.refundedCents, 2500);
  assert.equal(usd.netCollectedCents, 7500);
  assert.equal(usd.failedAttemptCents, 99000);
  assert.equal(pkr.netCollectedCents, 500000);
});

test('Safe Report Query Builder enforces allowlists, permissions, and bounded limits', () => {
  const q = buildSafeReportQuery({
    dataSource: 'opportunities',
    dimensions: ['status'],
    measures: ['count', 'sum:value'],
    filters: [{ field: 'status', operator: 'eq', value: 'won' }],
    limit: 9999
  });
  assert.ok(q.sql.includes('agency_id = $1 AND location_id = $2'));
  assert.equal(q.limit, 500);

  assert.throws(
    () => buildSafeReportQuery({ dataSource: 'users_secrets', measures: ['count'] }),
    err => err.code === 'INVALID_DATA_SOURCE'
  );
  assert.throws(
    () => buildSafeReportQuery({ dataSource: 'payments', measures: ['count'], actorPermissions: ['contacts:read'] }),
    err => err.code === 'FORBIDDEN_REPORT_SOURCE'
  );
  assert.throws(
    () => buildSafeReportQuery({ dataSource: 'opportunities', dimensions: ['status; DROP TABLE payments;--'], measures: ['count'] }),
    err => err.code === 'INVALID_DIMENSION'
  );
});

test('Funnel conversion, PII redaction, CSV formula defense, and Alert cooldown work deterministically', () => {
  const funnel = computeFunnelConversion([
    { name: 'Contacts', count: 100 },
    { name: 'Opportunities', count: 25 },
    { name: 'Won', count: 10 }
  ]);
  assert.equal(funnel[1].stepConversionRate, 0.25);
  assert.equal(funnel[2].overallConversionRate, 0.1);

  const redacted = redactExportRows([{ status: 'won', email: 'vip@acme.com', total: '=CMD()' }], { allowPii: false });
  assert.equal(redacted[0].email, '[REDACTED]');
  const csv = formatSafeCsv(redacted);
  assert.ok(csv.includes("\"'=CMD()\""));

  const now = 1_700_000_000_000;
  assert.equal(evaluateThresholdAlert({ metricValue: 15, operator: 'gt', threshold: 10, now }).triggered, true);
  assert.equal(evaluateThresholdAlert({ metricValue: 15, operator: 'gt', threshold: 10, lastTriggeredAt: new Date(now - 60_000).toISOString(), cooldownMinutes: 60, now }).triggered, false);
});
