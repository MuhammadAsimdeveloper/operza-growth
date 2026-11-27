import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionPayment,
  canTransitionInvoice,
  canTransitionSubscription,
  calculateOrderTotals,
  validateRefundEligibility,
  computeLedgerChecksum,
  verifyLedgerEntriesChain,
  buildPaymentIdempotencyKey,
  calculateProration,
  evaluateDunningSchedule,
  reconcileCommerceRecords
} from '../src/commerce-2-0.mjs';

test('Commerce 2.0: payment, invoice, and subscription state machines enforce authoritative transitions', () => {
  assert.equal(canTransitionPayment('pending', 'succeeded', { viaProviderCallback: false }), false);
  assert.equal(canTransitionPayment('pending', 'succeeded', { viaProviderCallback: true }), true);
  assert.equal(canTransitionPayment('succeeded', 'partially_refunded'), true);
  assert.equal(canTransitionPayment('refunded', 'succeeded', { viaProviderCallback: true }), false);

  assert.equal(canTransitionInvoice('draft', 'open'), true);
  assert.equal(canTransitionInvoice('paid', 'void'), false);

  assert.equal(canTransitionSubscription('trialing', 'active'), true);
  assert.equal(canTransitionSubscription('active', 'past_due'), true);
  assert.equal(canTransitionSubscription('cancelled', 'active'), true);
});

test('Commerce 2.0: minor-unit order totals, coupon validation, and currency mismatch rejection', () => {
  const res = calculateOrderTotals({
    currency: 'USD',
    items: [
      { quantity: 2, unitPriceCents: 2500 },
      { quantity: 1, unitPriceCents: 1000 }
    ],
    coupon: { active: true, discountType: 'percent', discountValue: 10 },
    explicitTaxCents: 450
  });
  assert.equal(res.subtotalCents, 6000);
  assert.equal(res.discountCents, 600);
  assert.equal(res.taxCents, 450);
  assert.equal(res.totalCents, 5850);

  assert.throws(
    () =>
      calculateOrderTotals({
        currency: 'USD',
        items: [{ quantity: 1, unitPriceCents: 1000, currency: 'EUR' }]
      }),
    { code: 'CURRENCY_MISMATCH' }
  );

  assert.throws(
    () =>
      calculateOrderTotals({
        currency: 'USD',
        items: [{ quantity: 1, unitPriceCents: 1000 }],
        coupon: { active: true, discountType: 'fixed', discountValueCents: 500, currency: 'EUR' }
      }),
    { code: 'COUPON_CURRENCY_MISMATCH' }
  );
});

test('Commerce 2.0: cumulative refund limits, approval thresholds, and ledger hash-chain verification', () => {
  const exceed = validateRefundEligibility({
    capturedCents: 10000,
    alreadyRefundedCents: 7000,
    requestedCents: 4000
  });
  assert.equal(exceed.eligible, false);
  assert.equal(exceed.code, 'REFUND_EXCEEDS_CAPTURED_AMOUNT');

  const needsApproval = validateRefundEligibility({
    capturedCents: 100000,
    alreadyRefundedCents: 0,
    requestedCents: 60000,
    approvalThresholdCents: 50000,
    approvedBy: null
  });
  assert.equal(needsApproval.eligible, false);
  assert.equal(needsApproval.code, 'REFUND_APPROVAL_REQUIRED');

  const partial = validateRefundEligibility({
    capturedCents: 10000,
    alreadyRefundedCents: 2000,
    requestedCents: 3000
  });
  assert.equal(partial.eligible, true);
  assert.equal(partial.isFullRefund, false);

  const c1 = computeLedgerChecksum({
    agencyId: 'a1',
    locationId: 'l1',
    accountId: 'acc1',
    entryType: 'credit',
    amountCents: 5000,
    runningBalanceCents: 5000,
    prevChecksum: 'GENESIS'
  });
  const c2 = computeLedgerChecksum({
    agencyId: 'a1',
    locationId: 'l1',
    accountId: 'acc1',
    entryType: 'debit',
    amountCents: 2000,
    runningBalanceCents: 3000,
    prevChecksum: c1
  });
  const entries = [
    { agencyId: 'a1', locationId: 'l1', accountId: 'acc1', entryType: 'credit', amountCents: 5000, runningBalanceCents: 5000, checksum: c1 },
    { agencyId: 'a1', locationId: 'l1', accountId: 'acc1', entryType: 'debit', amountCents: 2000, runningBalanceCents: 3000, checksum: c2 }
  ];
  assert.equal(verifyLedgerEntriesChain(entries).valid, true);
  entries[1].checksum = 'tampered';
  assert.equal(verifyLedgerEntriesChain(entries).valid, false);
});

test('Commerce 2.0: idempotency, proration, bounded dunning, and reconciliation', () => {
  const k1 = buildPaymentIdempotencyKey({ agencyId: 'a1', locationId: 'l1', orderId: 'o1', attemptSeq: 1 });
  const k2 = buildPaymentIdempotencyKey({ agencyId: 'a1', locationId: 'l1', orderId: 'o1', attemptSeq: 1 });
  assert.equal(k1, k2);

  const proration = calculateProration({ currentPriceCents: 3000, newPriceCents: 9000, daysRemaining: 15, totalPeriodDays: 30 });
  assert.equal(proration.netAdjustmentCents, 3000);

  assert.equal(evaluateDunningSchedule({ attemptCount: 1, maxAttempts: 4 }).shouldRetry, true);
  assert.equal(evaluateDunningSchedule({ attemptCount: 4, maxAttempts: 4 }).shouldRetry, false);
  assert.equal(evaluateDunningSchedule({ attemptCount: 0, isPermanentDecline: true }).shouldRetry, false);

  const rec = reconcileCommerceRecords({
    payments: [{ id: 'p1', invoiceId: 'inv1', status: 'succeeded' }],
    invoices: [{ id: 'inv1', status: 'paid' }],
    ledgerEntries: [{ referenceId: 'p1', entryType: 'credit' }]
  });
  assert.equal(rec.reconciled, true);
});
