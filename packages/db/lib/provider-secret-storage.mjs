const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseVaultRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith('vault:')) {
    throw Object.assign(new TypeError('Vault reference must use vault: scheme'), { code: 'INVALID_VAULT_REFERENCE' });
  }
  const parts = ref.slice(6).split('/');
  if (parts.length !== 3 || !UUID.test(parts[0]) || !UUID.test(parts[1]) || !/^[A-Za-z0-9_.-]{2,120}$/.test(parts[2])) {
    throw Object.assign(
      new TypeError('Vault reference must be vault:<agency-uuid>/<location-uuid>/<secret-name>'),
      { code: 'INVALID_VAULT_REFERENCE' }
    );
  }
  return { agencyId: parts[0], locationId: parts[1], secretName: parts[2] };
}

function validateEnvelope(envelope) {
  if (
    typeof envelope !== 'string' ||
    envelope.length > 100_000 ||
    !/^v1:[a-f0-9:]+$/i.test(envelope)
  ) {
    throw Object.assign(new TypeError('Only versioned encrypted secret envelopes may be persisted'), {
      code: 'INVALID_SECRET_CIPHERTEXT'
    });
  }
}

/**
 * Persistent secret storage. All reads/writes set the tenant context in a
 * transaction and are additionally protected by provider_secrets RLS.
 */
export function createPostgresSecretStorage(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required for provider secret storage');
  }

  async function withTenant(ref, work) {
    const { agencyId, locationId, secretName } = parseVaultRef(ref);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
        [agencyId, locationId]
      );
      const result = await work(client, { agencyId, locationId, secretName });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    durable: true,

    async get(ref) {
      return withTenant(ref, async (client, scope) => {
        const result = await client.query(
          'SELECT encrypted_value FROM provider_secrets WHERE agency_id=$1 AND location_id=$2 AND secret_name=$3',
          [scope.agencyId, scope.locationId, scope.secretName]
        );
        return result.rows[0]?.encrypted_value ?? null;
      });
    },

    async set(ref, encryptedEnvelope) {
      validateEnvelope(encryptedEnvelope);
      return withTenant(ref, async (client, scope) => {
        await client.query(
          'INSERT INTO provider_secrets (agency_id,location_id,secret_name,encrypted_value) ' +
          'VALUES ($1,$2,$3,$4) ON CONFLICT (agency_id,location_id,secret_name) ' +
          'DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value, updated_at=now()',
          [scope.agencyId, scope.locationId, scope.secretName, encryptedEnvelope]
        );
        return true;
      });
    },

    async has(ref) {
      return withTenant(ref, async (client, scope) => {
        const result = await client.query(
          'SELECT 1 FROM provider_secrets WHERE agency_id=$1 AND location_id=$2 AND secret_name=$3',
          [scope.agencyId, scope.locationId, scope.secretName]
        );
        return result.rowCount === 1;
      });
    },

    async delete(ref) {
      return withTenant(ref, async (client, scope) => {
        const result = await client.query(
          'DELETE FROM provider_secrets WHERE agency_id=$1 AND location_id=$2 AND secret_name=$3',
          [scope.agencyId, scope.locationId, scope.secretName]
        );
        return result.rowCount === 1;
      });
    }
  });
}
