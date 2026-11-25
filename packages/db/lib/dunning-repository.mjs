import { randomUUID } from 'node:crypto';

const NON_RETRYABLE_CODES = new Set([
  'fraudulent',
  'stolen_card',
  'lost_card',
  'expired_card',
  'card_declined_stolen',
  'invalid_account',
  'payment_intent_unexpected_state'
]);

function mapDunningRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    invoiceId: row.invoice_id,
    paymentId: row.payment_id || null,
    attemptNumber: Number(row.attempt_number),
    maxAttempts: Number(row.max_attempts),
    status: row.status,
    failureCode: row.failure_code || null,
    failureMessage: row.failure_message || null,
    idempotencyKey: row.idempotency_key,
    nextRetryAt: row.next_retry_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function isRetryableFailure(failureCode) {
  if (!failureCode) return true;
  return !NON_RETRYABLE_CODES.has(String(failureCode).toLowerCase().trim());
}

export function createDunningRepository() {
  return {
    async scheduleRetry(tx, input = {}) {
      const a = input.agencyId || tx?.agencyId;
      const l = input.locationId || tx?.locationId;
      if (!a || !l || !input.invoiceId) {
        throw new Error('DunningRepository requires agencyId, locationId, and invoiceId.');
      }
      const attemptNumber = Math.max(1, Number(input.attemptNumber) || 1);
      const maxAttempts = Math.max(1, Number(input.maxAttempts) || 3);
      const idempotencyKey = input.idempotencyKey || `dun_${input.invoiceId}_${attemptNumber}`;
      const retryable = isRetryableFailure(input.failureCode);
      const status = !retryable || attemptNumber > maxAttempts ? 'failed_terminal' : 'scheduled';
      const backoffMinutes = Math.pow(2, attemptNumber - 1) * 60;
      const nextRetryAt = status === 'scheduled'
        ? (input.nextRetryAt || new Date(Date.now() + backoffMinutes * 60_000).toISOString())
        : null;

      const res = await tx.query(
        `INSERT INTO dunning_attempts (
          id, agency_id, location_id, invoice_id, payment_id, attempt_number,
          max_attempts, status, failure_code, failure_message, idempotency_key, next_retry_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT DO NOTHING
        RETURNING *`,
        [
          input.id || randomUUID(),
          a,
          l,
          input.invoiceId,
          input.paymentId || null,
          attemptNumber,
          maxAttempts,
          status,
          input.failureCode || null,
          input.failureMessage || null,
          idempotencyKey,
          nextRetryAt
        ]
      );

      if (res.rowCount === 0) {
        const existing = await tx.query(
          'SELECT * FROM dunning_attempts WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3 LIMIT 1',
          [a, l, idempotencyKey]
        );
        return { deduplicated: true, attempt: mapDunningRow(existing.rows[0]) };
      }

      return { deduplicated: false, attempt: mapDunningRow(res.rows[0]) };
    },

    async recordOutcome(tx, { agencyId, locationId, id, succeeded, failureCode = null, failureMessage = null } = {}) {
      const a = agencyId || tx?.agencyId;
      const l = locationId || tx?.locationId;
      const retryable = succeeded ? true : isRetryableFailure(failureCode);
      const nextStatus = succeeded ? 'succeeded' : (retryable ? 'failed_retryable' : 'failed_terminal');
      const completedAt = succeeded || !retryable ? new Date().toISOString() : null;

      const res = await tx.query(
        `UPDATE dunning_attempts
         SET status = $4, failure_code = $5, failure_message = $6,
             next_retry_at = $7, completed_at = $8, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [a, l, id, nextStatus, failureCode, failureMessage, null, completedAt]
      );
      return mapDunningRow(res.rows[0]);
    },

    async listAttempts(tx, { agencyId, locationId, invoiceId = null } = {}) {
      const a = agencyId || tx?.agencyId;
      const l = locationId || tx?.locationId;
      const params = [a, l];
      const filters = ['agency_id = $1', 'location_id = $2'];
      if (invoiceId) {
        params.push(invoiceId);
        filters.push(`invoice_id = $${params.length}`);
      }
      const res = await tx.query(
        `SELECT * FROM dunning_attempts WHERE ${filters.join(' AND ')} ORDER BY created_at DESC`,
        params
      );
      return res.rows.map(mapDunningRow);
    }
  };
}
