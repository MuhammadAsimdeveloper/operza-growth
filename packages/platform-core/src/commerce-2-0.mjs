import { createHash } from 'node:crypto';

export const PAYMENT_STATES = Object.freeze([
  'pending',
  'requires_action',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'partially_refunded',
  'refunded'
]);

const PAYMENT_TRANSITIONS = Object.freeze({
  pending: new Set(['requires_action', 'processing', 'succeeded', 'failed', 'cancelled']),
  requires_action: new Set(['processing', 'succeeded', 'failed', 'cancelled']),
  processing: new Set(['succeeded', 'failed', 'cancelled']),
  succeeded: new Set(['partially_refunded', 'refunded']),
  partially_refunded: new Set(['partially_refunded', 'refunded']),
  failed: new Set(['pending']),
  cancelled: new Set([]),
  refunded: new Set([])
});

export function canTransitionPayment(fromState, toState, { viaProviderCallback = false } = {}) {
  if (toState === 'succeeded' && !viaProviderCallback) {
    return false;
  }
  return Boolean(PAYMENT_TRANSITIONS[fromState]?.has(toState));
}

export const INVOICE_STATES = Object.freeze([
  'draft',
  'open',
  'partially_paid',
  'paid',
  'overdue',
  'void'
]);

const INVOICE_TRANSITIONS = Object.freeze({
  draft: new Set(['open', 'void']),
  open: new Set(['partially_paid', 'paid', 'overdue', 'void']),
  partially_paid: new Set(['paid', 'overdue', 'void']),
  overdue: new Set(['partially_paid', 'paid', 'void']),
  paid: new Set([]),
  void: new Set([])
});

export function canTransitionInvoice(fromState, toState) {
  return Boolean(INVOICE_TRANSITIONS[fromState]?.has(toState));
}

export const SUBSCRIPTION_STATES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired'
]);

const SUBSCRIPTION_TRANSITIONS = Object.freeze({
  trialing: new Set(['active', 'past_due', 'cancelled', 'expired']),
  active: new Set(['past_due', 'paused', 'cancelled', 'expired']),
  past_due: new Set(['active', 'paused', 'cancelled', 'expired']),
  paused: new Set(['active', 'cancelled', 'expired']),
  cancelled: new Set(['active']),
  expired: new Set(['active'])
});

export function canTransitionSubscription(fromState, toState) {
  if (fromState === toState) return true;
  return Boolean(SUBSCRIPTION_TRANSITIONS[fromState]?.has(toState));
}

export function assertValidCurrency(currency = 'USD') {
  const norm = String(currency || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(norm)) {
    throw Object.assign(new Error(`Invalid ISO-4217 currency: ${currency}`), { code: 'INVALID_CURRENCY' });
  }
  return norm;
}

export function calculateOrderTotals({
  items = [],
  currency = 'USD',
  coupon = null,
  explicitTaxCents = 0
} = {}) {
  const validCurrency = assertValidCurrency(currency);
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('At least one line item is required'), { code: 'EMPTY_ORDER_ITEMS' });
  }
  let subtotalCents = 0;
  for (const item of items) {
    const qty = Number(item.quantity ?? 1);
    const unitCents = Number(item.unitPriceCents);
    if (!Number.isSafeInteger(qty) || qty <= 0) {
      throw Object.assign(new Error('Item quantity must be a positive integer'), { code: 'INVALID_QUANTITY' });
    }
    if (!Number.isSafeInteger(unitCents) || unitCents < 0) {
      throw Object.assign(new Error('Item unitPriceCents must be a non-negative integer'), { code: 'INVALID_AMOUNT' });
    }
    if (item.currency && assertValidCurrency(item.currency) !== validCurrency) {
      throw Object.assign(new Error('Mixed currencies in a single order are forbidden'), { code: 'CURRENCY_MISMATCH' });
    }
    subtotalCents += qty * unitCents;
  }

  let discountCents = 0;
  if (coupon) {
    if (coupon.active === false) {
      throw Object.assign(new Error('Coupon is inactive'), { code: 'COUPON_INVALID' });
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now()) {
      throw Object.assign(new Error('Coupon is expired'), { code: 'COUPON_EXPIRED' });
    }
    if (coupon.minOrderCents && subtotalCents < Number(coupon.minOrderCents)) {
      throw Object.assign(new Error('Order subtotal does not meet coupon minimum'), { code: 'COUPON_MIN_ORDER_NOT_MET' });
    }
    if (coupon.discountType === 'fixed') {
      if (coupon.currency && assertValidCurrency(coupon.currency) !== validCurrency) {
        throw Object.assign(new Error('Coupon currency does not match order currency'), { code: 'COUPON_CURRENCY_MISMATCH' });
      }
      discountCents = Math.min(subtotalCents, Math.max(0, Number(coupon.discountValueCents || coupon.discountValue || 0)));
    } else if (coupon.discountType === 'percent') {
      const pct = Math.min(100, Math.max(0, Number(coupon.discountValue || 0)));
      discountCents = Math.round((subtotalCents * pct) / 100);
    }
  }

  const taxCents = Number(explicitTaxCents || 0);
  if (!Number.isSafeInteger(taxCents) || taxCents < 0) {
    throw Object.assign(new Error('explicitTaxCents must be a non-negative integer'), { code: 'INVALID_TAX_AMOUNT' });
  }

  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents);
  return {
    currency: validCurrency,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents
  };
}

