import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, createSecretResolver, createMemorySecretStorage } from '../src/secret-vault.mjs';

test('encryptSecret and decryptSecret round-trip with authenticated encryption', () => {
  const masterKey = 'super-secret-master-key-32-chars!!';
  const plaintext = 're_test_99214981729487192847192';

  const envelope = encryptSecret(plaintext, masterKey);
  assert.ok(envelope.startsWith('v1:'), 'envelope has v1 prefix');

  const decrypted = decryptSecret(envelope, masterKey);
  assert.equal(decrypted, plaintext, 'decrypted matches original plaintext');
});

test('decryptSecret fails with invalid master key or tampered ciphertext', () => {
  const masterKey = 'correct-master-key-1234567890';
  const wrongKey = 'wrong-master-key-0987654321';
  const plaintext = 'sk_live_test_api_key_secret';

  const envelope = encryptSecret(plaintext, masterKey);

  // Wrong key should fail auth tag check
  assert.throws(() => {
    decryptSecret(envelope, wrongKey);
  });

  // Tampered ciphertext should fail auth tag check
  const parts = envelope.split(':');
  parts[4] = parts[4].slice(0, -2) + 'ff';
  const tampered = parts.join(':');
  assert.throws(() => {
    decryptSecret(tampered, masterKey);
  });
});

test('createSecretResolver resolves env, vault and kms schemes', async () => {
  process.env.TEST_OPERZA_SECRET = 'sg_env_resolved_key_12345';
  const resolver = createSecretResolver({ masterKey: 'test-master-key-xyz' });

  // 1. env: scheme
  const envVal = await resolver.resolve('env:TEST_OPERZA_SECRET');
  assert.equal(envVal, 'sg_env_resolved_key_12345');

  // 2. vault: scheme with store()
  await resolver.store('vault:tenant-alpha/resend-key', 're_test_alpha_resend_999');
  const vaultVal = await resolver.resolve('vault:tenant-alpha/resend-key');
  assert.equal(vaultVal, 're_test_alpha_resend_999');

  // 3. non-existent secret returns null
  const missing = await resolver.resolve('vault:tenant-alpha/non-existent');
  assert.equal(missing, null);

  // 4. invalid scheme returns null
  const invalid = await resolver.resolve('unknown:reference');
  assert.equal(invalid, null);
});


test('secret resolver refuses implicit memory storage and insecure default master key', async () => {
  const resolver = createSecretResolver();
  await assert.rejects(
    resolver.store('vault:tenant-alpha/api-key', 'never-store-in-memory'),
    { code: 'SECRET_STORAGE_UNAVAILABLE' }
  );
});

test('secret resolver encrypts values in an explicitly injected storage adapter', async () => {
  const storage = createMemorySecretStorage();
  const resolver = createSecretResolver({
    masterKey: 'test-master-key-that-is-long-enough-for-operza-vault',
    storage
  });
  await resolver.store('vault:tenant-alpha/resend-key', 're_test_persisted_secret');
  const storedEnvelope = await storage.get('vault:tenant-alpha/resend-key');
  assert.ok(storedEnvelope.startsWith('v1:'));
  assert.notEqual(storedEnvelope, 're_test_persisted_secret');
  assert.equal(await resolver.resolve('vault:tenant-alpha/resend-key'), 're_test_persisted_secret');
});

test('KMS references are delegated and never stored in the local vault adapter', async () => {
  const calls = [];
  const kmsAdapter = {
    async resolve(ref) { calls.push(['resolve', ref]); return 'kms-secret'; },
    async has(ref) { calls.push(['has', ref]); return true; },
    async delete(ref) { calls.push(['delete', ref]); return true; }
  };
  const resolver = createSecretResolver({ kmsAdapter });
  assert.equal(await resolver.resolve('kms:tenant-alpha/provider-key'), 'kms-secret');
  assert.equal(resolver.has('kms:tenant-alpha/provider-key'), true);
  assert.equal(resolver.delete('kms:tenant-alpha/provider-key'), true);
  assert.deepEqual(calls.map(([method]) => method), ['resolve', 'has', 'delete']);
});
