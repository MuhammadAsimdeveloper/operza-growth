import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDunningRepository,
  createPaymentLinksRepository,
  createCouponsRepository,
  generateInvoicePdf
} from '../lib/database.mjs';

const AGENCY_A = '11111111-1111-4111-8111-111111111111';
const LOCATION_A = '22222222-2222-4222-8222-222222222222';
const INV_1 = '66666666-6666-4666-8666-666666666666';

function makeMockTx(store = { links: [], coupons: [], dunning: [] }) {
  return {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    actorId: 'user-1',
    async query(sql, params = []) {
      const n = sql.replace(/\s+/g, ' ').trim();

      if (n.startsWith('INSERT INTO payment_links')) {
        const [id, agencyId, locationId, name, slug, amountCents, currency, description, active, maxUses, expiresAt, productIds] = params;
        const row = {
          id, agency_id: agencyId, location_id: locationId, name, slug,
          amount_cents: amountCents, currency, description, active, visits: 0,
          max_uses: maxUses, uses_count: 0, expires_at: expiresAt,
          product_ids: typeof productIds === 'string' ? JSON.parse(productIds) : productIds,
          created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.links.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (n.startsWith('INSERT INTO coupons')) {
        const [id, agencyId, locationId, code, discountType, discountValue, active, maxUses, expiresAt] = params;
        const row = {
          id, agency_id: agencyId, location_id: locationId, code, discount_type: discountType,
          discount_value: discountValue, active, max_uses: maxUses, uses_count: 0, expires_at: expiresAt,
          created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.coupons.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (n.startsWith('SELECT * FROM coupons WHERE agency_id = $1 AND location_id = $2 AND upper(code) = upper($3)')) {
        const [a, l, code] = params;
        const rows = store.coupons.filter(c => c.agency_id === a && c.location_id === l && c.code.toUpperCase() === code.toUpperCase());
        return { rows, rowCount: rows.length };
      }

      if (n.startsWith('UPDATE coupons SET uses_count = uses_count + 1')) {
        const [a, l, id] = params;
        const c = store.coupons.find(x => x.agency_id === a && x.location_id === l && x.id === id);
        if (!c || (c.max_uses !== null && c.uses_count >= c.max_uses)) return { rows: [], rowCount: 0 };
        c.uses_count += 1;
        return { rows: [c], rowCount: 1 };
      }

      if (n.startsWith('INSERT INTO dunning_attempts')) {
        const [id, agencyId, locationId, invoiceId, paymentId, attemptNumber, maxAttempts, status, failureCode, failureMessage, idempotencyKey, nextRetryAt] = params;
        const dup = store.dunning.find(d => d.agency_id === agencyId && d.location_id === locationId && d.idempotency_key === idempotencyKey);
        if (dup) return { rows: [], rowCount: 0 };
        const row = {
          id, agency_id: agencyId, location_id: locationId, invoice_id: invoiceId, payment_id: paymentId,
          attempt_number: attemptNumber, max_attempts: maxAttempts, status, failure_code: failureCode,
          failure_message: failureMessage, idempotency_key: idempotencyKey, next_retry_at: nextRetryAt,
          completed_at: null, created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.dunning.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (n.startsWith('SELECT * FROM dunning_attempts WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3')) {
        const [a, l, key] = params;
        const rows = store.dunning.filter(d => d.agency_id === a && d.location_id === l && d.idempotency_key === key);
        return { rows, rowCount: rows.length };
      }

      if (n.startsWith('UPDATE dunning_attempts SET status =')) {
        const [a, l, id, status, failureCode, failureMessage, nextRetryAt, completedAt] = params;
        const d = store.dunning.find(x => x.agency_id === a && x.location_id === l && x.id === id);
        if (!d) return { rows: [], rowCount: 0 };
        d.status = status; d.failure_code = failureCode; d.failure_message = failureMessage;
        d.next_retry_at = nextRetryAt; d.completed_at = completedAt;
        return { rows: [d], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

test('CouponsRepository: enforces max_uses limit and prevents over-redemption', async () => {
  const tx = makeMockTx();
  const couponsRepo = createCouponsRepository();

  const coupon = await couponsRepo.createCoupon(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    code: 'LAUNCH20',
    discountType: 'percent',
    discountValue: 20,
    maxUses: 1
  });
  assert.equal(coupon.code, 'LAUNCH20');

  const first = await couponsRepo.redeemCoupon(tx, { agencyId: AGENCY_A, locationId: LOCATION_A, code: 'launch20' });
  assert.equal(first.usesCount, 1);

  await assert.rejects(
    () => couponsRepo.redeemCoupon(tx, { agencyId: AGENCY_A, locationId: LOCATION_A, code: 'LAUNCH20' }),
    /usage limit/i
  );
});

test('DunningRepository: schedules idempotently, classifies non-retryable failures as terminal', async () => {
  const tx = makeMockTx();
  const dunningRepo = createDunningRepository();

  const a1 = await dunningRepo.scheduleRetry(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    invoiceId: INV_1,
    attemptNumber: 1,
    maxAttempts: 3,
    failureCode: 'insufficient_funds',
    idempotencyKey: 'dun-inv1-1'
  });
  assert.equal(a1.deduplicated, false);
  assert.equal(a1.attempt.status, 'scheduled');

  const dup = await dunningRepo.scheduleRetry(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    invoiceId: INV_1,
    attemptNumber: 1,
    maxAttempts: 3,
    failureCode: 'insufficient_funds',
    idempotencyKey: 'dun-inv1-1'
  });
  assert.equal(dup.deduplicated, true);

  const terminal = await dunningRepo.recordOutcome(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    id: a1.attempt.id,
    succeeded: false,
    failureCode: 'fraudulent',
    failureMessage: 'Card flagged as fraudulent'
  });
  assert.equal(terminal.status, 'failed_terminal');
});

test('generateInvoicePdf: produces valid %PDF-1.4 document with authoritative minor-unit totals', () => {
  const pdfBuffer = generateInvoicePdf({
    number: 'INV-2026-0042',
    agencyName: 'Operza Growth Agency',
    contactName: 'Jane Doe',
    currency: 'USD',
    status: 'paid',
    amountCents: 150000,
    paidCents: 150000,
    discountCents: 10000,
    taxCents: 12000,
    lineItems: [
      { description: 'Growth Retainer (Monthly)', quantity: 1, unitPriceCents: 148000 }
    ]
  });

  assert.ok(Buffer.isBuffer(pdfBuffer));
  const text = pdfBuffer.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('INV-2026-0042'));
  assert.ok(text.includes('Operza Growth Agency'));
  assert.ok(text.includes('1500.00'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
});
