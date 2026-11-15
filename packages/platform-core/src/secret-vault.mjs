import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const MIN_MASTER_KEY_BYTES = 32;
const SECRET_REF = /^(vault|kms):[A-Za-z0-9_.:/-]{2,180}$/;

function deriveKey(masterKey, salt) {
  if (typeof masterKey !== 'string' || Buffer.byteLength(masterKey, 'utf8') < MIN_MASTER_KEY_BYTES) {
    throw Object.assign(
      new Error('OPERZA_VAULT_KEY must contain at least 32 bytes of high-entropy key material'),
      { code: 'VAULT_MASTER_KEY_INVALID' }
    );
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
  if (
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !new RegExp(`^[a-f0-9]{${IV_LENGTH * 2}}$`, 'i').test(ivHex) ||
    !new RegExp(`^[a-f0-9]{${TAG_LENGTH * 2}}$`, 'i').test(tagHex) ||
    !/^(?:[a-f0-9]{2})+$/i.test(cipherHex)
  ) {
    throw new Error('Malformed secret envelope');
  }

  const key = deriveKey(masterKey, Buffer.from(saltHex, 'hex'));
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, 'hex')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

/**
 * Explicit ephemeral adapter for tests and local-only development.
 * Production must inject a persistent encrypted store (or a KMS-backed adapter).
 */
export function createMemorySecretStorage(initialRecords = {}) {
  const records = new Map(Object.entries(initialRecords));
  return Object.freeze({
    durable: false,
    async get(ref) { return records.get(ref) ?? null; },
    async set(ref, envelope) { records.set(ref, envelope); return true; },
    async has(ref) { return records.has(ref); },
    async delete(ref) { return records.delete(ref); }
  });
}

function assertStorageAdapter(storage) {
  if (!storage) return;
  for (const method of ['get', 'set', 'has', 'delete']) {
    if (typeof storage[method] !== 'function') {
      throw new TypeError(`Secret storage adapter must implement ${method}()`);
    }
  }
}

function assertKmsAdapter(adapter) {
  if (!adapter) return;
  for (const method of ['resolve', 'has', 'delete']) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`KMS adapter must implement ${method}()`);
    }
  }
}

/**
 * Server-side secret resolver.
 *
 * vault: references are encrypted with AES-256-GCM and stored only through the
 * explicitly injected storage adapter. kms: references are delegated to a real
 * KMS adapter; they are never silently treated as in-process vault entries.
 *
 * There is intentionally no default master key and no implicit memory store.
 */
export function createSecretResolver({
  masterKey = process.env.OPERZA_VAULT_KEY,
  storage,
  kmsAdapter,
  environment = process.env
} = {}) {
  assertStorageAdapter(storage);
  assertKmsAdapter(kmsAdapter);

  return Object.freeze({
    async store(secretRef, plaintext) {
      if (typeof secretRef !== 'string' || !SECRET_REF.test(secretRef)) {
        throw Object.assign(new Error('Invalid vault secret reference'), { code: 'INVALID_SECRET_REFERENCE' });
      }
      if (secretRef.startsWith('kms:')) {
        if (!kmsAdapter || typeof kmsAdapter.store !== 'function') {
          throw Object.assign(new Error('A configured KMS adapter is required for kms: references'), { code: 'KMS_ADAPTER_REQUIRED' });
        }
        await kmsAdapter.store(secretRef, plaintext);
        return secretRef;
      }
      if (!storage) {
        throw Object.assign(new Error('Persistent secret storage is not configured'), { code: 'SECRET_STORAGE_UNAVAILABLE' });
      }
      const envelope = encryptSecret(plaintext, masterKey);
      await storage.set(secretRef, envelope);
      return secretRef;
    },

    async resolve(secretRef) {
      if (typeof secretRef !== 'string') return null;

      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar)) return null;
        const value = environment[envVar];
        return typeof value === 'string' && value.length > 0 ? value : null;
      }

      if (secretRef.startsWith('kms:')) {
        return kmsAdapter ? kmsAdapter.resolve(secretRef) : null;
      }

      if (!secretRef.startsWith('vault:') || !storage) return null;
      const envelope = await storage.get(secretRef);
      if (typeof envelope !== 'string') return null;
      try {
        return decryptSecret(envelope, masterKey);
      } catch {
        return null;
      }
    },

    async has(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('env:')) {
        const envVar = secretRef.slice(4).trim();
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(envVar) && Boolean(environment[envVar]);
      }
      if (secretRef.startsWith('kms:')) return kmsAdapter ? Boolean(await kmsAdapter.has(secretRef)) : false;
      return secretRef.startsWith('vault:') && storage ? Boolean(await storage.has(secretRef)) : false;
    },

    async delete(secretRef) {
      if (typeof secretRef !== 'string') return false;
      if (secretRef.startsWith('kms:')) return kmsAdapter ? Boolean(await kmsAdapter.delete(secretRef)) : false;
      if (secretRef.startsWith('vault:') && storage) return Boolean(await storage.delete(secretRef));
      return false;
    }
  });
}
