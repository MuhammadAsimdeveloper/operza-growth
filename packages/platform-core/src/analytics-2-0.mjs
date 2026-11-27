/**
 * ============================================================================
 * Operza Analytics & Business Intelligence 2.0 Core Engine
 * ============================================================================
 * Provides the authoritative Metric Catalog, currency-separated minor-unit
 * financial aggregation, allowlisted safe SQL report builder, funnel math,
 * threshold alert evaluation, and PII-redacted CSV export formatting.
 */

export const METRIC_CATALOG_V2 = Object.freeze([
  { id: 'crm.contacts.total', name: 'Total Contacts', category: 'crm', sourceTable: 'location_records', aggregation: 'count', dateField: 'created_at', currencyMode: 'none', permissions: ['contacts:read'], freshness: 'real_time' },
  { id: 'sales.opportunities.total', name: 'Total Opportunities', category: 'sales', sourceTable: 'opportunities', aggregation: 'count', dateField: 'created_at', currencyMode: 'none', permissions: ['opportunities:read'], freshness: 'real_time' },
  { id: 'sales.opportunities.win_rate', name: 'Opportunity Win Rate', category: 'sales', sourceTable: 'opportunities', aggregation: 'ratio(won/(won+lost))', dateField: 'updated_at', currencyMode: 'none', permissions: ['opportunities:read'], freshness: 'real_time' },
  { id: 'financial.payments.net_collected', name: 'Net Collected Payments', category: 'financial', sourceTable: 'payments', aggregation: 'sum(succeeded)-sum(refunded)', dateField: 'created_at', currencyMode: 'separate_by_currency', permissions: ['commerce:read'], freshness: 'real_time' },
  { id: 'financial.invoices.overdue', name: 'Overdue Invoices', category: 'financial', sourceTable: 'invoices', aggregation: 'count(overdue)', dateField: 'due_date', currencyMode: 'separate_by_currency', permissions: ['commerce:read'], freshness: 'real_time' },
  { id: 'scheduling.appointments.no_show_rate', name: 'Appointment No-Show Rate', category: 'scheduling', sourceTable: 'appointments', aggregation: 'ratio(no_show/total)', dateField: 'starts_at', currencyMode: 'none', permissions: ['scheduling:read'], freshness: 'real_time' },
  { id: 'communication.messages.delivered', name: 'Delivered Messages', category: 'communication', sourceTable: 'messages', aggregation: 'count(delivered)', dateField: 'created_at', currencyMode: 'none', permissions: ['conversations:read'], freshness: 'real_time' },
  { id: 'workflow.executions.success_rate', name: 'Workflow Success Rate', category: 'workflow', sourceTable: 'workflow_executions', aggregation: 'ratio(completed/total)', dateField: 'created_at', currencyMode: 'none', permissions: ['workflows:read'], freshness: 'real_time' },
  { id: 'integration.webhooks.unique_events', name: 'Unique Webhook Events', category: 'integration', sourceTable: 'integration_webhook_events', aggregation: 'count_distinct(provider_event_id)', dateField: 'received_at', currencyMode: 'none', permissions: ['integrations:read'], freshness: 'real_time' },
  { id: 'ai.usage.estimated_cost', name: 'AI Estimated Cost', category: 'ai', sourceTable: 'ai_usage_events', aggregation: 'sum(estimated_cost_microcents)', dateField: 'created_at', currencyMode: 'microcents_usd_estimated', permissions: ['ai:read'], freshness: 'real_time' },
  { id: 'marketplace.installations.active', name: 'Active Marketplace Installations', category: 'marketplace', sourceTable: 'marketplace_installations', aggregation: 'count(active)', dateField: 'installed_at', currencyMode: 'none', permissions: ['marketplace:read'], freshness: 'real_time' },
  { id: 'saas.subscriptions.active', name: 'Active SaaS Subscriptions', category: 'saas', sourceTable: 'saas_subscriptions', aggregation: 'count(active)', dateField: 'created_at', currencyMode: 'none', permissions: ['billing:read'], freshness: 'real_time' }
]);

