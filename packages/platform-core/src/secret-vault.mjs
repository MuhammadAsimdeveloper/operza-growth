import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derive a 256-bit encryption key from a master key string and salt using scrypt.
 */
function deriveKey(masterKey, salt) {
  if (!masterKey || typeof masterKey !== 'string' || masterKey.length < 8) {
    throw new Error('Master key must be a string of at least 8 characters');
  }
  return scryptSync(masterKey, salt, 32);
}

/**
 * Encrypt a secret string using AES-256-GCM.
 * Returns an envelope string: v1:salt:iv:tag:ciphertext (all hex-encoded).
 */
export function encryptSecret(plaintext, masterKey) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new TypeError('Plaintext must be a non-empty string');
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an AES-256-GCM envelope string.
 */
export function decryptSecret(envelope, masterKey) {
  if (typeof envelope !== 'string' || !envelope.startsWith('v1:')) {
    throw new Error('Invalid secret envelope format');
  }
  const parts = envelope.split(':');
  if (parts.length !== 5) {
    throw new Error('Malformed secret envelope');
  }
  const [, saltHex, ivHex, tagHex, cipherHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');

  const key = deriveKey(masterKey, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Factory for creating a pluggable, secure secret resolver.
 * Handles env:, vault:, and kms: URI reference schemes.
 */
/**
 * Create a secret resolver with optional durable encrypted storage.
 *
 * The encryption key must be supplied by deployment configuration. There is
 * deliberately no built-in fallback key. Without a key, vault writes fail
 * closed instead of storing credentials under a publicly known value.
 *
 * A storage adapter may implement async get(ref), set(ref, envelope), and
 * delete(ref). Only encrypted envelopes are passed to the adapter.
 */
export function createSecretResolver({
  masterKey = process.env.OPERZA_VAULT_KEY,
  initialSecrets = {},
  storage = null
} = {}) {
  if (
    storage &&
    (typeof storage.get !== 'function' ||
      typeof storage.set !== 'function' ||
      typeof storage.delete !== 'function')
  ) {
    throw new TypeError('Secret storage must implement async get, set, and delete methods');
  }

  const vault = new Map(Object.entries(initialSecrets));

  async function readEnvelope(secretRef) {
    if (storage) {
      const persisted = await storage.get(secretRef);
      if (typeof persisted === 'string' && persisted.length > 0) return persisted;
    }
    return vault.get(secretRef) || null;
  }

  return {
    async store(secretRef, plaintext) {
      if (typeof secretRef !== 'string' || !/^vault:[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) {
        throw new Error('Secret references must use the vault: scheme');
      }
      const encrypted = encryptSecret(plaintext, masterKey);
      if (storage) {
        await storage.set(secretRef, encrypted);
      } else {
        vault.set(secretRef, encrypted);
      }
      return secretRef;
    },

    async resolve(secretRef) {
      if (typeof secretRef !== 'string') return null;

      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        const value = process.env[envVar];
        return typeof value === 'string' && value.length > 0 ? value : null;
      }

      if (!secretRef.startsWith('vault:')) return null;

      try {
        const encrypted = await readEnvelope(secretRef);
        if (!encrypted) return null;
        return decryptSecret(encrypted, masterKey);
      } catch {
        return null;
      }
    },

    async has(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        return Boolean(process.env[envVar]);
      }
      if (!secretRef.startsWith('vault:')) return false;
      return Boolean(await readEnvelope(secretRef));
    },

    async delete(secretRef) {
      if (typeof secretRef !== 'string' || !secretRef.startsWith('vault:')) return false;
      if (storage) return storage.delete(secretRef);
      return vault.delete(secretRef);
    }
  };
}
