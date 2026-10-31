let pgModule;
try {
  pgModule = await import('pg');
} catch {
  try {
    pgModule = await import('../../../apps/api/node_modules/pg/lib/index.js');
  } catch {
    // pg will throw on pool creation if not installed
  }
}

const Pool = pgModule?.default?.Pool || pgModule?.Pool;
let pool;

export function databaseConfigured() { return Boolean(process.env.DATABASE_URL); }

export function getPool() {
  if (!databaseConfigured()) throw new Error('DATABASE_URL is required for PostgreSQL operations.');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30_000,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined
    });
    pool.on('error', error => console.error('Unexpected idle PostgreSQL client error:', error.message));
  }
  return pool;
}

/**
 * Resets tenant session context before releasing a connection back to the pool
 * to prevent context leakage across pooled client instances.
 */
async function sanitizePooledClient(client) {
  try {
    await client.query(`
      SELECT set_config('app.current_agency_id', '', false),
             set_config('app.agency_id', '', false),
             set_config('app.current_location_id', '', false),
             set_config('app.location_id', '', false),
             set_config('app.current_user_id', '', false),
             set_config('app.user_id', '', false)
    `);
  } catch {
    // Ignore cleanup errors on terminated sockets
  }
}

export async function withIdentityTransaction(context, work) {
  if (!context?.userId) throw new Error('An authenticated user context is required.');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const agencyId = context.agencyId || '';
    const userId = context.userId;
    await client.query(
      `SELECT set_config('app.current_agency_id', $1, true),
              set_config('app.agency_id', $1, true),
              set_config('app.current_user_id', $2, true),
              set_config('app.user_id', $2, true)`,
      [agencyId, userId]
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await sanitizePooledClient(client);
    client.release();
  }
}

export async function withTenantTransaction(context, work) {
  if (!context?.agencyId || !context?.userId) {
    throw new Error('A complete authenticated tenant context (agencyId, userId) is required.');
  }
  return withIdentityTransaction(context, async client => {
    const locationId = context.locationId || '';
    await client.query(
      `SELECT set_config('app.current_location_id', $1, true),
              set_config('app.location_id', $1, true)`,
      [locationId]
    );
    return work(client);
  });
}

/**
 * Direct agency-scoped transaction for background workers, webhooks, and agency services.
 */
export async function withAgencyTransaction(agencyId, work) {
  if (!agencyId) throw new Error('An agencyId is required for an agency transaction.');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_agency_id', $1, true),
              set_config('app.agency_id', $1, true)`,
      [String(agencyId)]
    );
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await sanitizePooledClient(client);
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}
