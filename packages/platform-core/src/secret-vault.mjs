import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(masterKey, salt) {
  if (typeof masterKey !== 'string' || masterKey.length < 16) {
    throw Object.assign(new Error('OPERZA_VAULT_KEY must contain at least 16 characters'), {
      code: 'OPERZA_VAULT_KEY_REQUIRED'
    });
  }
  return scryptSync(masterKey, salt, 32);
}

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

export function decryptSecret(envelope, masterKey) {
  if (typeof envelope !== 'string' || !envelope.startsWith('v1:')) {
    throw new Error('Invalid secret envelope format');
  }
  const parts = envelope.split(':');
  if (parts.length !== 5) throw new Error('Malformed secret envelope');
  const [, saltHex, ivHex, tagHex, cipherHex] = parts;
  if (![saltHex, ivHex, tagHex, cipherHex].every(value => /^[a-f0-9]*$/i.test(value))) {
    throw new Error('Malformed secret envelope encoding');
  }
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH || ciphertext.length === 0) {
    throw new Error('Malformed secret envelope lengths');
  }
  const key = deriveKey(masterKey, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Secret resolver contract:
 * - vault: references are AES-256-GCM encrypted before being passed to the
 *   supplied storage backend.
 * - kms: references are delegated to an explicitly injected KMS adapter.
 * - env: references read a named environment variable.
 *
 * The default Map backend is suitable only for local development and tests.
 * Production must inject a durable, access-controlled backend and set
 * OPERZA_VAULT_KEY (or inject a managed KMS adapter).
 */
export function createSecretResolver({
  masterKey = process.env.OPERZA_VAULT_KEY,
  backend,
  kmsAdapter,
  initialSecrets = {}
} = {}) {
  const memory = new Map(Object.entries(initialSecrets));
  const storage = backend || {
    async get(ref) { return memory.get(ref) ?? null; },
    async set(ref, value) { memory.set(ref, value); },
    async has(ref) { return memory.has(ref); },
    async delete(ref) { return memory.delete(ref); }
  };

  for (const method of ['get', 'set', 'delete']) {
    if (typeof storage[method] !== 'function') {
      throw new TypeError(`Secret storage backend must implement ${method}()`);
    }
  }

  const resolveMasterKey = () => masterKey || process.env.OPERZA_VAULT_KEY;

  return {
    async store(secretRef, plaintext) {
      if (typeof secretRef !== 'string' || !/^(vault|kms):[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) {
        throw new Error('Invalid vault secret reference');
      }
      if (secretRef.startsWith('kms:')) {
        if (typeof kmsAdapter?.store !== 'function') {
          throw Object.assign(new Error('A KMS adapter is required for kms: references'), {
            code: 'KMS_ADAPTER_UNAVAILABLE'
          });
        }
        await kmsAdapter.store(secretRef, plaintext);
        return secretRef;
      }
      const key = resolveMasterKey();
      // deriveKey validates that a configured, non-default key is available.
      deriveKey(key, Buffer.alloc(SALT_LENGTH, 1));
      const encrypted = encryptSecret(plaintext, key);
      await storage.set(secretRef, encrypted);
      return secretRef;
    },

    async resolve(secretRef) {
      if (typeof secretRef !== 'string') return null;
      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        const value = process.env[envVar];
        return typeof value === 'string' && value.length > 0 ? value : null;
      }
      if (secretRef.startsWith('kms:')) {
        if (typeof kmsAdapter?.resolve !== 'function') return null;
        return kmsAdapter.resolve(secretRef);
      }
      if (!/^vault:[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) return null;
      const encrypted = await storage.get(secretRef);
      if (typeof encrypted !== 'string' || !encrypted) return null;
      return decryptSecret(encrypted, resolveMasterKey());
    },

    async has(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        return Boolean(process.env[envVar]);
      }
      if (secretRef.startsWith('kms:')) {
        return typeof kmsAdapter?.has === 'function' ? Boolean(await kmsAdapter.has(secretRef)) : false;
      }
      if (!/^vault:[A-Za-z0-9_.:/-]{2,180}$/.test(secretRef)) return false;
      if (typeof storage.has === 'function') return Boolean(await storage.has(secretRef));
      return (await storage.get(secretRef)) !== null;
    },

    async delete(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('kms:')) {
        return typeof kmsAdapter?.delete === 'function' ? Boolean(await kmsAdapter.delete(secretRef)) : false;
      }
      if (!secretRef.startsWith('vault:')) return false;
      return Boolean(await storage.delete(secretRef));
    }
  };
}
