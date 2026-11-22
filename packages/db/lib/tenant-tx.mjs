/**
 * ============================================================================
 * Operza TenantTx — Multi-Tenant Transaction Boundary
 * ============================================================================
 * Enforces transaction-scoped PostgreSQL Row Level Security (RLS) contexts
 * using SET LOCAL (is_local = true) to prevent cross-tenant leakage across pooled
 * connections.
 */

export class TenantTx {
  #client;
  #agencyId;
  #locationId;
  #actorId;
  #context;
  #pool;

  constructor({ client, context, pool }) {
    if (!client || typeof client.query !== 'function') {
      throw new TypeError('A valid PostgreSQL client is required for TenantTx');
    }
    this.#client = client;
    this.#agencyId = context.agencyId;
    this.#locationId = context.locationId;
    this.#actorId = context.actorId;
    this.#context = Object.freeze({ ...context });
    this.#pool = pool;

    Object.freeze(this);
  }

  get client() {
    return this.#client;
  }

  get agencyId() {
    return this.#agencyId;
  }

  get locationId() {
    return this.#locationId;
  }

  get actorId() {
    return this.#actorId;
  }

  get context() {
    return this.#context;
  }

  /**
   * Executes a query strictly on this tenant-bound client.
   *
   * @param {string} text - Parameterized SQL text
   * @param {any[]} [params] - Query parameters
   * @returns {Promise<any>}
   */
  async query(text, params) {
    return this.#client.query(text, params);
  }
}

/**
 * Validates the tenant context object.
 *
 * @param {any} context
 * @returns {{ agencyId: string, locationId: string, actorId: string }}
 */
function assertTenantContext(context) {
  if (!context || typeof context !== 'object') {
    throw Object.assign(new TypeError('Tenant context is required'), { code: 'TENANT_CONTEXT_REQUIRED' });
  }

  const agencyId = typeof context.agencyId === 'string' ? context.agencyId.trim() : '';
  const locationId = typeof context.locationId === 'string' ? context.locationId.trim() : '';
  const actorId = typeof context.actorId === 'string'
    ? context.actorId.trim()
    : (typeof context.userId === 'string' ? context.userId.trim() : '');

  if (!agencyId || !locationId || !actorId) {
    throw Object.assign(
      new TypeError('A complete authenticated tenant context (agencyId, locationId, actorId) is required'),
      { code: 'TENANT_CONTEXT_REQUIRED' }
    );
  }

  return { agencyId, locationId, actorId };
}

/**
 * Executes a callback within an isolated, tenant-configured database transaction.
 *
 * @template T
 * @param {any} pool - PostgreSQL connection pool
 * @param {any} context - Tenant context { agencyId, locationId, actorId }
 * @param {(tx: TenantTx) => Promise<T>} work - Async transactional work callback
 * @returns {Promise<T>}
 */
export async function runInTenantTx(pool, context, work) {
  if (!pool || typeof pool.connect !== 'function') {
    throw Object.assign(new TypeError('A PostgreSQL pool is required for runInTenantTx'), {
      code: 'DATABASE_POOL_REQUIRED'
    });
  }

  const { agencyId, locationId, actorId } = assertTenantContext(context);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true), set_config('app.user_id', $3, true)",
      [agencyId, locationId, actorId]
    );

    const tx = new TenantTx({ client, context: { agencyId, locationId, actorId }, pool });
    const result = await work(tx);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Factory helper creating a reusable tenant transaction runner bound to a pool.
 *
 * @param {any} pool
 * @returns {(context: any, work: (tx: TenantTx) => Promise<any>) => Promise<any>}
 */
export function createTenantTxRunner(pool) {
  return (context, work) => runInTenantTx(pool, context, work);
}
