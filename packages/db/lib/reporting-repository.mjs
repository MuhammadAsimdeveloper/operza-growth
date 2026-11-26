/**
 * Phase 7 — Consolidated Tenant-Scoped SQL Reporting Repository (TenantTx)
 * Computes aggregates directly in PostgreSQL without loading cross-tenant
 * financial data into application memory and groups revenue by currency.
 */

export function createReportingRepository() {
  return {
    async getWorkspaceSummary(tx, { from = null, to = null } = {}) {
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

      const contactsRes = await tx.query(
        `SELECT COUNT(*)::int AS total FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' ${dateClause}`,
        params
      );
      const oppsRes = await tx.query(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(value), 0)::bigint AS total_value
         FROM opportunities WHERE agency_id = $1 AND location_id = $2 ${dateClause}
         GROUP BY status`,
        params
      );
      const apptsRes = await tx.query(
        `SELECT status, COUNT(*)::int AS count
         FROM appointments WHERE agency_id = $1 AND location_id = $2 ${dateClause}
         GROUP BY status`,
        params
      );
      const paymentsRes = await tx.query(
        `SELECT currency, status, COUNT(*)::int AS count, COALESCE(SUM(amount_cents), 0)::bigint AS amount_cents
         FROM payments WHERE agency_id = $1 AND location_id = $2 ${dateClause}
         GROUP BY currency, status`,
        params
      );

      return {
        agencyId: tx.agencyId,
        locationId: tx.locationId,
        contactsCount: Number(contactsRes.rows[0]?.total || 0),
        opportunitiesByStatus: oppsRes.rows,
        appointmentsByStatus: apptsRes.rows,
        paymentsByCurrencyAndStatus: paymentsRes.rows
      };
    }
  };
}
