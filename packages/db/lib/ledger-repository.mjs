/**
 * ============================================================================
 * Operza Financial Ledger Repository — Domain Boundary
 * ============================================================================
 * Encapsulates immutable, hash-chained ledger accounts and entries strictly
 * through TenantTx on `billing_ledger_accounts` and `billing_ledger_entries`
 * (Migrations 013 & 033).
 */

import crypto, { randomUUID } from 'node:crypto';
import { validateCurrency } from './money.mjs';

const ACCOUNT_TYPES = new Set(['credit_balance', 'stripe_escrow', 'provider_cost_accrual', 'usage_reserve']);
const ENTRY_TYPES = new Set(['credit', 'debit']);

function computeChecksum(agencyId, locationId, accountId, entryType, amountCents, runningBalanceCents, prevChecksum) {
  return crypto
    .createHash('sha256')
    .update(`${agencyId}:${locationId}:${accountId}:${entryType}:${amountCents}:${runningBalanceCents}:${prevChecksum}`)
    .digest('hex');
}

export function normalizeAccountRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    accountType: row.account_type || row.accountType,
    balanceCents: Number(row.balance_cents ?? row.balanceCents ?? 0),
    currency: row.currency || 'USD',
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function normalizeEntryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    accountId: row.account_id || row.accountId,
    entryType: row.entry_type || row.entryType,
    amountCents: Number(row.amount_cents ?? row.amountCents ?? 0),
    runningBalanceCents: Number(row.running_balance_cents ?? row.runningBalanceCents ?? 0),
    referenceType: row.reference_type || row.referenceType,
    referenceId: row.reference_id || row.referenceId,
    description: row.description || '',
    checksum: row.checksum,
    idempotencyKey: row.idempotency_key || row.idempotencyKey || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at
  };
}

