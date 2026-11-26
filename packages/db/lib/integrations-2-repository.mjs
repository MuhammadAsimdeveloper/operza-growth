/**
 * ============================================================================
 * Operza Integrations Hub 2.0 Repository — TenantTx & FORCE RLS Boundary
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { createNormalizedEventEnvelope } from '../../platform-core/src/webhook-platform-v2.mjs';

function parseJson(v, fallback) {
  if (v == null) return fallback;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

export function normalizeConnectionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    connectorId: row.connector_id,
    provider: row.provider,
    accountLabel: row.account_label || '',
    externalAccountId: row.external_account_id || null,
    authStrategy: row.auth_strategy,
    status: row.status,
    readinessLevel: row.readiness_level,
    hasSecretRef: Boolean(row.vault_secret_ref),
    grantedScopes: parseJson(row.granted_scopes, []),
    config: parseJson(row.config_json, {}),
    tokenExpiresAt: row.token_expires_at?.toISOString?.() || row.token_expires_at || null,
    lastTestedAt: row.last_tested_at?.toISOString?.() || row.last_tested_at || null,
    lastErrorCode: row.last_error_code || null,
    circuitState: row.circuit_state || 'closed',
    failureCount: Number(row.failure_count) || 0,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    revokedAt: row.revoked_at?.toISOString?.() || row.revoked_at || null
  };
}

export function createIntegrations2Repository() {
  return {
    async createConnection(tx, {
      connectorId,
      provider,
      accountLabel = '',
      externalAccountId = null,
      authStrategy = 'api_key',
      status = 'pending',
      readinessLevel = 'implemented_adapter',
      vaultSecretRef = null,
      grantedScopes = [],
      config = {},
      tokenExpiresAt = null,
      createdBy = null
    }) {
      const id = randomUUID();
      const res = await tx.query(
        `INSERT INTO integration_connections (
          id, agency_id, location_id, connector_id, provider, account_label,
          external_account_id, auth_strategy, status, readiness_level, vault_secret_ref,
          granted_scopes, config_json, token_expires_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15)
        RETURNING *`,
        [
          id, tx.agencyId, tx.locationId, connectorId, provider || connectorId, accountLabel,
          externalAccountId, authStrategy, status, readinessLevel, vaultSecretRef,
          JSON.stringify(grantedScopes), JSON.stringify(config),
          tokenExpiresAt ? new Date(tokenExpiresAt) : null, createdBy
        ]
      );
      return normalizeConnectionRow(res.rows[0]);
    },

    async listConnections(tx, { connectorId = null } = {}) {
      const sql = connectorId
        ? `SELECT * FROM integration_connections WHERE agency_id = $1 AND location_id = $2 AND connector_id = $3 ORDER BY created_at DESC`
        : `SELECT * FROM integration_connections WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`;
      const params = connectorId ? [tx.agencyId, tx.locationId, connectorId] : [tx.agencyId, tx.locationId];
      const res = await tx.query(sql, params);
      return res.rows.map(normalizeConnectionRow);
    },

    async getConnection(tx, connectionId) {
      const res = await tx.query(
        `SELECT * FROM integration_connections WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, connectionId]
      );
      return res.rows[0] ? normalizeConnectionRow(res.rows[0]) : null;
    },

    async updateConnectionStatus(tx, connectionId, { status, lastErrorCode = null, lastTestedAt = null }) {
      const res = await tx.query(
        `UPDATE integration_connections
         SET status = $1,
             last_error_code = $2,
             last_tested_at = COALESCE($3, last_tested_at),
             revoked_at = CASE WHEN $1 IN ('revoked', 'disconnected') THEN now() ELSE revoked_at END,
             updated_at = now()
         WHERE agency_id = $4 AND location_id = $5 AND id = $6
         RETURNING *`,
        [status, lastErrorCode, lastTestedAt ? new Date(lastTestedAt) : null, tx.agencyId, tx.locationId, connectionId]
      );
      return res.rows[0] ? normalizeConnectionRow(res.rows[0]) : null;
    },

    async recordWebhookEvent(tx, {
      connectionId = null,
      provider,
      providerEventId,
      eventType,
      direction = 'inbound',
      payload = {},
      occurredAt = new Date().toISOString()
    }) {
      const env = createNormalizedEventEnvelope({
        provider,
        connectionId,
        agencyId: tx.agencyId,
        locationId: tx.locationId,
        providerEventId,
        eventType,
        payload,
        occurredAt
      });
      const res = await tx.query(
        `INSERT INTO integration_webhook_events (
          id, agency_id, location_id, connection_id, provider, provider_event_id,
          event_type, direction, schema_version, normalized_payload, processing_state,
          correlation_id, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9::jsonb, 'normalized', $10, $11)
        ON CONFLICT (agency_id, location_id, provider, provider_event_id) DO NOTHING
        RETURNING *`,
        [
          env.eventId, tx.agencyId, tx.locationId, connectionId, provider,
          env.providerEventId, eventType, direction, JSON.stringify(payload),
          env.correlationId, new Date(occurredAt)
        ]
      );
      if (res.rows.length === 0) {
        return { deduplicated: true, providerEventId: env.providerEventId };
      }
      return { deduplicated: false, event: res.rows[0] };
    },

    async listWebhookEvents(tx, { limit = 50 } = {}) {
      const res = await tx.query(
        `SELECT id, connection_id, provider, provider_event_id, event_type, direction, processing_state, attempts, last_error_code, correlation_id, occurred_at, received_at
         FROM integration_webhook_events
         WHERE agency_id = $1 AND location_id = $2
         ORDER BY received_at DESC LIMIT $3`,
        [tx.agencyId, tx.locationId, Math.min(200, Math.max(1, Number(limit) || 50))]
      );
      return res.rows;
    },

    async createSyncJob(tx, {
      connectionId,
      entityType = 'contacts',
      direction = 'two_way',
      syncMode = 'incremental',
      conflictPolicy = 'source_priority',
      fieldMappings = {}
    }) {
      const id = randomUUID();
      const res = await tx.query(
        `INSERT INTO integration_sync_jobs (
          id, agency_id, location_id, connection_id, entity_type, direction,
          sync_mode, conflict_policy, field_mappings, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'idle')
        RETURNING *`,
        [id, tx.agencyId, tx.locationId, connectionId, entityType, direction, syncMode, conflictPolicy, JSON.stringify(fieldMappings)]
      );
      return res.rows[0];
    },

    async listSyncJobs(tx) {
      const res = await tx.query(
        `SELECT * FROM integration_sync_jobs WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async createSyncConflict(tx, { syncJobId, localRecordId, externalRecordId, localPayload = {}, externalPayload = {} }) {
      const res = await tx.query(
        `INSERT INTO integration_sync_conflicts (
          id, agency_id, location_id, sync_job_id, local_record_id, external_record_id,
          local_payload, external_payload, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, 'open')
        RETURNING *`,
        [randomUUID(), tx.agencyId, tx.locationId, syncJobId, String(localRecordId), String(externalRecordId), JSON.stringify(localPayload), JSON.stringify(externalPayload)]
      );
      return res.rows[0];
    },

    async listSyncConflicts(tx, { status = 'open' } = {}) {
      const res = await tx.query(
        `SELECT * FROM integration_sync_conflicts WHERE agency_id = $1 AND location_id = $2 AND status = $3 ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId, status]
      );
      return res.rows;
    },

    async getIntegrationMetrics(tx) {
      const conn = await tx.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*) FILTER (WHERE status IN ('expired', 'error'))::int AS degraded
         FROM integration_connections WHERE agency_id = $1 AND location_id = $2`,
        [tx.agencyId, tx.locationId]
      );
      const ev = await tx.query(
        `SELECT COUNT(*)::int AS total_events, COUNT(*) FILTER (WHERE processing_state = 'dead_letter')::int AS dead_letter_count
         FROM integration_webhook_events WHERE agency_id = $1 AND location_id = $2`,
        [tx.agencyId, tx.locationId]
      );
      const conf = await tx.query(
        `SELECT COUNT(*)::int AS open_conflicts FROM integration_sync_conflicts WHERE agency_id = $1 AND location_id = $2 AND status = 'open'`,
        [tx.agencyId, tx.locationId]
      );
      return {
        connections: conn.rows[0],
        webhookEvents: ev.rows[0],
        openSyncConflicts: conf.rows[0]?.open_conflicts || 0
      };
    }
  };
}
