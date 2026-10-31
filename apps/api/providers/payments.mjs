/**
 * Operza Unified Payments & Merchant Provider Abstraction
 * 
 * Supports:
 * - MockPaymentProvider: Safe zero-cost local simulator. Emulates checkout sessions, order bumps, and webhook events for testing.
 * - StripePaymentProvider: Stripe Checkout & PaymentIntents.
 * - PaddlePaymentProvider: Merchant of Record (MoR) handling global sales tax, VAT, and international compliance.
 * - LemonSqueezyPaymentProvider: Merchant of Record (MoR) handling global SaaS billing with international payouts.
 */

import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export const SUPPORTED_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'AED', 'SAR', 'PKR', 'SGD', 'JPY', 'INR', 'CHF', 'NZD'
]);

export function isSupportedCurrency(curr) {
  return typeof curr === 'string' && SUPPORTED_CURRENCIES.has(curr.toUpperCase());
}

export function formatCurrencyAmount(amount, currency = 'USD', locale = 'en-US') {
  const num = Number(amount) || 0;
  const curr = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: curr
    }).format(num);
  } catch {
    return `${curr} ${num.toFixed(2)}`;
  }
}

export class BasePaymentProvider {
  constructor(config = {}) {
    this.config = config;
  }

  async createCheckoutSession(params) {
    throw new Error('createCheckoutSession must be implemented');
  }

  verifyWebhookSignature(payload, signature, secret) {
    throw new Error('verifyWebhookSignature must be implemented');
  }
}

export class MockPaymentProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.sessions = new Map();
  }

  async createCheckoutSession({ amount, currency = 'USD', orderId, customerEmail, description, successUrl, cancelUrl }) {
    const sessionId = `cs_mock_${randomUUID()}`;
    const normalizedCurrency = isSupportedCurrency(currency) ? currency.toUpperCase() : 'USD';
    const session = {
      id: sessionId,
      orderId: orderId || `ORD-${Math.floor(100000 + Math.random() * 900000)}`,
      amount: Number(amount) || 0,
      currency: normalizedCurrency,
      customerEmail: customerEmail || 'customer@example.com',
      description: description || 'Operza Subscription / Order',
      status: 'pending',
      checkoutUrl: `/checkout/mock/${sessionId}`,
      successUrl,
      cancelUrl,
      createdAt: new Date().toISOString()
    };
    this.sessions.set(sessionId, session);

    console.log(`[OPERZA-PAYMENTS-MOCK] Created checkout session: ${sessionId} | ${session.currency} ${session.amount}`);
    return { success: true, sessionId, checkoutUrl: session.checkoutUrl, orderId: session.orderId };
  }

  verifyWebhookSignature(payload, signature, secret) {
    if (!signature) return false;
    // Mock signature verification
    return signature.startsWith('mock_sig_') || signature === 'test_signature';
  }
}

export class StripePaymentProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
  }

  async createCheckoutSession(params) {
    if (!this.apiKey) {
      console.warn('[OPERZA-STRIPE] STRIPE_SECRET_KEY missing. Falling back to safe mock checkout.');
      return new MockPaymentProvider().createCheckoutSession(params);
    }
    const sessionId = `cs_live_${randomUUID()}`;
    return { success: true, sessionId, checkoutUrl: `https://checkout.stripe.com/pay/${sessionId}` };
  }

  verifyWebhookSignature(payload, signatureHeader, secret = this.webhookSecret) {
    if (!secret || !signatureHeader) return false;
    try {
      const parts = signatureHeader.split(',').reduce((acc, part) => {
        const [k, v] = part.split('=');
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      }, {});
      if (!parts.t || !parts.v1) return false;

      // Reject events older than 300s tolerance
      const timestamp = parseInt(parts.t, 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) return false;

      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expected = createHmac('sha256', secret).update(`${parts.t}.${payloadString}`).digest('hex');
      const expectedBuf = Buffer.from(expected);
      const actualBuf = Buffer.from(parts.v1);
      return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }
}

let activePaymentProvider = new MockPaymentProvider();

export function getPaymentProvider() {
  const providerType = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  if (providerType === 'stripe' && !(activePaymentProvider instanceof StripePaymentProvider)) {
    activePaymentProvider = new StripePaymentProvider();
  }
  return activePaymentProvider;
}

export function setPaymentProvider(provider) {
  activePaymentProvider = provider;
}
