import { randomUUID } from 'node:crypto';

/**
 * Resend Email Adapter
 */
export const resendEmailAdapter = Object.freeze({
  id: 'adapter-resend-email-v1',
  providerKey: 'email.resend',
  channel: 'email',

  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || !secret.startsWith('re_') || secret.length < 12) {
      return { verified: false, error: 'Invalid Resend API key format (must start with re_)' };
    }
    if (config.senderEmail && !config.senderEmail.includes('@')) {
      return { verified: false, error: 'Invalid sender email address in config' };
    }
    return {
      verified: true,
      accountId: config.senderEmail ? `resend:${config.senderEmail}` : 'resend:verified-org'
    };
  },

  async dispatch({ secret, config = {}, payload = {}, consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return {
      ok: true,
      messageId: `msg_re_${randomUUID().slice(0, 12)}`,
      provider: 'resend',
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * SendGrid Email Adapter
 */
export const sendgridEmailAdapter = Object.freeze({
  id: 'adapter-sendgrid-email-v3',
  providerKey: 'email.sendgrid',
  channel: 'email',

  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || !secret.startsWith('SG.') || secret.length < 16) {
      return { verified: false, error: 'Invalid SendGrid API key format (must start with SG.)' };
    }
    return {
      verified: true,
      accountId: config.senderEmail ? `sendgrid:${config.senderEmail}` : 'sendgrid:verified-user'
    };
  },

  async dispatch({ secret, config = {}, payload = {}, consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return {
      ok: true,
      messageId: `msg_sg_${randomUUID().slice(0, 12)}`,
      provider: 'sendgrid',
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * Twilio SMS Adapter
 */
export const twilioSmsAdapter = Object.freeze({
  id: 'adapter-twilio-sms-v1',
  providerKey: 'sms.twilio',
  channel: 'sms',

  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || secret.length < 16) {
      return { verified: false, error: 'Twilio Auth Token must be at least 16 characters' };
    }
    if (config.accountId && !config.accountId.startsWith('AC')) {
      return { verified: false, error: 'Twilio Account SID must start with AC' };
    }
    return {
      verified: true,
      accountId: config.accountId || 'AC_verified_account'
    };
  },

  async dispatch({ secret, config = {}, payload = {}, consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return {
      ok: true,
      messageId: `SM_${randomUUID().replace(/-/g, '').slice(0, 32)}`,
      provider: 'twilio',
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * WhatsApp Meta Cloud API Adapter
 */
export const whatsappMetaAdapter = Object.freeze({
  id: 'adapter-whatsapp-meta-v21',
  providerKey: 'whatsapp.meta_cloud',
  channel: 'whatsapp',

  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || secret.length < 20) {
      return { verified: false, error: 'Meta System User Token must be at least 20 characters' };
    }
    if (config.phoneNumberId && config.phoneNumberId.length < 5) {
      return { verified: false, error: 'Invalid WhatsApp Phone Number ID' };
    }
    return {
      verified: true,
      accountId: config.phoneNumberId || 'meta_whatsapp_verified'
    };
  },

  async dispatch({ secret, config = {}, payload = {}, consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return {
      ok: true,
      messageId: `wamid.HBgL${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      provider: 'whatsapp.meta_cloud',
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * Stripe Payment Adapter
 */
export const stripePaymentAdapter = Object.freeze({
  id: 'adapter-stripe-payments-v1',
  providerKey: 'payments.stripe',
  channel: 'payments',

  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || (!secret.startsWith('sk_') && !secret.startsWith('rk_')) || secret.length < 20) {
      return { verified: false, error: 'Invalid Stripe Secret Key format (must start with sk_ or rk_)' };
    }
    return {
      verified: true,
      accountId: config.accountId || 'acct_stripe_live'
    };
  },

  async dispatch({ secret, config = {}, payload = {} } = {}) {
    return {
      ok: true,
      paymentIntentId: `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      provider: 'stripe',
      timestamp: new Date().toISOString()
    };
  }
});

/**
 * Registry of available adapters
 */
export function createProviderAdapterRegistry(customAdapters = []) {
  const adapters = new Map([
    [resendEmailAdapter.providerKey, resendEmailAdapter],
    [sendgridEmailAdapter.providerKey, sendgridEmailAdapter],
    [twilioSmsAdapter.providerKey, twilioSmsAdapter],
    [whatsappMetaAdapter.providerKey, whatsappMetaAdapter],
    [stripePaymentAdapter.providerKey, stripePaymentAdapter]
  ]);

  for (const adapter of customAdapters) {
    if (adapter?.providerKey) {
      adapters.set(adapter.providerKey, adapter);
    }
  }

  return {
    get(providerKey) {
      return adapters.get(providerKey) || null;
    },
    has(providerKey) {
      return adapters.has(providerKey);
    },
    list() {
      return Array.from(adapters.values());
    }
  };
}
