import pg from 'pg';

const { Pool } = pg;
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

export async function withIdentityTransaction(context, work) {
  if (!context?.userId) throw new Error('An authenticated user context is required.');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.agency_id',$1,true), set_config('app.user_id',$2,true)", [context.agencyId||'',context.userId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function withTenantTransaction(context, work) {
  if (!context?.agencyId || !context?.locationId || !context?.userId) throw new Error('A complete authenticated tenant context is required.');
  return withIdentityTransaction(context,async client=>{
    await client.query("SELECT set_config('app.location_id',$1,true)",[context.locationId]);
    return work(client);
  });
}

export async function closePool() { if (pool) { const current = pool; pool = undefined; await current.end(); } }