export function validateRefundEligibility({
  capturedCents,
  alreadyRefundedCents = 0,
  requestedCents,
  approvalThresholdCents = 50000,
  approvedBy = null
} = {}) {
  if (!Number.isSafeInteger(capturedCents) || capturedCents <= 0) {
    return { eligible: false, code: 'PAYMENT_NOT_CAPTURED', error: 'Only captured payments can be refunded' };
  }
  if (!Number.isSafeInteger(requestedCents) || requestedCents <= 0) {
    return { eligible: false, code: 'INVALID_REFUND_AMOUNT', error: 'Refund amount must be a positive integer' };
  }
  const remaining = capturedCents - alreadyRefundedCents;
  if (requestedCents > remaining) {
    return {
      eligible: false,
      code: 'REFUND_EXCEEDS_CAPTURED_AMOUNT',
      error: `Requested ${requestedCents} cents exceeds remaining refundable ${remaining} cents`
    };
  }
  if (requestedCents > approvalThresholdCents && !approvedBy) {
    return {
      eligible: false,
      code: 'REFUND_APPROVAL_REQUIRED',
      error: `Refunds above ${approvalThresholdCents} cents require explicit approval`
    };
  }
  const isFullRefund = alreadyRefundedCents + requestedCents === capturedCents;
  return { eligible: true, isFullRefund, remainingAfterCents: remaining - requestedCents };
}

export function computeLedgerChecksum({
  agencyId,
  locationId,
  accountId,
  entryType,
  amountCents,
  runningBalanceCents,
  prevChecksum
}) {
  return createHash('sha256')
    .update(`${agencyId}:${locationId}:${accountId}:${entryType}:${amountCents}:${runningBalanceCents}:${prevChecksum}`)
    .digest('hex');
}

export function verifyLedgerEntriesChain(entries = []) {
  let prevChecksum = 'GENESIS';
  let expectedBalance = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const amt = Number(e.amountCents ?? e.amount_cents ?? 0);
    const entryType = e.entryType ?? e.entry_type;
    const running = Number(e.runningBalanceCents ?? e.running_balance_cents ?? 0);
    expectedBalance += entryType === 'credit' ? amt : -amt;
    if (running !== expectedBalance) {
      return { valid: false, brokenAtIndex: i, reason: 'RUNNING_BALANCE_MISMATCH' };
    }
    const expectedHash = computeLedgerChecksum({
      agencyId: e.agencyId ?? e.agency_id,
      locationId: e.locationId ?? e.location_id,
      accountId: e.accountId ?? e.account_id,
      entryType,
      amountCents: amt,
      runningBalanceCents: running,
      prevChecksum
    });
    if (e.checksum !== expectedHash) {
      return { valid: false, brokenAtIndex: i, reason: 'CHECKSUM_MISMATCH' };
    }
    prevChecksum = e.checksum;
  }
  return { valid: true, count: entries.length, finalBalanceCents: expectedBalance };
}

export function buildPaymentIdempotencyKey({ agencyId, locationId, orderId, attemptSeq = 1 }) {
  return createHash('sha256')
    .update(`${agencyId}:${locationId}:${orderId}:${attemptSeq}`)
    .digest('hex')
    .slice(0, 32);
}

export function calculateProration({
  currentPriceCents,
  newPriceCents,
  daysRemaining,
  totalPeriodDays = 30
} = {}) {
  if (!Number.isSafeInteger(currentPriceCents) || !Number.isSafeInteger(newPriceCents) || totalPeriodDays <= 0) {
    throw Object.assign(new Error('Invalid proration inputs'), { code: 'INVALID_PRORATION' });
  }
  const clampedDays = Math.max(0, Math.min(totalPeriodDays, Number(daysRemaining || 0)));
  const unusedCreditCents = Math.round((currentPriceCents * clampedDays) / totalPeriodDays);
  const newChargeCents = Math.round((newPriceCents * clampedDays) / totalPeriodDays);
  return {
    unusedCreditCents,
    newChargeCents,
    netAdjustmentCents: newChargeCents - unusedCreditCents
  };
}

export function evaluateDunningSchedule({ attemptCount = 0, maxAttempts = 4, isPermanentDecline = false } = {}) {
  if (isPermanentDecline || attemptCount >= maxAttempts) {
    return { shouldRetry: false, nextAction: 'mark_past_due_or_cancel', retryAfterHours: null };
  }
  const scheduleHours = [24, 72, 120, 168];
  return {
    shouldRetry: true,
    nextAction: 'schedule_retry',
    retryAfterHours: scheduleHours[Math.min(attemptCount, scheduleHours.length - 1)]
  };
}

export function reconcileCommerceRecords({ payments = [], invoices = [], ledgerEntries = [] } = {}) {
  const succeededPayments = payments.filter((p) => p.status === 'succeeded' || p.status === 'partially_refunded' || p.status === 'refunded');
  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const discrepancies = [];

  for (const inv of paidInvoices) {
    const hasPayment = succeededPayments.some((p) => p.invoiceId === inv.id || p.invoice_id === inv.id);
    if (!hasPayment) {
      discrepancies.push({ type: 'PAID_INVOICE_MISSING_PAYMENT', invoiceId: inv.id });
    }
  }
  for (const p of succeededPayments) {
    const hasLedger = ledgerEntries.some((l) => (l.referenceId === p.id || l.reference_id === p.id) && (l.entryType === 'credit' || l.entry_type === 'credit'));
    if (!hasLedger) {
      discrepancies.push({ type: 'PAYMENT_MISSING_LEDGER_ENTRY', paymentId: p.id });
    }
  }
  return {
    reconciled: discrepancies.length === 0,
    discrepancies,
    checkedPayments: succeededPayments.length,
    checkedInvoices: paidInvoices.length,
    checkedLedgerEntries: ledgerEntries.length
  };
}
