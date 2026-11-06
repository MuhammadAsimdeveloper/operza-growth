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
    async enqueue(input) {
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

      return withClient(async client => {
        await client.query('BEGIN');
        try {
          await client.query(
            "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
            [input.tenantId, input.locationId]
          );
          const inserted = await client.query(
            "INSERT INTO workflow_outbox " +
            "(id, agency_id, location_id, execution_id, event_type, payload, idempotency_key, priority, max_attempts) " +
            "VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) " +
            "ON CONFLICT (agency_id, location_id, idempotency_key) DO NOTHING " +
            "RETURNING id, event_type, status, attempts, created_at",
            [id, input.tenantId, input.locationId, input.executionId || null, input.eventType,
              JSON.stringify(payload), input.idempotencyKey, priority, maxAttempts]
          );
          let row = inserted.rows[0];
          let deduplicated = false;
          if (!row) {
            const existing = await client.query(
              "SELECT id, event_type, status, attempts, created_at FROM workflow_outbox " +
              "WHERE agency_id=$1 AND location_id=$2 AND idempotency_key=$3",
              [input.tenantId, input.locationId, input.idempotencyKey]
            );
            row = existing.rows[0];
            deduplicated = true;
          }
          await client.query('COMMIT');
          return { ...row, deduplicated };
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
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
              "ORDER BY priority DESC, available_at ASC, created_at ASC " +
              "FOR UPDATE SKIP LOCKED LIMIT $2" +
            ") " +
            "UPDATE workflow_outbox AS jobs " +
            "SET status='leased', lease_owner=$1, lease_until=now() + ($3 * interval '1 millisecond'), " +
                "attempts=jobs.attempts + 1, updated_at=now() " +
            "FROM eligible " +
            "WHERE jobs.agency_id=eligible.agency_id AND jobs.location_id=eligible.location_id AND jobs.id=eligible.id " +
            "RETURNING jobs.id, jobs.agency_id, jobs.location_id, jobs.execution_id, jobs.event_type, jobs.payload, " +
                      "jobs.attempts, jobs.max_attempts, jobs.lease_until, jobs.idempotency_key",
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

    async claimActionReceipt({ tenantId, locationId, executionId, nodeId, actionHash, providerKey = null } = {}) {
      assertRef(tenantId, 'tenantId');
      assertRef(locationId, 'locationId');
      assertRef(executionId, 'executionId');
      assertRef(nodeId, 'nodeId');
      if (!HASH.test(actionHash || '')) throw new TypeError('actionHash must be a SHA-256 digest');
      return withClient(async client => {
        await client.query('BEGIN');
        try {
          await client.query(
            "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
            [tenantId, locationId]
          );
          const inserted = await client.query(
            "INSERT INTO workflow_action_receipts " +
              "(id,agency_id,location_id,execution_id,node_id,action_hash,provider_key,status) " +
            "VALUES ($1,$2,$3,$4,$5,$6,$7,'started') " +
            "ON CONFLICT (agency_id,location_id,action_hash) DO NOTHING " +
            "RETURNING id,status,result",
            [randomUUID(),tenantId,locationId,executionId,nodeId,actionHash,providerKey]
          );
          if (inserted.rowCount) {
            await client.query('COMMIT');
            return { acquired: true, receipt: inserted.rows[0] };
          }
          const existing = await client.query(
            "SELECT id,status,result FROM workflow_action_receipts " +
            "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 FOR UPDATE",
            [tenantId,locationId,actionHash]
          );
          await client.query('COMMIT');
          return { acquired: false, receipt: existing.rows[0] || null };
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    },

    async completeActionReceipt({ tenantId, locationId, actionHash, result = {}, providerReceipt = null } = {}) {
      if (!HASH.test(actionHash || '')) throw new TypeError('actionHash must be a SHA-256 digest');
      validatePayload(result);
      if (Buffer.byteLength(JSON.stringify(result)) > 8_192) throw new TypeError('Receipt result exceeds 8 KB');
      return withClient(async client => {
        await client.query(
          "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
          [tenantId, locationId]
        );
        const updated = await client.query(
          "UPDATE workflow_action_receipts SET status='succeeded', result=$4::jsonb, " +
            "provider_receipt=$5, updated_at=now() " +
          "WHERE agency_id=$1 AND location_id=$2 AND action_hash=$3 " +
          "RETURNING id,status,result",
          [tenantId,locationId,actionHash,JSON.stringify(result),
            typeof providerReceipt === 'string' ? providerReceipt.slice(0,180) : null]
        );
        if (!updated.rowCount) throw Object.assign(new Error('Action receipt not found'), { code: 'ACTION_RECEIPT_NOT_FOUND' });
        return updated.rows[0];
      });
    }
  };
}