export function aggregateFinancialsByCurrency(payments = []) {
  const byCurrency = new Map();
  for (const p of payments) {
    const cur = String(p.currency || 'usd').toLowerCase();
    if (!byCurrency.has(cur)) {
      byCurrency.set(cur, {
        currency: cur,
        grossCollectedCents: 0,
        refundedCents: 0,
        netCollectedCents: 0,
        failedAttemptCents: 0,
        succeededCount: 0,
        refundedCount: 0,
        failedCount: 0
      });
    }
    const bucket = byCurrency.get(cur);
    const cents = Math.trunc(Number(p.amount_cents ?? p.amountCents) || 0);
    const status = String(p.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'paid' || status === 'captured') {
      bucket.grossCollectedCents += cents;
      bucket.succeededCount += 1;
    } else if (status === 'refunded') {
      bucket.refundedCents += cents;
      bucket.refundedCount += 1;
    } else if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
      bucket.failedAttemptCents += cents;
      bucket.failedCount += 1;
    }
    bucket.netCollectedCents = bucket.grossCollectedCents - bucket.refundedCents;
  }
  return [...byCurrency.values()];
}

const REPORT_SOURCE_ALLOWLIST = Object.freeze({
  opportunities: {
    table: 'opportunities',
    dimensions: new Set(['status', 'stage_id', 'source', 'assigned_to']),
    measures: new Set(['count', 'sum:value', 'avg:value']),
    requiredPermission: 'opportunities:read'
  },
  appointments: {
    table: 'appointments',
    dimensions: new Set(['status', 'calendar_id']),
    measures: new Set(['count']),
    requiredPermission: 'scheduling:read'
  },
  payments: {
    table: 'payments',
    dimensions: new Set(['currency', 'status']),
    measures: new Set(['count', 'sum:amount_cents', 'avg:amount_cents']),
    requiredPermission: 'commerce:read'
  },
  workflow_executions: {
    table: 'workflow_executions',
    dimensions: new Set(['status', 'workflow_id']),
    measures: new Set(['count', 'sum:attempts']),
    requiredPermission: 'workflows:read'
  },
  ai_runs: {
    table: 'ai_runs',
    dimensions: new Set(['provider', 'model', 'status']),
    measures: new Set(['count', 'sum:input_tokens', 'sum:output_tokens', 'sum:estimated_cost_microcents']),
    requiredPermission: 'ai:read'
  }
});

const FILTER_OPS = new Map([
  ['eq', '='],
  ['neq', '!='],
  ['gte', '>='],
  ['lte', '<=']
]);

