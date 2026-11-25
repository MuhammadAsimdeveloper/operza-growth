/**
 * ============================================================================
 * Operza Decimal-Safe Money & Currency Utilities
 * ============================================================================
 * Converts major-unit amounts into exact integer minor units (cents) without
 * binary floating-point drift, and validates ISO-4217 currency codes.
 */

const CURRENCY_RE = /^[A-Z]{3}$/;

export function validateCurrency(currency = 'USD') {
  const normalized = String(currency || '').trim().toUpperCase();
  if (!CURRENCY_RE.test(normalized)) {
    throw Object.assign(new Error(`Invalid ISO-4217 currency code: "${currency}"`), {
      code: 'INVALID_CURRENCY'
    });
  }
  return normalized;
}

export function toCents(amount, { allowZero = true } = {}) {
  if (amount === null || amount === undefined || amount === '') {
    throw Object.assign(new Error('Amount is required'), { code: 'INVALID_AMOUNT' });
  }
  const str = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw Object.assign(new Error(`Invalid monetary amount: "${amount}"`), { code: 'INVALID_AMOUNT' });
  }
  if (str.startsWith('-')) {
    throw Object.assign(new Error('Monetary amount cannot be negative'), { code: 'INVALID_AMOUNT' });
  }

  const [wholePart, fracPart = ''] = str.split('.');
  const paddedFrac = (fracPart + '00').slice(0, 2);
  const nextDigit = fracPart.length > 2 ? Number(fracPart[2]) : 0;
  let cents = Number(wholePart) * 100 + Number(paddedFrac);
  if (nextDigit >= 5) cents += 1;

  if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) {
    throw Object.assign(new Error('Monetary amount out of valid integer cent range'), { code: 'INVALID_AMOUNT' });
  }
  return cents;
}

export function fromCents(cents) {
  const num = Number(cents);
  if (!Number.isFinite(num)) return 0;
  return Number((Math.trunc(num) / 100).toFixed(2));
}
