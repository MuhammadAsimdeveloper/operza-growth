/**
 * Provider adapters that are not yet backed by a live provider API deliberately
 * fail closed. A well-formed key is not proof of account ownership or delivery.
 */
function unavailable(provider, operation) {
  return {
    ok: false,
    verified: false,
    error: `A live ${provider} ${operation} adapter is not configured.`,
    code: 'PROVIDER_ADAPTER_UNAVAILABLE'
  };
}

function invalidSecret(message) {
  return { verified: false, error: message, code: 'INVALID_PROVIDER_CREDENTIAL' };
}

export const resendEmailAdapter = Object.freeze({
  id: 'adapter-resend-email-v1',
  providerKey: 'email.resend',
  channel: 'email',
  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || !secret.startsWith('re_') || secret.length < 12) {
      return invalidSecret('Invalid Resend API key format');
    }
    if (config.senderEmail && !config.senderEmail.includes('@')) {
      return invalidSecret('Invalid sender email address in config');
    }
    return unavailable('Resend', 'verification');
  },
  async dispatch({ consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return unavailable('Resend', 'send');
  }
});

export const sendgridEmailAdapter = Object.freeze({
  id: 'adapter-sendgrid-email-v3',
  providerKey: 'email.sendgrid',
  channel: 'email',
  async verify({ secret } = {}) {
    if (typeof secret !== 'string' || !secret.startsWith('SG.') || secret.length < 16) {
      return invalidSecret('Invalid SendGrid API key format');
    }
    return unavailable('SendGrid', 'verification');
  },
  async dispatch({ consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return unavailable('SendGrid', 'send');
  }
});

export const twilioSmsAdapter = Object.freeze({
  id: 'adapter-twilio-sms-v1',
  providerKey: 'sms.twilio',
  channel: 'sms',
  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || secret.length < 16) {
      return invalidSecret('Twilio Auth Token must be at least 16 characters');
    }
    if (config.accountId && !config.accountId.startsWith('AC')) {
      return invalidSecret('Twilio Account SID must start with AC');
    }
    return unavailable('Twilio', 'verification');
  },
  async dispatch({ consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return unavailable('Twilio', 'send');
  }
});

export const whatsappMetaAdapter = Object.freeze({
  id: 'adapter-whatsapp-meta-v21',
  providerKey: 'whatsapp.meta_cloud',
  channel: 'whatsapp',
  async verify({ secret, config = {} } = {}) {
    if (typeof secret !== 'string' || secret.length < 20) {
      return invalidSecret('Meta System User Token must be at least 20 characters');
    }
    if (config.phoneNumberId && config.phoneNumberId.length < 5) {
      return invalidSecret('Invalid WhatsApp Phone Number ID');
    }
    return unavailable('Meta WhatsApp', 'verification');
  },
  async dispatch({ consent } = {}) {
    if (!consent || consent.status !== 'granted') {
      return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
    }
    return unavailable('Meta WhatsApp', 'send');
  }
});

export const stripePaymentAdapter = Object.freeze({
  id: 'adapter-stripe-payments-v1',
  providerKey: 'payments.stripe',
  channel: 'payments',
  async verify({ secret } = {}) {
    if (typeof secret !== 'string' || (!secret.startsWith('sk_') && !secret.startsWith('rk_')) || secret.length < 20) {
      return invalidSecret('Invalid Stripe secret key format');
    }
    return unavailable('Stripe', 'verification');
  },
  async dispatch() {
    return {
      ok: false,
      error: 'Stripe payment execution remains disabled pending payment, refund and reconciliation controls.',
      code: 'PAYMENTS_DISABLED'
    };
  }
});

export function createProviderAdapterRegistry(customAdapters = []) {
  const adapters = new Map([
    [resendEmailAdapter.providerKey, resendEmailAdapter],
    [sendgridEmailAdapter.providerKey, sendgridEmailAdapter],
    [twilioSmsAdapter.providerKey, twilioSmsAdapter],
    [whatsappMetaAdapter.providerKey, whatsappMetaAdapter],
    [stripePaymentAdapter.providerKey, stripePaymentAdapter]
  ]);

  for (const adapter of customAdapters) {
    if (adapter?.providerKey) adapters.set(adapter.providerKey, adapter);
  }

  return {
    get(providerKey) { return adapters.get(providerKey) || null; },
    has(providerKey) { return adapters.has(providerKey); },
    list() { return Array.from(adapters.values()); }
  };
}
