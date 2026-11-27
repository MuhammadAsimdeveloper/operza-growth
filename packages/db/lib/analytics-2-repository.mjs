/**
 * ============================================================================
 * Operza Analytics & Business Intelligence 2.0 Repository (TenantTx + FORCE RLS)
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import {
  aggregateFinancialsByCurrency,
  buildSafeReportQuery,
  computeFunnelConversion
} from '../../platform-core/src/analytics-2-0.mjs';

export function createAnalytics2Repository() {
  return {
    async getExecutiveOverview(tx, { from = null, to = null } = {}) {
      const params = [tx.agencyId, tx.locationId];
      let dateClause = '';
      if (from) {
        params.push(new Date(from));
        dateClause += ` AND created_at >= $${params.length}`;
      }
      if (to) {
        params.push(new Date(to));
        dateClause += ` AND created_at < $${params.length}`;
      }

      const contacts = await tx.query(
        `SELECT COUNT(*)::int AS total FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' ${dateClause}`,
        params
      );
      const opps = await tx.query(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(value), 0)::bigint AS total_value
         FROM opportunities WHERE agency_id = $1 AND location_id = $2 ${dateClause} GROUP BY status`,
        params
      );
      const payments = await tx.query(
        `SELECT currency, status, amount_cents FROM payments WHERE agency_id = $1 AND location_id = $2 ${dateClause}`,
        params
      );
      const invoices = await tx.query(
        `SELECT status, currency, COUNT(*)::int AS count, COALESCE(SUM(amount_cents), 0)::bigint AS total_cents
         FROM invoices WHERE agency_id = $1 AND location_id = $2 ${dateClause} GROUP BY status, currency`,
        params
      );
      const appts = await tx.query(
        `SELECT status, COUNT(*)::int AS count FROM appointments WHERE agency_id = $1 AND location_id = $2 ${dateClause} GROUP BY status`,
        params
      );
      const workflows = await tx.query(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(attempts), 0)::int AS total_attempts
         FROM workflow_executions WHERE agency_id = $1 AND location_id = $2 ${dateClause} GROUP BY status`,
        params
      );
      const integrations = await tx.query(
        `SELECT status, COUNT(*)::int AS count FROM integration_connections WHERE agency_id = $1 AND location_id = $2 GROUP BY status`,
        [tx.agencyId, tx.locationId]
      );
      const aiUsage = await tx.query(
        `SELECT COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                COALESCE(SUM(estimated_cost_microcents), 0)::bigint AS estimated_cost_microcents,
                COALESCE(SUM(actual_provider_cost_microcents), 0)::bigint AS confirmed_cost_microcents
         FROM ai_usage_events WHERE agency_id = $1 AND location_id = $2 ${dateClause}`,
        params
      );
      const marketplace = await tx.query(
        `SELECT status, COUNT(*)::int AS count FROM marketplace_installations WHERE agency_id = $1 AND location_id = $2 GROUP BY status`,
        [tx.agencyId, tx.locationId]
      );
      const subs = await tx.query(
        `SELECT plan_id, status, COUNT(*)::int AS count FROM saas_subscriptions WHERE agency_id = $1 AND location_id = $2 GROUP BY plan_id, status`,
        [tx.agencyId, tx.locationId]
      );

      const oppCounts = Object.fromEntries(opps.rows.map(r => [r.status, r.count]));
      const totalContacts = contacts.rows[0]?.total || 0;
      const totalOpps = opps.rows.reduce((s, r) => s + r.count, 0);
      const wonOpps = oppCounts.won || 0;

      return {
        generatedAt: new Date().toISOString(),
        freshness: 'real_time_source_query',
        crm: { totalContacts },
        sales: {
          byStatus: opps.rows,
          totalOpportunities: totalOpps,
          wonOpportunities: wonOpps
        },
        funnel: computeFunnelConversion([
          { name: 'Contacts', count: totalContacts },
          { name: 'Opportunities', count: totalOpps },
          { name: 'Won', count: wonOpps }
        ]),
        financialByCurrency: aggregateFinancialsByCurrency(payments.rows),
        invoicesByStatusAndCurrency: invoices.rows,
        schedulingByStatus: appts.rows,
        workflowsByStatus: workflows.rows,
        integrationsByStatus: integrations.rows,
        aiUsage: aiUsage.rows[0] || { input_tokens: 0, output_tokens: 0, estimated_cost_microcents: 0, confirmed_cost_microcents: 0 },
        marketplaceInstallations: marketplace.rows,
        subscriptions: subs.rows
      };
    },

    async runCustomReport(tx, querySpec) {
      const built = buildSafeReportQuery(querySpec);
      const res = await tx.query(built.sql, [tx.agencyId, tx.locationId, ...built.extraParams]);
      return { rows: res.rows, table: built.table, limit: built.limit, offset: built.offset };
    },

    async createSavedDashboard(tx, { ownerUserId, visibility = 'agency', title, description = '', widgetsJson = [] }) {
      const res = await tx.query(
        `INSERT INTO analytics_saved_dashboards (
          id, agency_id, location_id, owner_user_id, visibility, title, description, widgets_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, String(ownerUserId), visibility, title, description, JSON.stringify(widgetsJson)]
      );
      return res.rows[0];
    },

    async listSavedDashboards(tx, { userId }) {
      const res = await tx.query(
        `SELECT * FROM analytics_saved_dashboards
         WHERE agency_id = $1 AND location_id = $2 AND archived_at IS NULL
           AND (visibility = 'agency' OR owner_user_id = $3)
         ORDER BY updated_at DESC`,
        [tx.agencyId, tx.locationId, String(userId)]
      );
      return res.rows;
    },

    async createSavedReport(tx, {
      ownerUserId,
      visibility = 'agency',
      title,
      dataSource,
      dimensions = [],
      measures = ['count'],
      filters = [],
      chartType = 'table',
      dateRangeDays = 30
    }) {
      // Validate via buildSafeReportQuery before saving
      buildSafeReportQuery({ dataSource, dimensions, measures, filters });
      const res = await tx.query(
        `INSERT INTO analytics_saved_reports (
          id, agency_id, location_id, owner_user_id, visibility, title, data_source,
          dimensions, measures, filters, chart_type, date_range_days
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
        RETURNING *`,
        [
          randomUUID(), tx.agencyId, tx.locationId, String(ownerUserId), visibility, title,
          dataSource, JSON.stringify(dimensions), JSON.stringify(measures), JSON.stringify(filters),
          chartType, dateRangeDays
        ]
      );
      return res.rows[0];
    },

    async listSavedReports(tx, { userId }) {
      const res = await tx.query(
        `SELECT * FROM analytics_saved_reports
         WHERE agency_id = $1 AND location_id = $2
           AND (visibility = 'agency' OR owner_user_id = $3)
         ORDER BY updated_at DESC`,
        [tx.agencyId, tx.locationId, String(userId)]
      );
      return res.rows;
    },

    async createScheduledReport(tx, { reportId, frequency = 'weekly', timezone = 'UTC', recipients = [] }) {
      const res = await tx.query(
        `INSERT INTO analytics_scheduled_reports (
          id, agency_id, location_id, report_id, frequency, timezone, recipients, status, next_run_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'active', now() + interval '1 day')
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, reportId, frequency, timezone, JSON.stringify(recipients)]
      );
      return res.rows[0];
    },

    async createThresholdAlert(tx, { metricId, operator = 'gt', thresholdValue, windowMinutes = 60, cooldownMinutes = 60, severity = 'warning' }) {
      const res = await tx.query(
        `INSERT INTO analytics_threshold_alerts (
          id, agency_id, location_id, metric_id, operator, threshold_value, window_minutes, cooldown_minutes, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, metricId, operator, thresholdValue, windowMinutes, cooldownMinutes, severity]
      );
      return res.rows[0];
    },

    async recordAnalyticsEvent(tx, { eventType, sourceModule, sourceRecordId = null, deduplicationKey, metadata = {} }) {
      const res = await tx.query(
        `INSERT INTO analytics_events (
          id, agency_id, location_id, event_type, source_module, source_record_id, deduplication_key, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        ON CONFLICT (agency_id, location_id, source_module, deduplication_key) DO NOTHING
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, eventType, sourceModule, sourceRecordId, deduplicationKey, JSON.stringify(metadata)]
      );
      return { deduplicated: res.rows.length === 0, event: res.rows[0] || null };
    }
  };
}
