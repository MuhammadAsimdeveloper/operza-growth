import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, createSecretResolver } from '../src/secret-vault.mjs';

test('encryptSecret and decryptSecret round-trip with authenticated encryption', () => {
  const masterKey = 'super-secret-master-key-32-chars!!';
  const plaintext = 're_test_99214981729487192847192';
  const envelope = encryptSecret(plaintext, masterKey);
  assert.ok(envelope.startsWith('v1:'), 'envelope has v1 prefix');
  assert.equal(decryptSecret(envelope, masterKey), plaintext);
});

test('decryptSecret fails with invalid master key or tampered ciphertext', () => {
  const masterKey = 'correct-master-key-1234567890';
  const wrongKey = 'wrong-master-key-0987654321';
  const envelope = encryptSecret('sk_live_test_api_key_secret', masterKey);
  assert.throws(() => decryptSecret(envelope, wrongKey));
  const parts = envelope.split(':');
  parts[4] = parts[4].slice(0, -2) + 'ff';
  assert.throws(() => decryptSecret(parts.join(':'), masterKey));
});

test('createSecretResolver resolves env and vault references', async () => {
  process.env.TEST_OPERZA_SECRET = 'sg_env_resolved_key_12345';
  const resolver = createSecretResolver({ masterKey: 'test-master-key-xyz-123456' });
  assert.equal(await resolver.resolve('env:TEST_OPERZA_SECRET'), 'sg_env_resolved_key_12345');
  await resolver.store('vault:tenant-alpha/resend-key', 're_test_alpha_resend_999');
  assert.equal(await resolver.resolve('vault:tenant-alpha/resend-key'), 're_test_alpha_resend_999');
  assert.equal(await resolver.resolve('vault:tenant-alpha/non-existent'), null);
  assert.equal(await resolver.resolve('unknown:reference'), null);
  delete process.env.TEST_OPERZA_SECRET;
});

test('vault storage refuses to use a built-in fallback master key', async () => {
  const previous = process.env.OPERZA_VAULT_KEY;
  delete process.env.OPERZA_VAULT_KEY;
  try {
    const resolver = createSecretResolver();
    await assert.rejects(
      () => resolver.store('vault:tenant-alpha/provider-key', 'secret-value'),
      { code: 'OPERZA_VAULT_KEY_REQUIRED' }
    );
  } finally {
    if (previous === undefined) delete process.env.OPERZA_VAULT_KEY;
    else process.env.OPERZA_VAULT_KEY = previous;
  }
});

test('an injected durable backend can be reused across resolver instances', async () => {
  const records = new Map();
  const backend = {
    async get(ref) { return records.get(ref) ?? null; },
    async set(ref, value) { records.set(ref, value); },
    async has(ref) { return records.has(ref); },
    async delete(ref) { return records.delete(ref); }
  };
  const masterKey = 'production-test-key-with-32-characters';
  const first = createSecretResolver({ masterKey, backend });
  await first.store('vault:tenant-alpha/sendgrid-key', 'SG.super-secret-token-value');
  assert.notEqual(records.get('vault:tenant-alpha/sendgrid-key'), 'SG.super-secret-token-value');

  const second = createSecretResolver({ masterKey, backend });
  assert.equal(await second.resolve('vault:tenant-alpha/sendgrid-key'), 'SG.super-secret-token-value');
});

test('kms references require an explicit KMS adapter', async () => {
  const noKms = createSecretResolver({ masterKey: 'test-master-key-xyz-123456' });
  await assert.rejects(
    () => noKms.store('kms:tenant-alpha/provider-key', 'secret-value'),
    { code: 'KMS_ADAPTER_UNAVAILABLE' }
  );

  const stored = new Map();
  const kmsAdapter = {
    async store(ref, value) { stored.set(ref, value); },
    async resolve(ref) { return stored.get(ref) ?? null; },
    async has(ref) { return stored.has(ref); },
    async delete(ref) { return stored.delete(ref); }
  };
  const withKms = createSecretResolver({ kmsAdapter });
  await withKms.store('kms:tenant-alpha/provider-key', 'managed-secret');
  assert.equal(await withKms.resolve('kms:tenant-alpha/provider-key'), 'managed-secret');
});
