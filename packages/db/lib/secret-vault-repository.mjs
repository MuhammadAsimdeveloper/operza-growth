const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTenantSecretRef(secretRef) {
  if (typeof secretRef !== 'string') {
    throw Object.assign(new TypeError('Secret reference must be a string'), { code: 'INVALID_SECRET_REFERENCE' });
  }
  const match = secretRef.match(/^vault:([^/]+)\/([^/]+)\/([A-Za-z0-9_.:/-]{1,160})$/);
  if (!match || !UUID.test(match[1]) || !UUID.test(match[2]) || match[3].includes('..')) {
    throw Object.assign(new TypeError('Secret reference must be vault:<tenant UUID>/<location UUID>/<resource>'), {
      code: 'INVALID_SECRET_REFERENCE'
    });
  }
  return { tenantId: match[1], locationId: match[2] };
}

/**
 * Tenant-scoped PostgreSQL backend for createSecretResolver().
 * The encrypted envelope is stored as ciphertext only. RLS context is set
 * transaction-locally on every access, and tenant IDs are parsed from a strict
 * reference format before any query is issued.
 */
export function createPostgresSecretBackend(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required');
  }

  async function withTenant(secretRef, work) {
    const { tenantId, locationId } = parseTenantSecretRef(secretRef);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.agency_id',$1,true), set_config('app.location_id',$2,true)",
        [tenantId, locationId]
      );
      const result = await work(client, tenantId, locationId);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    async get(secretRef) {
      return withTenant(secretRef, async (client, tenantId, locationId) => {
        const result = await client.query(
          'SELECT encrypted_value FROM provider_secrets WHERE agency_id=$1 AND location_id=$2 AND secret_ref=$3',
          [tenantId, locationId, secretRef]
        );
        return result.rows[0]?.encrypted_value ?? null;
      });
    },

    async set(secretRef, encryptedValue) {
      if (typeof encryptedValue !== 'string' || !encryptedValue.startsWith('v1:')) {
        throw Object.assign(new TypeError('Only versioned encrypted secret envelopes can be persisted'), {
          code: 'ENCRYPTED_VALUE_REQUIRED'
        });
      }
      return withTenant(secretRef, async (client, tenantId, locationId) => {
        await client.query(
          'INSERT INTO provider_secrets (agency_id,location_id,secret_ref,encrypted_value) VALUES ($1,$2,$3,$4) ' +
            'ON CONFLICT (agency_id,location_id,secret_ref) DO UPDATE SET encrypted_value=EXCLUDED.encrypted_value,updated_at=now()',
          [tenantId, locationId, secretRef, encryptedValue]
        );
      });
    },

    async has(secretRef) {
      return withTenant(secretRef, async (client, tenantId, locationId) => {
        const result = await client.query(
          'SELECT 1 FROM provider_secrets WHERE agency_id=$1 AND location_id=$2 AND secret_ref=$3 LIMIT 1',
          [tenantId, locationId, secretRef]
        );
        return result.rowCount === 1;
      });
    },

    async delete(secretRef) {
      return withTenant(secretRef, async (client, tenantId, locationId) => {
        const result = await client.query(
          'DELETE FROM provider_secrets WHERE agency_id=$1 AND location_id=$2 AND secret_ref=$3',
          [tenantId, locationId, secretRef]
        );
        return result.rowCount === 1;
      });
    }
  };
}

export { parseTenantSecretRef };
