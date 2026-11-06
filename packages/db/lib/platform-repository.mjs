import { randomUUID } from 'node:crypto';

function assertTenant(agencyId, locationId) {
  if (typeof agencyId !== 'string' || typeof locationId !== 'string') {
    throw Object.assign(new TypeError('Tenant and location IDs are required'), { code: 'TENANT_CONTEXT_REQUIRED' });
  }
}

function publicProviderRow(row) {
  return {
    id: row.id,
    tenantId: row.agency_id,
    locationId: row.location_id,
    providerKey: row.provider_key,
    channel: row.channel,
    label: row.label,
    config: row.config || {},
    status: row.status,
    verification: row.verification || {},
    verifiedAt: row.verified_at,
    revokedAt: row.revoked_at,
    lastCheckCode: row.last_check_code,
    secretConfigured: Boolean(row.secret_ref),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function consentRow(row) {
  return {
    id: row.id,
    tenantId: row.agency_id,
    locationId: row.location_id,
    contactId: row.contact_id,
    channel: row.channel,
    purpose: row.purpose,
    status: row.status,
    source: row.source,
    proofRef: row.proof_ref,
    capturedAt: row.captured_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at
  };
}

function proposalRow(row) {
  return {
    id: row.id,
    tenantId: row.agency_id,
    locationId: row.location_id,
    requestedByActorId: row.requested_by,
    decidedByActorId: row.decided_by,
    toolName: row.tool_name,
    params: row.params || {},
    risk: row.risk,
    status: row.status,
    requiresHumanApproval: row.requires_human_approval,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    reviewNote: row.review_note
  };
}

/**
 * Normalized, tenant-scoped persistence for platform control-plane records.
 * It uses explicit transaction-local RLS context on every operation.
 */
export function createPlatformRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required');

  async function withTenant(agencyId, locationId, work, { agencyOnly = false } = {}) {
    if (agencyOnly) {
      if (typeof agencyId !== 'string') throw Object.assign(new TypeError('Agency ID is required'), { code: 'TENANT_CONTEXT_REQUIRED' });
    } else {
      assertTenant(agencyId, locationId);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        agencyOnly
          ? "SELECT set_config('app.agency_id',$1,true)"
          : "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
        agencyOnly ? [agencyId] : [agencyId, locationId]
      );
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async checkReady() {
      const requiredTables = [
        'provider_connections', 'communication_consents', 'workflow_approvals',
        'workflow_action_receipts', 'workflow_outbox', 'tenant_entitlements',
        'usage_events', 'copilot_proposals'
      ];
      const [tables, role, rls] = await Promise.all([
        pool.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",
          [requiredTables]
        ),
        pool.query(
          "SELECT r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user"
        ),
        pool.query(
          "SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, " +
            "c.relforcerowsecurity AS rls_forced, count(p.policyname)::integer AS policy_count " +
          "FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
          "LEFT JOIN pg_policies p ON p.schemaname=n.nspname AND p.tablename=c.relname " +
          "WHERE n.nspname='public' AND c.relname=ANY($1::text[]) " +
          "GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity",
          [requiredTables]
        )
      ]);
      const found = new Set(tables.rows.map(row => row.table_name));
      const missing = requiredTables.filter(name => !found.has(name));
      if (missing.length) {
        throw Object.assign(new Error('Platform migrations are missing required tables: ' + missing.join(', ')), {
          code: 'PLATFORM_SCHEMA_INCOMPLETE'
        });
      }
      const rlsByName = new Map(rls.rows.map(row => [row.table_name, row]));
      const unsafeTables = requiredTables.filter(name => {
        const row = rlsByName.get(name);
        return !row || !row.rls_enabled || !row.rls_forced || Number(row.policy_count) < 1;
      });
      if (unsafeTables.length) {
        throw Object.assign(new Error('Platform RLS is not enabled, forced and policy-backed for: ' + unsafeTables.join(', ')), {
          code: 'PLATFORM_RLS_INCOMPLETE'
        });
      }
      const currentRole = role.rows[0];
      if (!currentRole || currentRole.rolsuper || currentRole.rolbypassrls) {
        throw Object.assign(new Error('Platform database runtime role must not be superuser or BYPASSRLS'), {
          code: 'PLATFORM_ROLE_BYPASSES_RLS'
        });
      }
      return { ready: true, tables: requiredTables };
    },

    async createProviderConnection(connection) {
      return withTenant(connection.tenantId, connection.locationId, async client => {
        const result = await client.query(
          "INSERT INTO provider_connections " +
            "(id,agency_id,location_id,provider_key,channel,label,secret_ref,config,status,verification,verified_at,revoked_at,last_check_code) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13) RETURNING *",
          [connection.id || randomUUID(), connection.tenantId, connection.locationId,
            connection.providerKey, connection.channel, connection.label, connection.secretRef,
            JSON.stringify(connection.config || {}), connection.status || 'pending_verification',
            JSON.stringify(connection.verification || {}), connection.verifiedAt || null,
            connection.revokedAt || null, connection.lastCheckCode || null]
        );
        return publicProviderRow(result.rows[0]);
      });
    },

    async listProviderConnections({ tenantId, locationId }) {
      return withTenant(tenantId, locationId, async client => {
        const result = await client.query(
          "SELECT * FROM provider_connections WHERE agency_id=$1 AND location_id=$2 ORDER BY created_at DESC",
          [tenantId, locationId]
        );
        return result.rows.map(publicProviderRow);
      });
    },

    async getProviderConnection({ tenantId, locationId, connectionId }) {
      return withTenant(tenantId, locationId, async client => {
        const result = await client.query(
          "SELECT * FROM provider_connections WHERE agency_id=$1 AND location_id=$2 AND id=$3",
          [tenantId, locationId, connectionId]
        );
        const row = result.rows[0];
        return row ? {
          id: row.id,
          tenantId: row.agency_id,
          locationId: row.location_id,
          providerKey: row.provider_key,
          channel: row.channel,
          label: row.label,
          secretRef: row.secret_ref,
          config: row.config || {},
          status: row.status,
          verification: row.verification || {},
          verifiedAt: row.verified_at,
          revokedAt: row.revoked_at,
          lastCheckCode: row.last_check_code,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        } : null;
      });
    },

    async updateProviderConnection({ tenantId, locationId, connection }) {
      return withTenant(tenantId, locationId, async client => {
        const result = await client.query(
          "UPDATE provider_connections SET status=$4, verification=$5::jsonb, verified_at=$6, revoked_at=$7, " +
            "last_check_code=$8, updated_at=now() WHERE agency_id=$1 AND location_id=$2 AND id=$3 RETURNING *",
          [tenantId, locationId, connection.id, connection.status, JSON.stringify(connection.verification || {}),
            connection.verifiedAt || null, connection.revokedAt || null, connection.lastCheckCode || null]
        );
        return result.rows[0] ? publicProviderRow(result.rows[0]) : null;
      });
    },

    async recordConsent(consent) {
      return withTenant(consent.tenantId, consent.locationId, async client => {
        const result = await client.query(
          "INSERT INTO communication_consents " +
            "(id,agency_id,location_id,contact_id,channel,purpose,status,source,proof_ref,captured_at,expires_at) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [consent.id || randomUUID(), consent.tenantId, consent.locationId, consent.contactId,
            consent.channel, consent.purpose, consent.status, consent.source, consent.proofRef || null,
            consent.capturedAt || new Date().toISOString(), consent.expiresAt || null]
        );
        return consentRow(result.rows[0]);
      });
    },

    async listConsents({ tenantId, locationId, contactId }) {
      if (contactId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(contactId)) {
        throw Object.assign(new TypeError('contactId must be a UUID'), { code: 'INVALID_CONTACT_ID' });
      }
      return withTenant(tenantId, locationId, async client => {
        const result = await client.query(
          "SELECT * FROM communication_consents WHERE agency_id=$1 AND location_id=$2 " +
            "AND ($3::uuid IS NULL OR contact_id=$3) ORDER BY captured_at DESC",
          [tenantId, locationId, contactId || null]
        );
        return result.rows.map(consentRow);
      });
    },

    async createCopilotProposal(proposal) {
      return withTenant(proposal.tenantId, proposal.locationId, async client => {
        const result = await client.query(
          "INSERT INTO copilot_proposals " +
            "(id,agency_id,location_id,requested_by,tool_name,params,risk,status,requires_human_approval) " +
          "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,true) RETURNING *",
          [proposal.id || randomUUID(), proposal.tenantId, proposal.locationId,
            proposal.requestedByActorId, proposal.toolName, JSON.stringify(proposal.params || {}),
            proposal.risk, proposal.status || 'pending_review']
        );
        return proposalRow(result.rows[0]);
      });
    },

    async listCopilotProposals({ tenantId, locationId, status = null }) {
      return withTenant(tenantId, locationId, async client => {
        const result = await client.query(
          "SELECT * FROM copilot_proposals WHERE agency_id=$1 AND location_id=$2 " +
            "AND ($3::text IS NULL OR status=$3) ORDER BY created_at DESC",
          [tenantId, locationId, status]
        );
        return result.rows.map(proposalRow);
      });
    },

    async decideCopilotProposal({ tenantId, locationId, proposalId, actorId, decision, note = null }) {
      if (!['approved', 'rejected'].includes(decision)) throw new TypeError('Proposal decision is invalid');
      return withTenant(tenantId, locationId, async client => {
        const result = await client.query(
          "UPDATE copilot_proposals SET status=$4, decided_by=$5, decided_at=now(), review_note=$6 " +
            "WHERE agency_id=$1 AND location_id=$2 AND id=$3 AND status='pending_review' RETURNING *",
          [tenantId, locationId, proposalId, decision, actorId, typeof note === 'string' ? note.slice(0, 500) : null]
        );
        return result.rows[0] ? proposalRow(result.rows[0]) : null;
      });
    },

    async getEntitlements({ tenantId }) {
      return withTenant(tenantId, null, async client => {
        const result = await client.query(
          "SELECT plan_id,feature_overrides,limit_overrides,status,updated_at FROM tenant_entitlements WHERE agency_id=$1",
          [tenantId]
        );
        return result.rows[0] || null;
      }, { agencyOnly: true });
    },

    async recordUsageEvent(event) {
      return withTenant(event.tenantId, event.locationId, async client => {
        const result = await client.query(
          "INSERT INTO usage_events (id,agency_id,location_id,event_key,metric,quantity,metadata,occurred_at) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (agency_id,event_key) DO NOTHING RETURNING id",
          [randomUUID(), event.tenantId, event.locationId, event.eventId, event.metric,
            event.quantity, JSON.stringify(event.metadata || {}), event.occurredAt]
        );
        return result.rowCount === 1;
      });
    },

    async aggregateUsage({ tenantId, from, to }) {
      return withTenant(tenantId, null, async client => {
        const result = await client.query(
          "SELECT metric, COALESCE(SUM(quantity),0)::bigint AS quantity FROM usage_events " +
            "WHERE agency_id=$1 AND occurred_at >= $2 AND occurred_at < $3 GROUP BY metric",
          [tenantId, from, to]
        );
        return Object.fromEntries(result.rows.map(row => [row.metric, Number(row.quantity)]));
      }, { agencyOnly: true });
    }
  };
}
