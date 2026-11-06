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
export function createSecretResolver({ masterKey = process.env.OPERZA_VAULT_KEY || 'operza-default-secure-vault-key-2026', initialSecrets = {} } = {}) {
  const vault = new Map(Object.entries(initialSecrets));

  return {
    /**
     * Store a secret securely in the vault under a URI reference (e.g. vault:agency-1/resend-api-key)
     */
    async store(secretRef, plaintext) {
      if (typeof secretRef !== 'string' || !/^(vault|kms):[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) {
        throw new Error('Invalid vault secret reference: ' + secretRef);
      }
      const encrypted = encryptSecret(plaintext, masterKey);
      vault.set(secretRef, encrypted);
      return secretRef;
    },

    /**
     * Resolve a secret reference to its raw plaintext value.
     */
    async resolve(secretRef) {
      if (typeof secretRef !== 'string') return null;

      // 1. env:VAR_NAME scheme
      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        const value = process.env[envVar];
        return typeof value === 'string' && value.length > 0 ? value : null;
      }

      // 2. vault: or kms: scheme
      if (secretRef.startsWith('vault:') || secretRef.startsWith('kms:')) {
        const encrypted = vault.get(secretRef);
        if (!encrypted) return null;
        try {
          return decryptSecret(encrypted, masterKey);
        } catch {
          return null;
        }
      }

      return null;
    },

    /**
     * Check if a secret reference exists in vault or environment
     */
    has(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        return Boolean(process.env[envVar]);
      }
      return vault.has(secretRef);
    },

    /**
     * Remove a secret from the vault
     */
    delete(secretRef) {
      return vault.delete(secretRef);
    }
  };
}
