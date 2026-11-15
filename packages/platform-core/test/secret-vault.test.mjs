import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, createSecretResolver } from '../src/secret-vault.mjs';

const MASTER_KEY = 'unit-test-master-key-that-is-long-enough-32-chars';

test('encryptSecret and decryptSecret round-trip using authenticated encryption', () => {
  const plaintext = 're_test_99214981729487192847192';
  const envelope = encryptSecret(plaintext, MASTER_KEY);
  assert.ok(envelope.startsWith('v1:'));
  assert.equal(decryptSecret(envelope, MASTER_KEY), plaintext);
});

test('decryptSecret rejects a wrong key and tampered ciphertext', () => {
  const envelope = encryptSecret('sk_live_test_api_key_secret', MASTER_KEY);
  assert.throws(() => decryptSecret(envelope, 'wrong-test-master-key-that-is-long-enough-32chars'));
  const parts = envelope.split(':');
  parts[4] = parts[4].slice(0, -2) + 'ff';
  assert.throws(() => decryptSecret(parts.join(':'), MASTER_KEY));
});

test('vault refuses missing or weak master keys instead of using a built-in key', async () => {
  const resolver = createSecretResolver({ masterKey: '', allowInMemory: true });
  await assert.rejects(resolver.store('vault:tenant-alpha/resend-key', 're_test_secret'), { code: 'VAULT_MASTER_KEY_REQUIRED' });
});

test('production configuration requires a persistent backend', async () => {
  const resolver = createSecretResolver({ masterKey: MASTER_KEY, allowInMemory: false });
  await assert.rejects(resolver.store('vault:tenant-alpha/resend-key', 're_test_secret'), { code: 'SECRET_BACKEND_UNAVAILABLE' });
});

test('persistent backend survives resolver recreation and decrypts with the configured key', async () => {
  const values = new Map();
  const backend = {
    async get(ref) { return values.get(ref) || null; },
    async set(ref, value) { values.set(ref, value); },
    async delete(ref) { return values.delete(ref); }
  };
  const first = createSecretResolver({ masterKey: MASTER_KEY, backend, allowInMemory: false });
  await first.store('vault:tenant-alpha/resend-key', 're_test_alpha_resend_999');
  const second = createSecretResolver({ masterKey: MASTER_KEY, backend, allowInMemory: false });
  assert.equal(await second.resolve('vault:tenant-alpha/resend-key'), 're_test_alpha_resend_999');
  assert.equal(await second.resolve('vault:tenant-alpha/missing-key'), null);
  assert.equal(await second.delete('vault:tenant-alpha/resend-key'), true);
});

test('env references resolve directly without entering the encrypted vault', async () => {
  process.env.TEST_OPERZA_SECRET = 'sg_env_resolved_key_12345';
  const resolver = createSecretResolver({ masterKey: MASTER_KEY });
  assert.equal(await resolver.resolve('env:TEST_OPERZA_SECRET'), 'sg_env_resolved_key_12345');
  delete process.env.TEST_OPERZA_SECRET;
});