export function createLedgerRepository() {
  return {
    async getOrCreateAccount(tx, { accountType = 'credit_balance', currency = 'USD' } = {}) {
      if (!ACCOUNT_TYPES.has(accountType)) {
        throw Object.assign(new Error(`Invalid ledger account type: "${accountType}"`), { code: 'INVALID_ACCOUNT_TYPE' });
      }
      const validCurrency = validateCurrency(currency);

      const existing = await tx.query(
        `SELECT * FROM billing_ledger_accounts WHERE agency_id = $1 AND location_id = $2 AND account_type = $3 FOR UPDATE`,
        [tx.agencyId, tx.locationId, accountType]
      );
      if (existing.rows.length > 0) {
        return normalizeAccountRow(existing.rows[0]);
      }

      const id = randomUUID();
      const inserted = await tx.query(
        `INSERT INTO billing_ledger_accounts (id, agency_id, location_id, account_type, balance_cents, currency)
         VALUES ($1, $2, $3, $4, 0, $5)
         RETURNING *`,
        [id, tx.agencyId, tx.locationId, accountType, validCurrency]
      );
      return normalizeAccountRow(inserted.rows[0]);
    },

    async recordTransaction(tx, {
      accountType = 'credit_balance',
      entryType,
      amountCents,
      referenceType = 'manual_adjustment',
      referenceId,
      description = '',
      idempotencyKey = null,
      currency = 'USD',
      allowOverdraft = false
    }) {
      if (!ENTRY_TYPES.has(entryType)) {
        throw Object.assign(new Error(`Entry type must be credit or debit, got "${entryType}"`), { code: 'INVALID_ENTRY_TYPE' });
      }
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        throw Object.assign(new Error('amountCents must be a positive integer greater than 0'), { code: 'INVALID_AMOUNT' });
      }

      if (idempotencyKey) {
        const dup = await tx.query(
          `SELECT * FROM billing_ledger_entries WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3`,
          [tx.agencyId, tx.locationId, idempotencyKey]
        );
        if (dup.rows.length > 0) {
          return { entry: normalizeEntryRow(dup.rows[0]), deduplicated: true };
        }
      }

      const account = await this.getOrCreateAccount(tx, { accountType, currency });
      let nextBalance = account.balanceCents;
      if (entryType === 'credit') {
        nextBalance += amountCents;
      } else {
        if (!allowOverdraft && account.balanceCents < amountCents) {
          throw Object.assign(new Error(`Insufficient balance: available ${account.balanceCents} cents, required ${amountCents} cents`), {
            code: 'INSUFFICIENT_BALANCE'
          });
        }
        nextBalance -= amountCents;
      }

      const prevRes = await tx.query(
        `SELECT checksum FROM billing_ledger_entries
         WHERE agency_id = $1 AND location_id = $2 AND account_id = $3
         ORDER BY created_at DESC LIMIT 1`,
        [tx.agencyId, tx.locationId, account.id]
      );
      const prevChecksum = prevRes.rows[0]?.checksum || 'genesis';

      const entryId = randomUUID();
      const checksum = computeChecksum(
        tx.agencyId,
        tx.locationId,
        account.id,
        entryType,
        amountCents,
        nextBalance,
        prevChecksum
      );

      const entryRes = await tx.query(
        `INSERT INTO billing_ledger_entries (
          id, agency_id, location_id, account_id, entry_type, amount_cents,
          running_balance_cents, reference_type, reference_id, description, checksum, idempotency_key
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          entryId,
          tx.agencyId,
          tx.locationId,
          account.id,
          entryType,
          amountCents,
          nextBalance,
          referenceType,
          referenceId || entryId,
          description,
          checksum,
          idempotencyKey
        ]
      );

      const updatedAccRes = await tx.query(
        `UPDATE billing_ledger_accounts SET balance_cents = $1, updated_at = now()
         WHERE agency_id = $2 AND location_id = $3 AND id = $4
         RETURNING *`,
        [nextBalance, tx.agencyId, tx.locationId, account.id]
      );

      return {
        entry: normalizeEntryRow(entryRes.rows[0]),
        account: normalizeAccountRow(updatedAccRes.rows[0]),
        deduplicated: false
      };
    },

    async listEntries(tx, { accountType = 'credit_balance', limit = 50 } = {}) {
      const account = await this.getOrCreateAccount(tx, { accountType });
      const res = await tx.query(
        `SELECT * FROM billing_ledger_entries
         WHERE agency_id = $1 AND location_id = $2 AND account_id = $3
         ORDER BY created_at ASC LIMIT $4`,
        [tx.agencyId, tx.locationId, account.id, Math.min(500, Math.max(1, Number(limit) || 50))]
      );
      return res.rows.map(normalizeEntryRow);
    },

    async verifyAccountIntegrity(tx, { accountType = 'credit_balance' } = {}) {
      const account = await this.getOrCreateAccount(tx, { accountType });
      const res = await tx.query(
        `SELECT * FROM billing_ledger_entries
         WHERE agency_id = $1 AND location_id = $2 AND account_id = $3
         ORDER BY created_at ASC`,
        [tx.agencyId, tx.locationId, account.id]
      );

      let prevChecksum = 'genesis';
      let calcBalance = 0;

      for (const row of res.rows) {
        const entry = normalizeEntryRow(row);
        calcBalance = entry.entryType === 'credit'
          ? calcBalance + entry.amountCents
          : calcBalance - entry.amountCents;

        if (calcBalance !== entry.runningBalanceCents) {
          return { valid: false, error: `Running balance mismatch on entry ${entry.id}` };
        }
        const expected = computeChecksum(
          tx.agencyId,
          tx.locationId,
          account.id,
          entry.entryType,
          entry.amountCents,
          entry.runningBalanceCents,
          prevChecksum
        );
        if (entry.checksum !== expected) {
          return { valid: false, error: `Checksum mismatch on entry ${entry.id}` };
        }
        prevChecksum = entry.checksum;
      }

      if (calcBalance !== account.balanceCents) {
        return { valid: false, error: `Account balance mismatch: expected ${calcBalance}, found ${account.balanceCents}` };
      }

      return { valid: true, entryCount: res.rows.length, balanceCents: calcBalance };
    }
  };
}
