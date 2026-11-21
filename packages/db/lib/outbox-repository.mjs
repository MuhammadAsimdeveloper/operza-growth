import { randomUUID } from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const EVENT = /^[a-z][a-z0-9_.-]{1,120}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,180}$/;
const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)/i;

function assertRef(value, label) {
  if (typeof value !== 'string' || !REF.test(value)) {
    throw Object.assign(new TypeError(label + ' is invalid'), { code: 'INVALID_REFERENCE' });
  }
}

function validatePayload(value, depth = 0) {
  if (depth > 8) throw Object.assign(new TypeError('Outbox payload is too deeply nested'), { code: 'OUTBOX_PAYLOAD_INVALID' });
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    if (value.length > 20_000) throw Object.assign(new TypeError('Outbox string exceeds limit'), { code: 'OUTBOX_PAYLOAD_TOO_LARGE' });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw Object.assign(new TypeError('Outbox array exceeds limit'), { code: 'OUTBOX_PAYLOAD_TOO_LARGE' });
    for (const item of value) validatePayload(item, depth + 1);
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw Object.assign(new TypeError('Outbox payload must be plain JSON'), { code: 'OUTBOX_PAYLOAD_INVALID' });
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw Object.assign(new TypeError('Outbox payload must not contain credentials'), { code: 'OUTBOX_CREDENTIAL_FIELD' });
    validatePayload(child, depth + 1);
  }
}

function ensureRow(result, code = 'OUTBOX_LEASE_LOST') {
  if (!result.rowCount) throw Object.assign(new Error('Outbox lease is no longer owned by this worker'), { code });
  return result.rows[0];
}

/**
 * PostgreSQL-backed outbox adapter.
 * API writes use tenant-scoped enqueue. Worker operations require a separately
 * provisioned operza_worker database role and its dedicated RLS policy.
 */