export function buildSafeReportQuery({
  dataSource,
  dimensions = [],
  measures = ['count'],
  filters = [],
  limit = 100,
  offset = 0,
  actorPermissions = ['*']
} = {}) {
  const spec = REPORT_SOURCE_ALLOWLIST[dataSource];
  if (!spec) {
    throw Object.assign(new TypeError(`Unsupported dataSource: ${dataSource}`), { code: 'INVALID_DATA_SOURCE' });
  }
  if (!actorPermissions.includes('*') && !actorPermissions.includes(spec.requiredPermission)) {
    throw Object.assign(new Error(`Missing permission ${spec.requiredPermission}`), { code: 'FORBIDDEN_REPORT_SOURCE' });
  }

  const cleanDims = dimensions.filter(d => spec.dimensions.has(d));
  if (cleanDims.length !== dimensions.length) {
    throw Object.assign(new TypeError('Requested dimension is not allowlisted'), { code: 'INVALID_DIMENSION' });
  }
  const cleanMeasures = measures.filter(m => spec.measures.has(m));
  if (cleanMeasures.length === 0 || cleanMeasures.length !== measures.length) {
    throw Object.assign(new TypeError('Requested measure is not allowlisted'), { code: 'INVALID_MEASURE' });
  }

  const selectCols = [...cleanDims];
  for (const m of cleanMeasures) {
    if (m === 'count') {
      selectCols.push('COUNT(*)::int AS count');
    } else {
      const [fn, col] = m.split(':');
      const sqlFn = fn === 'sum' ? 'COALESCE(SUM(' + col + '), 0)::bigint' : 'COALESCE(AVG(' + col + '), 0)::float8';
      selectCols.push(`${sqlFn} AS ${fn}_${col}`);
    }
  }

  const params = [];
  const whereClauses = ['agency_id = $1', 'location_id = $2'];
  // $1 and $2 reserved for TenantTx agencyId/locationId
  let paramIdx = 2;

  for (const f of filters) {
    if (!spec.dimensions.has(f.field)) {
      throw Object.assign(new TypeError(`Filter field not allowlisted: ${f.field}`), { code: 'INVALID_FILTER_FIELD' });
    }
    const op = FILTER_OPS.get(f.operator);
    if (!op) {
      throw Object.assign(new TypeError(`Unsupported filter operator: ${f.operator}`), { code: 'INVALID_FILTER_OP' });
    }
    paramIdx += 1;
    params.push(f.value);
    whereClauses.push(`${f.field} ${op} $${paramIdx}`);
  }

  const boundedLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const boundedOffset = Math.max(0, Number(offset) || 0);
  const groupBy = cleanDims.length > 0 ? ` GROUP BY ${cleanDims.join(', ')}` : '';
  const sql = `SELECT ${selectCols.join(', ')} FROM ${spec.table} WHERE ${whereClauses.join(' AND ')}${groupBy} LIMIT ${boundedLimit} OFFSET ${boundedOffset}`;

  return { sql, extraParams: params, table: spec.table, limit: boundedLimit, offset: boundedOffset };
}

export function computeFunnelConversion(stages = []) {
  if (!Array.isArray(stages) || stages.length === 0) return [];
  const firstCount = Math.max(0, Number(stages[0]?.count) || 0);
  return stages.map((st, idx) => {
    const count = Math.max(0, Number(st.count) || 0);
    const prevCount = idx === 0 ? count : Math.max(0, Number(stages[idx - 1]?.count) || 0);
    return {
      name: st.name,
      count,
      stepConversionRate: prevCount > 0 ? Number((count / prevCount).toFixed(4)) : 0,
      overallConversionRate: firstCount > 0 ? Number((count / firstCount).toFixed(4)) : 0
    };
  });
}

const PII_KEYS = /(email|phone|ssn|password|secret|token|address)/i;

export function redactExportRows(rows = [], { allowPii = false } = {}) {
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row || {})) {
      out[k] = !allowPii && PII_KEYS.test(k) ? '[REDACTED]' : v;
    }
    return out;
  });
}

export function formatSafeCsv(rows = []) {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const esc = (val) => {
    let s = val == null ? '' : String(val);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [headers.map(esc).join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

export function evaluateThresholdAlert({
  metricValue,
  operator,
  threshold,
  lastTriggeredAt = null,
  cooldownMinutes = 60,
  now = Date.now()
}) {
  const val = Number(metricValue);
  const thr = Number(threshold);
  let breached = false;
  if (operator === 'gt') breached = val > thr;
  else if (operator === 'gte') breached = val >= thr;
  else if (operator === 'lt') breached = val < thr;
  else if (operator === 'lte') breached = val <= thr;

  if (!breached) return { triggered: false, reason: 'threshold_not_breached' };
  if (lastTriggeredAt) {
    const elapsedMs = now - new Date(lastTriggeredAt).getTime();
    if (elapsedMs < cooldownMinutes * 60_000) {
      return { triggered: false, reason: 'cooldown_active' };
    }
  }
  return { triggered: true, reason: 'threshold_breached' };
}
