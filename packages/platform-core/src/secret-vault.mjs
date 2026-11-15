import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const MIN_MASTER_KEY_LENGTH = 32;

function validateMasterKey(masterKey) {
  if (typeof masterKey !== 'string' || masterKey.length < MIN_MASTER_KEY_LENGTH) {
    throw Object.assign(new Error('OPERZA_VAULT_KEY must contain at least 32 characters'), {
      code: 'VAULT_MASTER_KEY_REQUIRED'
    });
  }
  return masterKey;
}

function deriveKey(masterKey, salt) {
  return scryptSync(validateMasterKey(masterKey), salt, 32);
}

function decodeHex(value, expectedLength, label) {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(value)) {
    throw new Error('Invalid secret envelope ' + label);
  }
  const bytes = Buffer.from(value, 'hex');
  if (expectedLength && bytes.length !== expectedLength) {
    throw new Error('Invalid secret envelope ' + label + ' length');
  }
  return bytes;
}

/** Encrypt a secret using authenticated AES-256-GCM. */
export function encryptSecret(plaintext, masterKey) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('Plaintext must be a non-empty string');
  }
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(masterKey, salt), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', salt.toString('hex'), iv.toString('hex'), tag.toString('hex'), ciphertext.toString('hex')].join(':');
}

/** Decrypt an authenticated AES-256-GCM envelope. */
export function decryptSecret(envelope, masterKey) {
  if (typeof envelope !== 'string') throw new Error('Invalid secret envelope format');
  const parts = envelope.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new Error('Malformed secret envelope');
  const salt = decodeHex(parts[1], SALT_LENGTH, 'salt');
  const iv = decodeHex(parts[2], IV_LENGTH, 'iv');
  const tag = decodeHex(parts[3], TAG_LENGTH, 'tag');
  const ciphertext = decodeHex(parts[4], null, 'ciphertext');
  const decipher = createDecipheriv(ALGORITHM, deriveKey(masterKey, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Create a secret resolver with an optional persistent encrypted backend.
 * The backend contract is get(ref), set(ref, encryptedValue), delete(ref).
 * Memory storage is for local development and tests only; production and
 * staging require a persistent backend. No default encryption key is used.
 */
export function createSecretResolver({
  masterKey = process.env.OPERZA_VAULT_KEY,
  backend = null,
  initialSecrets = {},
  allowInMemory = !['production', 'staging'].includes(process.env.NODE_ENV)
} = {}) {
  const memory = new Map(Object.entries(initialSecrets));
  const hasBackend = Boolean(backend && typeof backend.get === 'function' &&
    typeof backend.set === 'function' && typeof backend.delete === 'function');

  function assertCanEncrypt() {
    validateMasterKey(masterKey);
    if (!hasBackend && !allowInMemory) {
      throw Object.assign(new Error('Persistent secret backend is not configured'), {
        code: 'SECRET_BACKEND_UNAVAILABLE'
      });
    }
  }

  async function getEncrypted(secretRef) {
    if (hasBackend) return backend.get(secretRef);
    if (!allowInMemory) {
      throw Object.assign(new Error('Persistent secret backend is not configured'), {
        code: 'SECRET_BACKEND_UNAVAILABLE'
      });
    }
    return memory.get(secretRef) || null;
  }

  return {
    async store(secretRef, plaintext) {
      if (typeof secretRef !== 'string' || !/^(vault|kms):[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) {
        throw Object.assign(new Error('Invalid vault secret reference'), { code: 'INVALID_SECRET_REFERENCE' });
      }
      assertCanEncrypt();
      const encrypted = encryptSecret(plaintext, masterKey);
      if (hasBackend) await backend.set(secretRef, encrypted);
      else memory.set(secretRef, encrypted);
      return secretRef;
    },

    async resolve(secretRef) {
      if (typeof secretRef !== 'string') return null;
      if (secretRef.startsWith('env:')) {
        const value = process.env[secretRef.slice(4).trim()];
        return typeof value === 'string' && value.length > 0 ? value : null;
      }
      if (!secretRef.startsWith('vault:') && !secretRef.startsWith('kms:')) return null;
      try {
        const encrypted = await getEncrypted(secretRef);
        if (!encrypted || typeof masterKey !== 'string' || masterKey.length < MIN_MASTER_KEY_LENGTH) return null;
        return decryptSecret(encrypted, masterKey);
      } catch {
        return null;
      }
    },

    async has(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('env:')) return Boolean(process.env[secretRef.slice(4).trim()]);
      try { return Boolean(await getEncrypted(secretRef)); } catch { return false; }
    },

    async delete(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (hasBackend) return backend.delete(secretRef);
      if (!allowInMemory) {
        throw Object.assign(new Error('Persistent secret backend is not configured'), { code: 'SECRET_BACKEND_UNAVAILABLE' });
      }
      return memory.delete(secretRef);
    }
  };
}