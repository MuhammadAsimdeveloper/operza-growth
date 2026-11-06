import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, createSecretResolver } from '../src/secret-vault.mjs';

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
