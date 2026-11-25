/**
 * ============================================================================
 * Operza Payments, Orders, Invoices & Ledger Router — TenantTx Boundary
 * ============================================================================
 * Handles:
 * 1. Public Payment Links & Checkout: GET /api/payments/public/:slugOrId, POST /api/payments/checkout/:slugOrId
 * 2. Client Portal Invoice Payment: POST /api/portal/invoices/:id/pay
 * 3. Stripe Webhook Ingress: POST /api/webhooks/stripe
 * 4. CRM Orders, Invoices, Payments & Ledger: /api/crm/orders*, /api/orders*,
 *    /api/crm/invoices*, /api/invoices*, /api/crm/payments*, /api/payments*, /api/ledger/*
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createOrdersRepository } from '../../../packages/db/lib/orders-repository.mjs';
import { createPaymentsRepository } from '../../../packages/db/lib/payments-repository.mjs';
import { createInvoicesRepository } from '../../../packages/db/lib/invoices-repository.mjs';
import { createLedgerRepository } from '../../../packages/db/lib/ledger-repository.mjs';
import { createDunningRepository } from '../../../packages/db/lib/dunning-repository.mjs';
import { generateInvoicePdf } from '../../../packages/db/lib/invoice-pdf.mjs';
import { createContactsRepository } from '../../../packages/db/lib/contacts-repository.mjs';
import { createOpportunitiesRepository } from '../../../packages/db/lib/opportunities-repository.mjs';
import { toCents, fromCents, validateCurrency } from '../../../packages/db/lib/money.mjs';

const ordersRepo = createOrdersRepository();
const paymentsRepo = createPaymentsRepository();
const invoicesRepo = createInvoicesRepository();
const ledgerRepo = createLedgerRepository();
const dunningRepo = createDunningRepository();
const contactsRepo = createContactsRepository();
const opportunitiesRepo = createOpportunitiesRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handlePaymentsRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    readBody,
    readRawBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    actor,
    agency,
    activeLocation,
    pgPool,
    triggerWorkflowExecution,
    isWebhookReplay,
    logStructured
  } = ctx;

  const isPublicRoute =
    pathname.startsWith('/api/payments/public/') ||
    pathname.startsWith('/api/payments/checkout/') ||
    (pathname.startsWith('/api/portal/invoices/') && pathname.endsWith('/pay')) ||
    pathname === '/api/webhooks/stripe';

  const isAuthFinancialRoute =
    pathname === '/api/crm/orders' || pathname.startsWith('/api/crm/orders/') ||
    pathname === '/api/orders' || pathname.startsWith('/api/orders/') ||
    pathname === '/api/crm/invoices' || pathname.startsWith('/api/crm/invoices/') ||
    pathname === '/api/invoices' || pathname.startsWith('/api/invoices/') ||
    pathname === '/api/crm/payments' || pathname.startsWith('/api/crm/payments/') ||
    pathname === '/api/payments' || pathname.startsWith('/api/payments/') ||
    pathname.startsWith('/api/ledger/');

  if (!isPublicRoute && !isAuthFinancialRoute) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);

  // ═════════════════════════════════════════════════════════════════════════
  // 1. PUBLIC PAYMENT LINK LOOKUP & CHECKOUT
  // ═════════════════════════════════════════════════════════════════════════

  if (method === 'GET' && pathname.startsWith('/api/payments/public/')) {
    const slugOrId = pathname.replace('/api/payments/public/', '').trim();
    const links = state.records.paymentLinks || [];
    const link = links.find(l => (l.slug === slugOrId || l.id === slugOrId) && l.active !== false);
    if (!link) {
      sendJson(res, 404, { error: 'Payment link not found or inactive' });
      return true;
    }

    link.visits = (link.visits || 0) + 1;
    await saveState();

    const products = (state.records.products || []).filter(p => (link.productIds || []).includes(p.id));
    sendJson(res, 200, {
      id: link.id,
      name: link.name,
      slug: link.slug,
      amount: link.amount,
      currency: link.currency || 'USD',
      description: link.description || '',
      active: link.active,
      visits: link.visits,
      products
    });
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/api/payments/checkout/')) {
    const slugOrId = pathname.replace('/api/payments/checkout/', '').trim();
    const links = state.records.paymentLinks || [];
    const link = links.find(l => (l.slug === slugOrId || l.id === slugOrId) && l.active !== false);
    if (!link) {
      sendJson(res, 404, { error: 'Payment link not found or inactive' });
      return true;
    }

    const body = await readBody(req);
    if (body.website || body.hp || body.company_fax) {
      sendJson(res, 400, { error: 'Bot submission rejected', code: 'BOT_SUBMISSION_REJECTED' });
      return true;
    }
    const { customerName, customerEmail, customerPhone } = body || {};
    if (!customerName || !customerEmail) {
      sendJson(res, 400, { error: 'Customer name and email are required.' });
      return true;
    }

    const emailKey = String(customerEmail).toLowerCase().trim();
    const nameParts = String(customerName).trim().split(/\s+/);
    const firstName = nameParts[0] || 'Valued';
    const lastName = nameParts.slice(1).join(' ') || 'Customer';

    const linkAmountCents = toCents(link.amount || 0);
    let discountCents = 0;
    let appliedCoupon = null;
    if (body.couponCode) {
      const cCode = String(body.couponCode).trim().toUpperCase();
      state.records.coupons = state.records.coupons || [];
      appliedCoupon = state.records.coupons.find(c =>
        c.agencyId === link.agencyId && c.code && c.code.toUpperCase() === cCode && c.active !== false
      );
      if (appliedCoupon) {
        const isExpired = appliedCoupon.expiresAt && new Date(appliedCoupon.expiresAt).getTime() < Date.now();
        const isExhausted = appliedCoupon.maxRedemptions !== null && appliedCoupon.maxRedemptions !== undefined && appliedCoupon.redemptions >= appliedCoupon.maxRedemptions;
        if (!isExpired && !isExhausted) {
          if (appliedCoupon.kind === 'percent') {
            discountCents = Math.round((linkAmountCents * Number(appliedCoupon.amount)) / 100);
          } else {
            discountCents = Math.min(toCents(appliedCoupon.amount), linkAmountCents);
          }
          appliedCoupon.redemptions = (appliedCoupon.redemptions || 0) + 1;
        }
      }
    }
    const finalAmountCents = Math.max(0, linkAmountCents - discountCents);
    const finalAmount = fromCents(finalAmountCents);
    const discountAmount = fromCents(discountCents);

    if (finalAmountCents > 0) {
      const { cardNumber, expiry, cvc, paymentMethodId, paymentToken } = body;
      const hasCard = Boolean(cardNumber && expiry && cvc);
      const hasToken = Boolean(paymentMethodId || paymentToken);

      if (!hasCard && !hasToken) {
        sendJson(res, 400, {
          error: 'Payment method is required for non-zero checkout. Please provide card details or a payment token.',
          code: 'PAYMENT_METHOD_REQUIRED'
        });
        return true;
      }
      if (hasCard) {
        const cleanCard = String(cardNumber).replace(/[\s-]/g, '');
        if (!/^\d{13,19}$/.test(cleanCard)) {
          sendJson(res, 400, { error: 'Invalid card number format.', code: 'INVALID_CARD_NUMBER' });
          return true;
        }
        if (!/^\d{1,2}\/\d{2,4}$/.test(String(expiry).trim())) {
          sendJson(res, 400, { error: 'Invalid expiry format (expected MM/YY).', code: 'INVALID_CARD_EXPIRY' });
          return true;
        }
        if (!/^\d{3,4}$/.test(String(cvc).trim())) {
          sendJson(res, 400, { error: 'Invalid CVC security code.', code: 'INVALID_CARD_CVC' });
          return true;
        }
      }
      if (process.env.NODE_ENV === 'production' && !process.env.STRIPE_SECRET_KEY && !process.env.TEST_PAYMENT_GATEWAY) {
        sendJson(res, 503, {
          error: 'Payment processing gateway is not configured for this merchant.',
          code: 'PAYMENTS_NOT_CONFIGURED'
        });
        return true;
      }
    }

    const currency = validateCurrency(link.currency || 'USD');
    const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey || null;
    const isSimulatedGateway = !process.env.STRIPE_SECRET_KEY;

    if (pgPool) {
      const txResult = await runInTenantTx(pgPool, {
        agencyId: link.agencyId,
        locationId: link.locationId,
        actorId: 'public_checkout'
      }, async (tx) => {
        const existingContacts = await contactsRepo.list(tx, { search: emailKey, limit: 10 });
        let contact = existingContacts.contacts.find(c => c.email === emailKey);
        if (!contact) {
          contact = await contactsRepo.create(tx, {
            firstName,
            lastName,
            email: emailKey,
            phone: customerPhone || '',
            source: `Checkout: ${link.name}`,
            tags: ['customer', 'paid-checkout', link.slug || 'checkout'],
            status: 'customer'
          });
        } else {
          const nextTags = Array.from(new Set([...(contact.tags || []), 'customer', 'paid-checkout']));
          contact = await contactsRepo.update(tx, contact.id, { status: 'customer', tags: nextTags });
        }

        const order = await ordersRepo.createOrder(tx, {
          contactId: contact.id,
          paymentLinkId: link.id,
          contactName: `${firstName} ${lastName}`,
          amountCents: finalAmountCents,
          originalAmountCents: linkAmountCents,
          discountCents,
          currency,
          status: finalAmountCents === 0 || isSimulatedGateway ? 'paid' : 'pending',
          couponCode: appliedCoupon ? appliedCoupon.code : undefined,
          idempotencyKey,
          items: [{ name: link.name, amount: finalAmount, quantity: 1 }],
          source: `Checkout: ${link.name}`
        });

        const invoice = await invoicesRepo.createInvoice(tx, {
          orderId: order.id,
          contactId: contact.id,
          contactName: `${firstName} ${lastName}`,
          amountCents: finalAmountCents,
          currency,
          status: order.status === 'paid' ? 'paid' : 'issued',
          description: `Payment for ${link.name}${appliedCoupon ? ` (Discount coupon ${appliedCoupon.code})` : ''}`
        });

        const payment = await paymentsRepo.createPayment(tx, {
          orderId: order.id,
          invoiceId: invoice.id,
          contactId: contact.id,
          amountCents: finalAmountCents,
          currency,
          status: order.status === 'paid' ? 'succeeded' : 'pending',
          provider: isSimulatedGateway ? 'simulated' : 'stripe',
          idempotencyKey: idempotencyKey ? `pay_${idempotencyKey}` : null,
          method: 'card'
        });

        if (order.status === 'paid' && finalAmountCents > 0) {
          await ledgerRepo.recordTransaction(tx, {
            accountType: 'stripe_escrow',
            entryType: 'credit',
            amountCents: finalAmountCents,
            referenceType: 'order_payment',
            referenceId: order.id,
            description: `Checkout payment for ${link.name}`,
            idempotencyKey: `led_${order.id}`,
            currency
          });
        }

        return { contact, order, invoice, payment };
      });

      const token = `tok_${randomBytes(12).toString('hex')}`;
      broadcast('crm.order.created', { id: txResult.order.id, amount: txResult.order.amount, customerName: txResult.order.contactName });
      broadcast('crm.invoice.created', { id: txResult.invoice.id, number: txResult.invoice.number, amount: txResult.invoice.amount, status: txResult.invoice.status });

      if (triggerWorkflowExecution) {
        triggerWorkflowExecution({
          agencyId: link.agencyId,
          locationId: link.locationId,
          triggerType: 'payment',
          triggerContext: { link, order: txResult.order, invoice: txResult.invoice, contact: txResult.contact }
        }).catch(err => console.error('Payment workflow trigger failed:', err));
      }

      sendJson(res, 201, {
        success: true,
        message: 'Payment processed successfully.',
        order: { ...txResult.order, paymentToken: token, canOneClickUpsell: true },
        invoice: txResult.invoice,
        contact: txResult.contact,
        payment: txResult.payment,
        paymentToken: token
      });
      return true;
    }

    // In-memory fallback (!pgPool)
    let contact = (state.records.contacts || []).find(
      c => c.agencyId === link.agencyId && c.locationId === link.locationId && c.email === emailKey
    );
    if (!contact) {
      contact = {
        id: randomUUID(),
        agencyId: link.agencyId,
        locationId: link.locationId,
        firstName,
        lastName,
        email: emailKey,
        phone: customerPhone || '',
        source: `Checkout: ${link.name}`,
        tags: ['customer', 'paid-checkout', link.slug || 'checkout'],
        status: 'customer',
        createdAt: new Date().toISOString()
      };
      state.records.contacts = state.records.contacts || [];
      state.records.contacts.push(contact);
    } else {
      contact.status = 'customer';
      contact.tags = contact.tags || [];
      if (!contact.tags.includes('customer')) contact.tags.push('customer');
      if (!contact.tags.includes('paid-checkout')) contact.tags.push('paid-checkout');
      if (customerPhone && !contact.phone) contact.phone = customerPhone;
    }

    const orderId = randomUUID();
    const order = {
      id: orderId,
      agencyId: link.agencyId,
      locationId: link.locationId,
      orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
      contactId: contact.id,
      contactName: `${firstName} ${lastName}`,
      amount: finalAmount,
      amountCents: finalAmountCents,
      originalAmount: link.amount,
      discount: discountAmount,
      couponCode: appliedCoupon ? appliedCoupon.code : undefined,
      currency,
      status: 'paid',
      paymentLinkId: link.id,
      items: [{ name: link.name, amount: finalAmount, quantity: 1 }],
      paymentToken: `tok_${randomBytes(12).toString('hex')}`,
      canOneClickUpsell: true,
      paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    state.records.orders = state.records.orders || [];
    state.records.orders.push(order);

    const invoiceId = randomUUID();
    const invoice = {
      id: invoiceId,
      agencyId: link.agencyId,
      locationId: link.locationId,
      number: `INV-${Date.now().toString().slice(-6)}`,
      contactId: contact.id,
      contactName: `${firstName} ${lastName}`,
      amount: finalAmount,
      amountCents: finalAmountCents,
      currency,
      status: 'paid',
      dueDate: new Date().toISOString().split('T')[0],
      description: `Payment for ${link.name}${appliedCoupon ? ` (Discount coupon ${appliedCoupon.code})` : ''}`,
      createdAt: new Date().toISOString()
    };
    state.records.invoices = state.records.invoices || [];
    state.records.invoices.push(invoice);

    const opp = (state.records.opportunities || []).find(o => o.contactId === contact.id && o.status === 'open');
    if (opp) {
      opp.stage = 'Won';
      opp.status = 'won';
      opp.value = (opp.value || 0) + link.amount;
      broadcast('crm.opportunity.updated', { id: opp.id, stage: 'Won', status: 'won', value: opp.value });
    }

    link.conversions = (link.conversions || 0) + 1;
    await saveState();

    broadcast('crm.order.created', { id: orderId, amount: order.amount, customerName: order.contactName });
    broadcast('crm.invoice.created', { id: invoiceId, number: invoice.number, amount: invoice.amount, status: 'paid' });

    if (triggerWorkflowExecution) {
      triggerWorkflowExecution({
        agencyId: link.agencyId,
        locationId: link.locationId,
        triggerType: 'payment',
        triggerContext: { link, order, invoice, contact }
      }).catch(err => console.error('Payment workflow trigger failed:', err));
    }

    sendJson(res, 201, {
      success: true,
      message: 'Payment processed successfully.',
      order,
      invoice,
      contact,
      paymentToken: order.paymentToken
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. CLIENT PORTAL INVOICE PAYMENT
  // ═════════════════════════════════════════════════════════════════════════

  if (method === 'POST' && pathname.startsWith('/api/portal/invoices/') && pathname.endsWith('/pay')) {
    const invoiceId = pathname.replace('/api/portal/invoices/', '').replace('/pay', '').trim();
    const body = await readBody(req);

    if (pgPool) {
      const lookupRes = await pgPool.query(
        `SELECT agency_id, location_id FROM invoices WHERE id = $1 LIMIT 1`,
        [invoiceId]
      );
      if (lookupRes.rows.length === 0) {
        sendJson(res, 404, { error: 'Invoice not found' });
        return true;
      }
      const { agency_id: agId, location_id: locId } = lookupRes.rows[0];
      const result = await runInTenantTx(pgPool, { agencyId: agId, locationId: locId, actorId: 'portal_client' }, async (tx) => {
        const inv = await invoicesRepo.getInvoiceById(tx, invoiceId);
        if (!inv) return null;
        const paidInv = await invoicesRepo.recordPaymentAllocation(tx, invoiceId, {
          paidCents: inv.amountCents - inv.paidCents,
          paymentMethod: body?.paymentMethod || 'card'
        });
        const order = await ordersRepo.createOrder(tx, {
          invoiceId: inv.id,
          contactId: inv.contactId,
          contactName: inv.contactName || 'Portal Client',
          amountCents: inv.amountCents,
          currency: inv.currency,
          status: 'completed',
          source: 'Client Portal Checkout'
        });
        const payment = await paymentsRepo.createPayment(tx, {
          orderId: order.id,
          invoiceId: inv.id,
          contactId: inv.contactId,
          amountCents: inv.amountCents,
          currency: inv.currency,
          status: 'succeeded',
          provider: 'simulated',
          method: body?.paymentMethod || 'card'
        });
        if (inv.amountCents > 0) {
          await ledgerRepo.recordTransaction(tx, {
            accountType: 'stripe_escrow',
            entryType: 'credit',
            amountCents: inv.amountCents,
            referenceType: 'invoice_payment',
            referenceId: inv.id,
            description: `Portal payment for invoice ${inv.number}`,
            idempotencyKey: `led_inv_${inv.id}`,
            currency: inv.currency
          });
        }
        return { invoice: paidInv, order, payment };
      });
      if (!result) {
        sendJson(res, 404, { error: 'Invoice not found' });
        return true;
      }
      broadcast('invoice.paid', { invoiceId: result.invoice.id, status: 'paid', amount: result.invoice.amount });
      broadcast('order.created', result.order);
      sendJson(res, 200, { success: true, invoice: result.invoice, order: result.order });
      return true;
    }

    state.records.invoices = state.records.invoices || [];
    const invoice = state.records.invoices.find(i => i.id === invoiceId);
    if (!invoice) {
      sendJson(res, 404, { error: 'Invoice not found' });
      return true;
    }

    invoice.status = 'paid';
    invoice.paidAt = new Date().toISOString();
    invoice.paymentMethod = body.paymentMethod || 'card';

    state.records.orders = state.records.orders || [];
    const order = {
      id: randomUUID(),
      orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
      invoiceId: invoice.id,
      contactId: invoice.contactId || null,
      contactName: invoice.contactName || 'Portal Client',
      amount: invoice.amount || 0,
      currency: invoice.currency || 'USD',
      status: 'completed',
      paidAt: invoice.paidAt,
      source: 'Client Portal Checkout'
    };
    state.records.orders.unshift(order);

    await saveState();
    broadcast('invoice.paid', { invoiceId: invoice.id, status: 'paid', amount: invoice.amount });
    broadcast('order.created', order);

    sendJson(res, 200, { success: true, invoice, order });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. STRIPE WEBHOOK INGRESS (SIGNATURE-GATED & IDEMPOTENT)
  // ═════════════════════════════════════════════════════════════════════════

  if (method === 'POST' && pathname === '/api/webhooks/stripe') {
    const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    const rawBody = await readRawBody(req);
    const sigHeader = req.headers['stripe-signature'] || '';

    if (stripeSecret && sigHeader) {
      const elements = Object.fromEntries(sigHeader.split(',').map(p => { const [k, v] = p.split('='); return [k, v]; }));
      if (elements.t) {
        const timestampSec = Number(elements.t);
        const currentSec = Math.floor(Date.now() / 1000);
        if (Math.abs(currentSec - timestampSec) > 300) {
          sendJson(res, 400, { error: 'Webhook timestamp expired or outside tolerance window' });
          return true;
        }
      }
      const signedPayload = `${elements.t || ''}.${rawBody.toString('utf8')}`;
      const expectedSig = createHmac('sha256', stripeSecret).update(signedPayload).digest('hex');
      if (!elements.v1 || !safeEqual(expectedSig, elements.v1)) {
        sendJson(res, 400, { error: 'Invalid webhook signature' });
        return true;
      }
    } else if (stripeSecret) {
      sendJson(res, 400, { error: 'Missing stripe-signature header' });
      return true;
    } else {
      if (process.env.NODE_ENV === 'production' || process.env.WEBHOOKS_FAIL_CLOSED === 'true') {
        sendJson(res, 503, { error: 'Stripe webhook secret is not configured in production environment', code: 'WEBHOOK_SECRET_REQUIRED' });
        return true;
      }
      console.warn('[STRIPE WEBHOOK] No STRIPE_WEBHOOK_SECRET configured — skipping signature check');
    }

    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch {
      sendJson(res, 400, { error: 'Invalid JSON' });
      return true;
    }

    if (event.id && isWebhookReplay && isWebhookReplay(`stripe:${event.id}`)) {
      if (logStructured) logStructured('WARN', 'Duplicate Stripe webhook event detected and safely skipped', { eventId: event.id });
      sendJson(res, 200, { received: true, deduplicated: true });
      return true;
    }

    const eventType = event.type || 'unknown';
    console.log(`[STRIPE WEBHOOK] Received event: ${eventType} | id: ${event.id || 'N/A'}`);
    auditLog('webhook.stripe', null, { eventType, eventId: event.id });

    // Reconcile persisted payment if pgPool is active and metadata contains paymentId + tenant context
    const meta = event.data?.object?.metadata || {};
    if (pgPool && meta.paymentId && meta.agencyId && meta.locationId && ['payment_intent.succeeded', 'payment_intent.payment_failed'].includes(eventType)) {
      const targetStatus = eventType === 'payment_intent.succeeded' ? 'succeeded' : 'failed';
      await runInTenantTx(pgPool, { agencyId: meta.agencyId, locationId: meta.locationId, actorId: 'stripe_webhook' }, async (tx) => {
        const updated = await paymentsRepo.recordProviderEvent(tx, {
          paymentId: meta.paymentId,
          providerPaymentId: event.data.object.id,
          providerEventId: event.id,
          status: targetStatus,
          failureCode: event.data.object.last_payment_error?.code || null,
          failureMessage: event.data.object.last_payment_error?.message || null
        });
        if (updated && !updated.deduplicated && targetStatus === 'succeeded' && updated.orderId) {
          await ordersRepo.transitionStatus(tx, updated.orderId, 'paid').catch(() => {});
          if (updated.amountCents > 0) {
            await ledgerRepo.recordTransaction(tx, {
              accountType: 'stripe_escrow',
              entryType: 'credit',
              amountCents: updated.amountCents,
              referenceType: 'stripe_topup',
              referenceId: updated.id,
              description: `Stripe webhook ${event.id}`,
              idempotencyKey: `led_wh_${event.id}`,
              currency: updated.currency
            });
          }
        }
      });
    }

    switch (eventType) {
      case 'invoice.paid':
        broadcast('webhook.stripe.invoice_paid', { invoiceId: event.data?.object?.id });
        break;
      case 'payment_intent.succeeded':
        broadcast('webhook.stripe.payment_succeeded', { paymentIntentId: event.data?.object?.id });
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        broadcast('webhook.stripe.subscription', { type: eventType, subscriptionId: event.data?.object?.id });
        break;
      default:
        break;
    }

    sendJson(res, 200, { received: true });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. AUTHENTICATED TENANT FINANCIAL ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════════

  const tenantCtx = (agency && activeLocation) ? {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.user?.id || actor?.keyId || 'system'
  } : null;

  if (!tenantCtx || !tenantCtx.agencyId || !tenantCtx.locationId) {
    sendJson(res, 400, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
    return true;
  }

  // --- ORDERS ---
  if (pathname === '/api/crm/orders' || pathname === '/api/orders' || pathname.startsWith('/api/crm/orders/') || pathname.startsWith('/api/orders/')) {
    const isList = pathname === '/api/crm/orders' || pathname === '/api/orders';
    const orderId = isList ? null : pathname.replace(/^\/api\/(crm\/)?orders\//, '').trim();

    if (method === 'GET' && isList) {
      if (!checkScope(actor, 'orders:read', ['payments:read'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'orders:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        const list = await runInTenantTx(pgPool, tenantCtx, tx => ordersRepo.listOrders(tx, {
          status: queryUrl.searchParams.get('status'),
          contactId: queryUrl.searchParams.get('contactId')
        }));
        sendJson(res, 200, { data: list, count: list.length });
        return true;
      }
      const list = (state.records.orders || []).filter(o => o.agencyId === agency.id && (!o.locationId || o.locationId === activeLocation.id));
      sendJson(res, 200, { data: list, count: list.length });
      return true;
    }

    if (method === 'POST' && isList) {
      if (!checkScope(actor, 'orders:write', ['payments:write'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'orders:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const body = await readBody(req);
      const { agencyId: _a, locationId: _l, status: _ignoredStatus, ...sanitized } = body || {};
      if (pgPool) {
        try {
          const created = await runInTenantTx(pgPool, tenantCtx, tx => ordersRepo.createOrder(tx, {
            ...sanitized,
            status: 'pending',
            idempotencyKey: req.headers['idempotency-key'] || sanitized.idempotencyKey
          }));
          sendJson(res, 201, created);
        } catch (err) {
          sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_ORDER' });
        }
        return true;
      }
      state.records.orders = state.records.orders || [];
      const created = {
        ...sanitized,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: activeLocation.id,
        orderNumber: sanitized.orderNumber || `ORD-${Date.now().toString().slice(-6)}`,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      state.records.orders.push(created);
      await saveState();
      sendJson(res, 201, created);
      return true;
    }

    if (method === 'GET' && orderId) {
      if (!checkScope(actor, 'orders:read', ['payments:read'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'orders:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        const found = await runInTenantTx(pgPool, tenantCtx, tx => ordersRepo.getOrderById(tx, orderId));
        if (!found) { sendJson(res, 404, { error: 'Order not found' }); return true; }
        sendJson(res, 200, found);
        return true;
      }
      const found = (state.records.orders || []).find(o => o.id === orderId && o.agencyId === agency.id);
      if (!found) { sendJson(res, 404, { error: 'Order not found' }); return true; }
      sendJson(res, 200, found);
      return true;
    }
  }

  // --- INVOICES ---
  if (pathname === '/api/crm/invoices' || pathname === '/api/invoices' || pathname.startsWith('/api/crm/invoices/') || pathname.startsWith('/api/invoices/')) {
    const isList = pathname === '/api/crm/invoices' || pathname === '/api/invoices';
    const subPath = isList ? '' : pathname.replace(/^\/api\/(crm\/)?invoices\//, '').trim();

    if (method === 'GET' && isList) {
      if (!checkScope(actor, 'invoices:read', ['payments:read'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'invoices:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        const list = await runInTenantTx(pgPool, tenantCtx, tx => invoicesRepo.listInvoices(tx, {
          status: queryUrl.searchParams.get('status'),
          contactId: queryUrl.searchParams.get('contactId')
        }));
        sendJson(res, 200, { data: list, count: list.length });
        return true;
      }
      const list = (state.records.invoices || []).filter(i => i.agencyId === agency.id && (!i.locationId || i.locationId === activeLocation.id));
      sendJson(res, 200, { data: list, count: list.length });
      return true;
    }

    if (method === 'GET' && subPath && subPath.endsWith('/pdf')) {
      if (!checkScope(actor, 'invoices:read', ['payments:read'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'invoices:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const invoiceId = subPath.replace(/\/pdf$/, '').trim();
      let invoice = null;
      if (pgPool) {
        invoice = await runInTenantTx(pgPool, tenantCtx, tx => invoicesRepo.getInvoiceById(tx, invoiceId));
      } else {
        invoice = (state.records.invoices || []).find(
          i => i.id === invoiceId && i.agencyId === agency.id && (!i.locationId || i.locationId === activeLocation.id)
        ) || null;
      }
      if (!invoice) {
        sendJson(res, 404, { error: 'Invoice not found' });
        return true;
      }
      const pdfBuffer = generateInvoicePdf({
        ...invoice,
        agencyName: agency?.name || 'Operza Agency'
      });
      res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${String(invoice.number || invoice.id).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf"`,
        'content-length': String(pdfBuffer.length)
      });
      res.end(pdfBuffer);
      return true;
    }

    if (method === 'POST' && isList) {
      if (!checkScope(actor, 'invoices:write', ['payments:write'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'invoices:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const body = await readBody(req);
      const { agencyId: _a, locationId: _l, ...sanitized } = body || {};
      if (pgPool) {
        try {
          const created = await runInTenantTx(pgPool, tenantCtx, tx => invoicesRepo.createInvoice(tx, {
            ...sanitized,
            status: sanitized.status === 'issued' ? 'issued' : 'draft'
          }));
          sendJson(res, 201, created);
        } catch (err) {
          sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_INVOICE' });
        }
        return true;
      }
      state.records.invoices = state.records.invoices || [];
      const created = {
        ...sanitized,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: activeLocation.id,
        number: sanitized.number || `INV-${Date.now().toString().slice(-6)}`,
        status: sanitized.status === 'issued' ? 'issued' : 'draft',
        createdAt: new Date().toISOString()
      };
      state.records.invoices.push(created);
      await saveState();
      sendJson(res, 201, created);
      return true;
    }

    if (method === 'POST' && subPath.endsWith('/issue')) {
      const invoiceId = subPath.replace('/issue', '').trim();
      if (!checkScope(actor, 'invoices:write', ['payments:write'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'invoices:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        try {
          const issued = await runInTenantTx(pgPool, tenantCtx, tx => invoicesRepo.issueInvoice(tx, invoiceId));
          if (!issued) { sendJson(res, 404, { error: 'Invoice not found' }); return true; }
          sendJson(res, 200, issued);
        } catch (err) {
          sendJson(res, 409, { error: err.message, code: err.code });
        }
        return true;
      }
    }

    if (method === 'POST' && subPath.endsWith('/void')) {
      const invoiceId = subPath.replace('/void', '').trim();
      if (!checkScope(actor, 'invoices:write', ['payments:write'])) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'invoices:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        try {
          const voided = await runInTenantTx(pgPool, tenantCtx, tx => invoicesRepo.voidInvoice(tx, invoiceId));
          if (!voided) { sendJson(res, 404, { error: 'Invoice not found' }); return true; }
          sendJson(res, 200, voided);
        } catch (err) {
          sendJson(res, 409, { error: err.message, code: err.code });
        }
        return true;
      }
    }
  }

  // --- PAYMENTS & REFUNDS ---
  if (pathname === '/api/crm/payments' || pathname === '/api/payments' || pathname.startsWith('/api/crm/payments/') || pathname.startsWith('/api/payments/')) {
    const isList = pathname === '/api/crm/payments' || pathname === '/api/payments';
    const subPath = isList ? '' : pathname.replace(/^\/api\/(crm\/)?payments\//, '').trim();

    if (method === 'GET' && isList) {
      if (!checkScope(actor, 'payments:read')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'payments:read'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (pgPool) {
        const list = await runInTenantTx(pgPool, tenantCtx, tx => paymentsRepo.listPayments(tx, {
          orderId: queryUrl.searchParams.get('orderId'),
          status: queryUrl.searchParams.get('status')
        }));
        sendJson(res, 200, { data: list, count: list.length });
        return true;
      }
      const list = (state.records.payments || []).filter(p => p.agencyId === agency.id && (!p.locationId || p.locationId === activeLocation.id));
      sendJson(res, 200, { data: list, count: list.length });
      return true;
    }

    if (method === 'GET' && pathname === '/api/payments/stripe/status') {
      const stripeKey = process.env.STRIPE_SECRET_KEY || '';
      const mode = stripeKey.startsWith('sk_live_') ? 'production' : (stripeKey.startsWith('sk_test_') ? 'sandbox' : 'not_configured');
      let account = null;
      if (pgPool) {
        account = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          const r = await tx.query(
            'SELECT * FROM stripe_connect_accounts WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC LIMIT 1',
            [agency.id, activeLocation.id]
          );
          return r.rows[0] || null;
        });
      }
      sendJson(res, 200, {
        provider: 'stripe',
        mode,
        status: account?.onboarding_status || (mode === 'not_configured' ? 'not_configured' : `${mode}_connected`),
        chargesEnabled: Boolean(account?.charges_enabled),
        payoutsEnabled: Boolean(account?.payouts_enabled),
        stripeAccountId: account?.stripe_account_id || null
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/payments/dunning/schedule') {
      if (!checkScope(actor, 'payments:write')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'payments:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const body = await readBody(req);
      if (!body?.invoiceId) {
        sendJson(res, 400, { error: 'invoiceId is required' });
        return true;
      }
      if (pgPool) {
        const scheduled = await runInTenantTx(pgPool, tenantCtx, tx => dunningRepo.scheduleRetry(tx, body));
        sendJson(res, scheduled.deduplicated ? 200 : 201, { success: true, ...scheduled });
        return true;
      }
      state.records.dunningAttempts = state.records.dunningAttempts || [];
      const attempt = {
        id: randomUUID(),
        agencyId: agency.id,
        locationId: activeLocation.id,
        invoiceId: body.invoiceId,
        attemptNumber: body.attemptNumber || 1,
        status: 'scheduled',
        failureCode: body.failureCode || null,
        createdAt: new Date().toISOString()
      };
      state.records.dunningAttempts.push(attempt);
      await saveState();
      sendJson(res, 201, { success: true, deduplicated: false, attempt });
      return true;
    }

    if (method === 'POST' && subPath.endsWith('/refund')) {
      const paymentId = subPath.replace('/refund', '').trim();
      if (!checkScope(actor, 'payments:write')) {
        sendJson(res, 403, { error: "Insufficient API key scope. Required: 'payments:write'", code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const body = await readBody(req);
      const refundCents = body?.refundCents !== undefined ? Number(body.refundCents) : toCents(body?.amount ?? 0, { allowZero: false });
      const idempotencyKey = req.headers['idempotency-key'] || body?.idempotencyKey || `ref_${paymentId}_${refundCents}`;

      if (pgPool) {
        try {
          const refunded = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            const p = await paymentsRepo.recordRefund(tx, paymentId, { refundCents });
            if (!p) return null;
            if (p.orderId) {
              await ordersRepo.transitionStatus(tx, p.orderId, p.status === 'refunded' ? 'refunded' : 'partially_refunded').catch(() => {});
            }
            await ledgerRepo.recordTransaction(tx, {
              accountType: 'stripe_escrow',
              entryType: 'debit',
              amountCents: refundCents,
              referenceType: 'refund',
              referenceId: p.id,
              description: `Refund for payment ${p.id}`,
              idempotencyKey,
              currency: p.currency,
              allowOverdraft: true
            });
            return p;
          });
          if (!refunded) { sendJson(res, 404, { error: 'Payment not found' }); return true; }
          auditLog('payment.refunded', actor, { paymentId, refundCents });
          sendJson(res, 200, { success: true, payment: refunded });
        } catch (err) {
          sendJson(res, 409, { error: err.message, code: err.code || 'REFUND_FAILED' });
        }
        return true;
      }
    }
  }

  // --- LEDGER ---
  if (pathname.startsWith('/api/ledger/')) {
    if (!checkScope(actor, 'payments:read', ['billing:read'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'payments:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const accountType = queryUrl.searchParams.get('accountType') || 'credit_balance';

    if (method === 'GET' && pathname === '/api/ledger/accounts') {
      if (pgPool) {
        const account = await runInTenantTx(pgPool, tenantCtx, tx => ledgerRepo.getOrCreateAccount(tx, { accountType }));
        sendJson(res, 200, { account });
        return true;
      }
      sendJson(res, 200, { account: { agencyId: agency.id, locationId: activeLocation.id, accountType, balanceCents: 0, currency: 'USD' } });
      return true;
    }

    if (method === 'GET' && pathname === '/api/ledger/entries') {
      if (pgPool) {
        const entries = await runInTenantTx(pgPool, tenantCtx, tx => ledgerRepo.listEntries(tx, { accountType }));
        sendJson(res, 200, { data: entries, count: entries.length });
        return true;
      }
      sendJson(res, 200, { data: [], count: 0 });
      return true;
    }

    if (method === 'GET' && pathname === '/api/ledger/verify') {
      if (pgPool) {
        const report = await runInTenantTx(pgPool, tenantCtx, tx => ledgerRepo.verifyAccountIntegrity(tx, { accountType }));
        sendJson(res, 200, report);
        return true;
      }
      sendJson(res, 200, { valid: true, entryCount: 0, balanceCents: 0 });
      return true;
    }
  }

  return false;
}
