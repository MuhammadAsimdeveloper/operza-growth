import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { toCents, fromCents, validateCurrency } from '../lib/money.mjs';
import { createOrdersRepository } from '../lib/orders-repository.mjs';
import { createPaymentsRepository } from '../lib/payments-repository.mjs';
import { createInvoicesRepository } from '../lib/invoices-repository.mjs';
import { createLedgerRepository } from '../lib/ledger-repository.mjs';

function createInMemoryCommercePool() {
  const orders = [];
  const invoices = [];
  const payments = [];
  const accounts = [];
  const entries = [];

  return {
    orders,
    invoices,
    payments,
    accounts,
    entries,
    async connect() {
      let currentAgencyId = null;
      let currentLocationId = null;

      return {
        async query(sql, params = []) {
          const norm = sql.replace(/\s+/g, ' ').trim();
          if (norm === 'BEGIN') return { rows: [], rowCount: 0 };
          if (norm === 'COMMIT' || norm === 'ROLLBACK') {
            currentAgencyId = null;
            currentLocationId = null;
            return { rows: [], rowCount: 0 };
          }
          if (norm.includes("set_config('app.agency_id'")) {
            currentAgencyId = params[0];
            currentLocationId = params[1];
            return { rows: [], rowCount: 0 };
          }

          // ORDERS
          if (norm.startsWith('SELECT * FROM orders WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3')) {
            const [a, l, k] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = orders.find(o => o.agency_id === a && o.location_id === l && o.idempotency_key === k);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('INSERT INTO orders')) {
            const [
              id, agencyId, locationId, orderNumber, contactId, opportunityId, invoiceId, paymentLinkId,
              contactName, amountCents, originalAmountCents, discountCents, taxCents, currency,
              status, itemsStr, couponCode, idempotencyKey, source, hasUpsell, paidAt
            ] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) throw new Error('RLS violation');
            if (idempotencyKey && orders.some(o => o.agency_id === agencyId && o.location_id === locationId && o.idempotency_key === idempotencyKey)) {
              const err = new Error('duplicate key value violates unique constraint "orders_idempotency_idx"');
              err.code = '23505';
              throw err;
            }
            const row = {
              id, agency_id: agencyId, location_id: locationId, order_number: orderNumber,
              contact_id: contactId, opportunity_id: opportunityId, invoice_id: invoiceId, payment_link_id: paymentLinkId,
              contact_name: contactName, amount_cents: Number(amountCents), original_amount_cents: Number(originalAmountCents),
              discount_cents: Number(discountCents), tax_cents: Number(taxCents), currency, status,
              items: typeof itemsStr === 'string' ? JSON.parse(itemsStr) : itemsStr,
              coupon_code: couponCode, idempotency_key: idempotencyKey, source, has_upsell: Boolean(hasUpsell),
              paid_at: paidAt, created_at: new Date(), updated_at: new Date()
            };
            orders.push(row);
            return { rows: [row], rowCount: 1 };
          }
          if (norm.startsWith('SELECT * FROM orders WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = orders.find(o => o.agency_id === a && o.location_id === l && o.id === id);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('UPDATE orders SET')) {
            const [amountCents, status, itemsStr, hasUpsell, paidAt, a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const target = orders.find(o => o.agency_id === a && o.location_id === l && o.id === id);
            if (!target) return { rows: [], rowCount: 0 };
            target.amount_cents = Number(amountCents);
            target.status = status;
            target.items = typeof itemsStr === 'string' ? JSON.parse(itemsStr) : itemsStr;
            target.has_upsell = Boolean(hasUpsell);
            target.paid_at = paidAt;
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }

          // INVOICES
          if (norm.startsWith('INSERT INTO invoices')) {
            const [id, agencyId, locationId, invoiceNumber, orderId, contactId, contactName, amountCents, paidCents, taxCents, currency, status, itemsStr, dueDate, description, paymentMethod, paidAt] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) throw new Error('RLS violation');
            const row = {
              id, agency_id: agencyId, location_id: locationId, invoice_number: invoiceNumber, order_id: orderId,
              contact_id: contactId, contact_name: contactName, amount_cents: Number(amountCents), paid_cents: Number(paidCents),
              tax_cents: Number(taxCents), currency, status, items: typeof itemsStr === 'string' ? JSON.parse(itemsStr) : itemsStr,
              due_date: dueDate, description, payment_method: paymentMethod, paid_at: paidAt,
              created_at: new Date(), updated_at: new Date()
            };
            invoices.push(row);
            return { rows: [row], rowCount: 1 };
          }
          if (norm.startsWith('SELECT * FROM invoices WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = invoices.find(i => i.agency_id === a && i.location_id === l && i.id === id);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('UPDATE invoices SET')) {
            const [amountCents, paidCents, status, itemsStr, description, paymentMethod, paidAt, a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const target = invoices.find(i => i.agency_id === a && i.location_id === l && i.id === id);
            if (!target) return { rows: [], rowCount: 0 };
            target.amount_cents = Number(amountCents);
            target.paid_cents = Number(paidCents);
            target.status = status;
            target.items = typeof itemsStr === 'string' ? JSON.parse(itemsStr) : itemsStr;
            target.description = description;
            target.payment_method = paymentMethod;
            target.paid_at = paidAt;
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }

          // PAYMENTS
          if (norm.startsWith('SELECT * FROM payments WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3')) {
            const [a, l, k] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = payments.find(p => p.agency_id === a && p.location_id === l && p.idempotency_key === k);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('SELECT * FROM payments WHERE agency_id = $1 AND provider_event_id = $2')) {
            const [a, e] = params;
            if (a !== currentAgencyId) return { rows: [], rowCount: 0 };
            const m = payments.find(p => p.agency_id === a && p.provider_event_id === e);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('INSERT INTO payments')) {
            const [id, agencyId, locationId, orderId, invoiceId, contactId, amountCents, currency, status, provider, providerPaymentId, providerEventId, idempotencyKey, method, failureCode, failureMessage, metadataStr] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) throw new Error('RLS violation');
            const row = {
              id, agency_id: agencyId, location_id: locationId, order_id: orderId, invoice_id: invoiceId, contact_id: contactId,
              amount_cents: Number(amountCents), refunded_cents: 0, currency, status,
              provider, provider_payment_id: providerPaymentId, provider_event_id: providerEventId, idempotency_key: idempotencyKey,
              method, failure_code: failureCode, failure_message: failureMessage,
              metadata: typeof metadataStr === 'string' ? JSON.parse(metadataStr) : metadataStr,
              created_at: new Date(), updated_at: new Date()
            };
            payments.push(row);
            return { rows: [row], rowCount: 1 };
          }
          if (norm.startsWith('SELECT * FROM payments WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = payments.find(p => p.agency_id === a && p.location_id === l && p.id === id);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('UPDATE payments SET')) {
            const [refundedCents, status, providerPaymentId, providerEventId, failureCode, failureMessage, a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const target = payments.find(p => p.agency_id === a && p.location_id === l && p.id === id);
            if (!target) return { rows: [], rowCount: 0 };
            target.refunded_cents = Number(refundedCents);
            target.status = status;
            target.provider_payment_id = providerPaymentId;
            target.provider_event_id = providerEventId;
            target.failure_code = failureCode;
            target.failure_message = failureMessage;
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }

          // LEDGER
          if (norm.startsWith('SELECT * FROM billing_ledger_accounts WHERE agency_id = $1 AND location_id = $2 AND account_type = $3')) {
            const [a, l, t] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = accounts.find(acc => acc.agency_id === a && acc.location_id === l && acc.account_type === t);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('INSERT INTO billing_ledger_accounts')) {
            const [id, agencyId, locationId, accountType, currency] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) throw new Error('RLS violation');
            const row = {
              id, agency_id: agencyId, location_id: locationId, account_type: accountType,
              balance_cents: 0, currency, created_at: new Date(), updated_at: new Date()
            };
            accounts.push(row);
            return { rows: [row], rowCount: 1 };
          }
          if (norm.startsWith('UPDATE billing_ledger_accounts SET balance_cents = $1')) {
            const [balanceCents, a, l, id] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const target = accounts.find(acc => acc.agency_id === a && acc.location_id === l && acc.id === id);
            if (!target) return { rows: [], rowCount: 0 };
            target.balance_cents = Number(balanceCents);
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }
          if (norm.startsWith('SELECT * FROM billing_ledger_entries WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3')) {
            const [a, l, k] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const m = entries.find(e => e.agency_id === a && e.location_id === l && e.idempotency_key === k);
            return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
          }
          if (norm.startsWith('SELECT checksum FROM billing_ledger_entries')) {
            const [a, l, accId] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const filtered = entries.filter(e => e.agency_id === a && e.location_id === l && e.account_id === accId);
            const last = filtered[filtered.length - 1];
            return { rows: last ? [{ checksum: last.checksum }] : [], rowCount: last ? 1 : 0 };
          }
          if (norm.startsWith('SELECT * FROM billing_ledger_entries WHERE agency_id = $1 AND location_id = $2 AND account_id = $3')) {
            const [a, l, accId] = params;
            if (a !== currentAgencyId || l !== currentLocationId) return { rows: [], rowCount: 0 };
            const filtered = entries.filter(e => e.agency_id === a && e.location_id === l && e.account_id === accId);
            return { rows: filtered, rowCount: filtered.length };
          }
          if (norm.startsWith('INSERT INTO billing_ledger_entries')) {
            const [id, agencyId, locationId, accountId, entryType, amountCents, runningBalanceCents, referenceType, referenceId, description, checksum, idempotencyKey] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) throw new Error('RLS violation');
            const row = {
              id, agency_id: agencyId, location_id: locationId, account_id: accountId,
              entry_type: entryType, amount_cents: Number(amountCents), running_balance_cents: Number(runningBalanceCents),
              reference_type: referenceType, reference_id: referenceId, description, checksum, idempotency_key: idempotencyKey,
              created_at: new Date()
            };
            entries.push(row);
            return { rows: [row], rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

test('Money precision & currency validation', () => {
  assert.equal(toCents(0.1) + toCents(0.2), 30);
  assert.equal(toCents('19.99'), 1999);
  assert.equal(fromCents(1999), 19.99);
  assert.throws(() => toCents(-5), { code: 'INVALID_AMOUNT' });
  assert.throws(() => toCents('abc'), { code: 'INVALID_AMOUNT' });
  assert.equal(validateCurrency('usd'), 'USD');
  assert.throws(() => validateCurrency('US'), { code: 'INVALID_CURRENCY' });
});

test('OrdersRepository, PaymentsRepository, InvoicesRepository & LedgerRepository under TenantTx', async () => {
  const pool = createInMemoryCommercePool();
  const ordersRepo = createOrdersRepository();
  const paymentsRepo = createPaymentsRepository();
  const invoicesRepo = createInvoicesRepository();
  const ledgerRepo = createLedgerRepository();

  const tenantA = { agencyId: '11111111-1111-4111-8111-111111111111', locationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId: 'user-a' };
  const tenantB = { agencyId: '22222222-2222-4222-8222-222222222222', locationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', actorId: 'user-b' };

  // 1. Order idempotency & state transitions
  const order1 = await runInTenantTx(pool, tenantA, async (tx) => {
    return ordersRepo.createOrder(tx, {
      amountCents: 15000,
      currency: 'USD',
      contactName: 'Alice',
      idempotencyKey: 'chk_1'
    });
  });
  const order1Dup = await runInTenantTx(pool, tenantA, async (tx) => {
    return ordersRepo.createOrder(tx, {
      amountCents: 15000,
      currency: 'USD',
      contactName: 'Alice',
      idempotencyKey: 'chk_1'
    });
  });
  assert.equal(order1Dup.id, order1.id, 'Duplicate idempotencyKey must return existing order');
  assert.equal(order1.status, 'pending');

  // 2. Payment settlement, duplicate provider event & refund bounds
  const pay1 = await runInTenantTx(pool, tenantA, async (tx) => {
    return paymentsRepo.createPayment(tx, {
      orderId: order1.id,
      amountCents: 15000,
      currency: 'USD',
      idempotencyKey: 'pay_1'
    });
  });
  assert.equal(pay1.status, 'pending');

  const settled = await runInTenantTx(pool, tenantA, async (tx) => {
    return paymentsRepo.recordProviderEvent(tx, {
      paymentId: pay1.id,
      providerPaymentId: 'pi_123',
      providerEventId: 'evt_123',
      status: 'succeeded'
    });
  });
  assert.equal(settled.status, 'succeeded');

  const dupEvt = await runInTenantTx(pool, tenantA, async (tx) => {
    return paymentsRepo.recordProviderEvent(tx, {
      paymentId: pay1.id,
      providerPaymentId: 'pi_123',
      providerEventId: 'evt_123',
      status: 'succeeded'
    });
  });
  assert.equal(dupEvt.deduplicated, true);

  await assert.rejects(
    () => runInTenantTx(pool, tenantA, async (tx) => paymentsRepo.recordRefund(tx, pay1.id, { refundCents: 20000 })),
    { code: 'REFUND_EXCEEDS_AMOUNT' }
  );
  const partialRefund = await runInTenantTx(pool, tenantA, async (tx) => paymentsRepo.recordRefund(tx, pay1.id, { refundCents: 5000 }));
  assert.equal(partialRefund.status, 'partially_refunded');

  // 3. Invoice draft -> issued -> paid
  const inv = await runInTenantTx(pool, tenantA, async (tx) => {
    return invoicesRepo.createInvoice(tx, { orderId: order1.id, amountCents: 15000, currency: 'USD', status: 'draft' });
  });
  const issuedInv = await runInTenantTx(pool, tenantA, async (tx) => invoicesRepo.issueInvoice(tx, inv.id));
  assert.equal(issuedInv.status, 'issued');
  const paidInv = await runInTenantTx(pool, tenantA, async (tx) => invoicesRepo.recordPaymentAllocation(tx, inv.id, { paidCents: 15000, paymentMethod: 'card' }));
  assert.equal(paidInv.status, 'paid');

  // 4. Ledger immutable hash-chain & integrity
  await runInTenantTx(pool, tenantA, async (tx) => {
    await ledgerRepo.recordTransaction(tx, {
      accountType: 'stripe_escrow',
      entryType: 'credit',
      amountCents: 15000,
      referenceType: 'order_payment',
      referenceId: order1.id,
      idempotencyKey: 'led_1'
    });
  });
  const integrity = await runInTenantTx(pool, tenantA, async (tx) => ledgerRepo.verifyAccountIntegrity(tx, { accountType: 'stripe_escrow' }));
  assert.equal(integrity.valid, true);
  assert.equal(integrity.balanceCents, 15000);

  // 5. Cross-tenant isolation
  const foreignOrder = await runInTenantTx(pool, tenantB, async (tx) => ordersRepo.getOrderById(tx, order1.id));
  assert.equal(foreignOrder, null);
});