export function createWorkflowOutboxRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('A PostgreSQL pool is required');

  async function withClient(work) {
    const client = await pool.connect();
    try { return await work(client); }
    finally { client.release(); }
  }

  return {
    async enqueue(input, options = {}) {
      assertRef(input?.tenantId, 'tenantId');
      assertRef(input?.locationId, 'locationId');
      if (input.executionId != null) assertRef(input.executionId, 'executionId');
      if (!EVENT.test(input?.eventType || '')) throw Object.assign(new TypeError('eventType is invalid'), { code: 'INVALID_EVENT_TYPE' });
      if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
        throw Object.assign(new TypeError('A bounded idempotencyKey is required'), { code: 'INVALID_IDEMPOTENCY_KEY' });
      }
      const payload = input.payload ?? {};
      validatePayload(payload);
      if (Buffer.byteLength(JSON.stringify(payload)) > 65_536) {
        throw Object.assign(new TypeError('Outbox payload exceeds 64 KB'), { code: 'OUTBOX_PAYLOAD_TOO_LARGE' });
      }
      const id = input.id || randomUUID();
      const priority = Number.isInteger(input.priority) ? Math.max(-10, Math.min(10, input.priority)) : 0;
      const maxAttempts = Number.isInteger(input.maxAttempts) ? Math.max(1, Math.min(25, input.maxAttempts)) : 5;
      const availableAt = input.availableAt ? new Date(input.availableAt).toISOString() : null;

      const executeEnqueue = async (client, isManagedTx) => {
        if (!isManagedTx) await client.query('BEGIN');
        try {
          await client.query(
            "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
            [input.tenantId, input.locationId]
          );
          const inserted = await client.query(
            "INSERT INTO workflow_outbox " +
            "(id, agency_id, location_id, execution_id, event_type, payload, idempotency_key, priority, max_attempts, available_at) " +
            "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9, COALESCE($10::timestamptz, now())) " +
            "ON CONFLICT (agency_id, location_id, idempotency_key) DO NOTHING " +
            "RETURNING id, event_type, status, attempts, created_at, available_at",
            [id, input.tenantId, input.locationId, input.executionId || null, input.eventType,
              JSON.stringify(payload), input.idempotencyKey, priority, maxAttempts, availableAt]
          );
          let row = inserted.rows[0];
          let deduplicated = false;
          if (!row) {
            const existing = await client.query(
              "SELECT id, event_type, status, attempts, created_at, available_at FROM workflow_outbox " +
              "WHERE agency_id=$1 AND location_id=$2 AND idempotency_key=$3",
              [input.tenantId, input.locationId, input.idempotencyKey]
            );
            row = existing.rows[0];
            deduplicated = true;
          }
          if (!isManagedTx) await client.query('COMMIT');
          return { ...row, deduplicated };
        } catch (error) {
          if (!isManagedTx) await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      };

      if (options?.client) {
        return executeEnqueue(options.client, true);
      }
      return withClient(client => executeEnqueue(client, false));
    },

    async claim({ workerId, limit = 10, leaseMs = 30_000 } = {}) {
      if (typeof workerId !== 'string' || !REF.test(workerId)) throw new TypeError('workerId is invalid');
      const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
      const boundedLeaseMs = Math.max(1_000, Math.min(300_000, Math.floor(leaseMs)));
      return withClient(async client => {
        await client.query('BEGIN');
        try {
          const result = await client.query(
            "WITH eligible AS (" +
              "SELECT agency_id, location_id, id FROM workflow_outbox " +
              "WHERE (status='pending' AND available_at <= now()) " +
              "OR (status='leased' AND lease_until < now()) " +
              "ORDER BY priority DESC, available_at ASC, created_at ASC LIMIT $2 " +
              "FOR UPDATE SKIP LOCKED" +
            ") " +
            "UPDATE workflow_outbox AS jobs " +
            "SET status='leased', lease_owner=$1, lease_until=now() + ($3 * interval '1 millisecond'), " +
                "attempts=jobs.attempts + 1, updated_at=now() " +
            "FROM eligible " +
            "WHERE jobs.agency_id=eligible.agency_id AND jobs.location_id=eligible.location_id AND jobs.id=eligible.id " +
            "RETURNING jobs.id, jobs.agency_id AS \"agencyId\", jobs.location_id AS \"locationId\", jobs.execution_id AS \"executionId\", " +
            "jobs.event_type AS \"eventType\", jobs.event_type, jobs.payload, " +
            "jobs.attempts, jobs.max_attempts AS \"maxAttempts\", jobs.lease_until AS \"leaseUntil\", jobs.idempotency_key AS \"idempotencyKey\", " +
            "jobs.available_at AS \"availableAt\"",
            [workerId, boundedLimit, boundedLeaseMs]
          );
          await client.query('COMMIT');
          return result.rows;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    },

    async renewLease({ jobId, workerId, leaseMs = 30_000 } = {}) {
      const boundedLeaseMs = Math.max(1_000, Math.min(300_000, Math.floor(leaseMs)));
      return withClient(async client => {
        const updated = await client.query(
          "UPDATE workflow_outbox SET lease_until=now() + ($3 * interval '1 millisecond'), updated_at=now() " +
          "WHERE id=$1 AND lease_owner=$2 AND status='leased' AND lease_until > now() RETURNING id",
          [jobId, workerId, boundedLeaseMs]
        );
        return updated.rowCount === 1;
      });
    },

    async acknowledge({ jobId, workerId, result = {} } = {}) {
      const safeResult = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      validatePayload(safeResult);
      if (Buffer.byteLength(JSON.stringify(safeResult)) > 8_192) throw new TypeError('Outbox result exceeds 8 KB');
      return withClient(async client => {
        const updated = await client.query(
          "UPDATE workflow_outbox SET status='delivered', delivered_at=now(), " +
            "lease_owner=NULL, lease_until=NULL, result=$3::jsonb, updated_at=now() " +
          "WHERE id=$1 AND lease_owner=$2 AND status='leased' " +
          "RETURNING id, status, delivered_at",
          [jobId, workerId, JSON.stringify(safeResult)]
        );
        return ensureRow(updated);
      });
    },

    async fail({ jobId, workerId, errorCode = 'JOB_FAILED', retryable = true, retryDelayMs = 1_000 } = {}) {
      const safeCode = String(errorCode).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80) || 'JOB_FAILED';
      const delay = Math.max(0, Math.min(86_400_000, Math.floor(Number(retryDelayMs) || 0)));
      return withClient(async client => {
        const updated = await client.query(
          "UPDATE workflow_outbox " +
          "SET status=CASE WHEN $3::boolean=false OR attempts >= max_attempts THEN 'dead_letter' ELSE 'pending' END, " +
              "available_at=CASE WHEN $3::boolean=true AND attempts < max_attempts " +
                "THEN now() + ($4 * interval '1 millisecond') ELSE available_at END, " +
              "last_error_code=$5, lease_owner=NULL, lease_until=NULL, updated_at=now() " +
          "WHERE id=$1 AND lease_owner=$2 AND status='leased' " +
          "RETURNING id, status, attempts, max_attempts, available_at",
          [jobId, workerId, Boolean(retryable), delay, safeCode]
        );
        return ensureRow(updated);
      });
    },

    async claimActionReceipt({ client: providedClient, tenantId, locationId, executionId, nodeId, actionHash, providerKey = null, workerId = null, leaseSeconds = 30 } = {}) {
      assertRef(tenantId, 'tenantId');
      assertRef(locationId, 'locationId');
      assertRef(executionId, 'executionId');
      assertRef(nodeId, 'nodeId');
      if (!HASH.test(actionHash || '')) throw new TypeError('actionHash must be a SHA-256 digest');

      const execute = async (client) => {
        await client.query(
          "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
          [tenantId, locationId]
        );
        const leaseSecs = Math.max(1, Math.min(3600, Number(leaseSeconds) || 30));
        const inserted = await client.query(
          "INSERT INTO workflow_action_receipts " +
            "(id,agency_id,location_id,execution_id,node_id,action_hash,provider_key,status,lease_owner,lease_until,started_at,attempts) " +
          "VALUES ($1,$2,$3,$4,$5,$6,$7,'started',$8,clock_timestamp() + ($9 * interval '1 second'),clock_timestamp(),1) " +
          "ON CONFLICT (agency_id,location_id,action_hash) DO NOTHING " +
          "RETURNING id,status,result,lease_owner,lease_until",
          [randomUUID(), tenantId, locationId, executionId, nodeId, actionHash, providerKey, workerId, leaseSecs]
        );
        if (inserted.rowCount) {
          return { acquired: true, status: 'started', receipt: inserted.rows[0] };
        }
        const existing = await client.query(
          "SELECT id,status,result,lease_owner,lease_until,attempts,provider_receipt,last_error_code " +
          "FROM workflow_action_receipts " +
          "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 FOR UPDATE",
          [tenantId, locationId, actionHash]
        );
        if (!existing.rowCount) {
          return { acquired: false, receipt: null };
        }
        const row = existing.rows[0];
        if (row.status === 'succeeded') {
          return { acquired: false, status: 'succeeded', result: row.result, providerReceipt: row.provider_receipt, receipt: row };
        }
        if (row.status === 'started') {
          const now = Date.now();
          const leaseUntil = row.lease_until ? new Date(row.lease_until).getTime() : 0;
          if (now < leaseUntil) {
            return { acquired: false, status: 'in_progress', leaseOwner: row.lease_owner, leaseUntil: row.lease_until, receipt: row };
          }
          // Lease has expired - recover
          const updated = await client.query(
            "UPDATE workflow_action_receipts " +
            "SET lease_owner=$4, lease_until=clock_timestamp() + ($5 * interval '1 second'), " +
                "attempts=attempts + 1, updated_at=clock_timestamp() " +
            "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 " +
            "RETURNING id,status,result,lease_owner,lease_until",
            [tenantId, locationId, actionHash, workerId, leaseSecs]
          );
          return { acquired: true, recovered: true, status: 'started', receipt: updated.rows[0] || row };
        }
        if (row.status === 'indeterminate') {
          return { acquired: false, status: 'indeterminate', lastErrorCode: row.last_error_code, receipt: row };
        }
        // Failed: reclaim for retry
        const updated = await client.query(
          "UPDATE workflow_action_receipts " +
          "SET status='started', lease_owner=$4, lease_until=clock_timestamp() + ($5 * interval '1 second'), " +
              "attempts=attempts + 1, updated_at=clock_timestamp() " +
          "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 " +
          "RETURNING id,status,result,lease_owner,lease_until",
          [tenantId, locationId, actionHash, workerId, leaseSecs]
        );
        return { acquired: true, retried: true, status: 'started', receipt: updated.rows[0] || row };
      };

      if (providedClient) {
        return execute(providedClient);
      }
      return withClient(async client => {
        await client.query('BEGIN');
        try {
          const result = await execute(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    },

    async completeActionReceipt({ client: providedClient, tenantId, locationId, actionHash, result = {}, providerReceipt = null, outcomeDetails = {} } = {}) {
      if (!HASH.test(actionHash || '')) throw new TypeError('actionHash must be a SHA-256 digest');
      validatePayload(result);
      validatePayload(outcomeDetails);
      if (Buffer.byteLength(JSON.stringify(result)) > 8_192) throw new TypeError('Receipt result exceeds 8 KB');
      if (Buffer.byteLength(JSON.stringify(outcomeDetails)) > 8_192) throw new TypeError('Receipt outcome details exceeds 8 KB');
      if (providerReceipt != null && (typeof providerReceipt !== 'string' || providerReceipt.length > 180 || /bearer\s|token|secret|key=/i.test(providerReceipt))) {
        throw Object.assign(new TypeError('Provider receipt must be a non-secret reference'), { code: 'INVALID_PROVIDER_RECEIPT' });
      }

      const execute = async (client) => {
        await client.query(
          "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
          [tenantId, locationId]
        );
        const updated = await client.query(
          "UPDATE workflow_action_receipts SET status='succeeded', result=$4::jsonb, " +
            "provider_receipt=$5, outcome_details=$6::jsonb, completed_at=clock_timestamp(), updated_at=clock_timestamp() " +
          "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 " +
          "RETURNING id,status,result,provider_receipt,completed_at",
          [tenantId, locationId, actionHash, JSON.stringify(result), providerReceipt || null, JSON.stringify(outcomeDetails)]
        );
        if (!updated.rowCount) throw Object.assign(new Error('Action receipt not found'), { code: 'ACTION_RECEIPT_NOT_FOUND' });
        return updated.rows[0];
      };

      if (providedClient) {
        return execute(providedClient);
      }
      return withClient(async client => {
        await client.query('BEGIN');
        try {
          const res = await execute(client);
          await client.query('COMMIT');
          return res;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    },

    async failActionReceipt({ client: providedClient, tenantId, locationId, actionHash, errorCode = 'ACTION_FAILED', errorDetails = {}, indeterminate = false } = {}) {
      if (!HASH.test(actionHash || '')) throw new TypeError('actionHash must be a SHA-256 digest');
      validatePayload(errorDetails);
      if (Buffer.byteLength(JSON.stringify(errorDetails)) > 8_192) throw new TypeError('Receipt error details exceeds 8 KB');

      const execute = async (client) => {
        await client.query(
          "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
          [tenantId, locationId]
        );
        const safeCode = typeof errorCode === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(errorCode) ? errorCode : 'ACTION_FAILED';
        const updated = await client.query(
          "UPDATE workflow_action_receipts " +
          "SET status=CASE WHEN $4::boolean=true THEN 'indeterminate' ELSE 'failed' END, " +
              "last_error_code=$5, outcome_details=$6::jsonb, updated_at=clock_timestamp() " +
          "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 " +
          "RETURNING id,status,last_error_code,outcome_details",
          [tenantId, locationId, actionHash, Boolean(indeterminate), safeCode, JSON.stringify(errorDetails)]
        );
        if (!updated.rowCount) throw Object.assign(new Error('Action receipt not found'), { code: 'ACTION_RECEIPT_NOT_FOUND' });
        return updated.rows[0];
      };

      if (providedClient) {
        return execute(providedClient);
      }
      return withClient(async client => {
        await client.query('BEGIN');
        try {
          const res = await execute(client);
          await client.query('COMMIT');
          return res;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    },

    async getActionReceipt({ client: providedClient, tenantId, locationId, actionHash } = {}) {
      if (!HASH.test(actionHash || '')) throw new TypeError('actionHash must be a SHA-256 digest');
      const execute = async (client) => {
        await client.query(
          "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
          [tenantId, locationId]
        );
        const res = await client.query(
          "SELECT id, agency_id, location_id, execution_id, node_id, action_hash, " +
                 "status, provider_key, provider_receipt, result, attempts, " +
                 "lease_owner, lease_until, started_at, completed_at, last_error_code, outcome_details, " +
                 "created_at, updated_at " +
          "FROM workflow_action_receipts " +
          "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3",
          [tenantId, locationId, actionHash]
        );
        return res.rows[0] || null;
      };

      if (providedClient) {
        return execute(providedClient);
      }
      return withClient(execute);
    }
  };
}
