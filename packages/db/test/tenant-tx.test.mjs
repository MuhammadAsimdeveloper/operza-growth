import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx, TenantTx } from '../lib/tenant-tx.mjs';

function createMockPool({ onQuery, shouldFailConnect = false } = {}) {
  const queryLog = [];
  let released = false;

  const mockClient = {
    async query(sql, params) {
      queryLog.push({ sql, params });
      if (onQuery) {
        return onQuery(sql, params);
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released = true;
    }
  };

  const pool = {
    async connect() {
      if (shouldFailConnect) throw new Error('Connection pool exhausted');
      return mockClient;
    },
    queryLog,
    get isReleased() {
      return released;
    }
  };

  return pool;
}

test('runInTenantTx validates mandatory tenant context', async () => {
  const pool = createMockPool();

  // Missing context
  await assert.rejects(
    runInTenantTx(pool, null, async () => {}),
    { code: 'TENANT_CONTEXT_REQUIRED' }
  );

  // Missing agencyId
  await assert.rejects(
    runInTenantTx(pool, { locationId: 'loc-1', actorId: 'user-1' }, async () => {}),
    { code: 'TENANT_CONTEXT_REQUIRED' }
  );

  // Blank agencyId
  await assert.rejects(
    runInTenantTx(pool, { agencyId: '   ', locationId: 'loc-1', actorId: 'user-1' }, async () => {}),
    { code: 'TENANT_CONTEXT_REQUIRED' }
  );

  // Missing locationId
  await assert.rejects(
    runInTenantTx(pool, { agencyId: 'agency-1', actorId: 'user-1' }, async () => {}),
    { code: 'TENANT_CONTEXT_REQUIRED' }
  );

  // Missing actorId / userId
  await assert.rejects(
    runInTenantTx(pool, { agencyId: 'agency-1', locationId: 'loc-1' }, async () => {}),
    { code: 'TENANT_CONTEXT_REQUIRED' }
  );
});

test('runInTenantTx enforces BEGIN -> set_config -> work -> COMMIT and releases client', async () => {
  const pool = createMockPool();
  const context = {
    agencyId: 'agency-123',
    locationId: 'loc-456',
    actorId: 'user-789'
  };

  let callbackRan = false;
  const result = await runInTenantTx(pool, context, async (tx) => {
    callbackRan = true;
    assert.ok(tx instanceof TenantTx);
    assert.equal(tx.agencyId, 'agency-123');
    assert.equal(tx.locationId, 'loc-456');
    assert.equal(tx.actorId, 'user-789');

    // Perform query via tx
    await tx.query('SELECT 1 FROM contacts WHERE id = $1', ['test-id']);
    return { success: true, count: 1 };
  });

  assert.equal(callbackRan, true);
  assert.deepEqual(result, { success: true, count: 1 });
  assert.equal(pool.isReleased, true);

  // Verify query sequence
  const sqls = pool.queryLog.map(q => q.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.ok(sqls[1].includes("set_config('app.agency_id'"));
  assert.deepEqual(pool.queryLog[1].params, ['agency-123', 'loc-456', 'user-789']);
  assert.equal(sqls[2], 'SELECT 1 FROM contacts WHERE id = $1');
  assert.equal(sqls[3], 'COMMIT');
});

test('runInTenantTx issues ROLLBACK and releases client when work throws', async () => {
  const pool = createMockPool();
  const context = {
    agencyId: 'agency-123',
    locationId: 'loc-456',
    actorId: 'user-789'
  };

  const customError = new Error('Database write conflict');
  await assert.rejects(
    runInTenantTx(pool, context, async (tx) => {
      await tx.query('INSERT INTO contacts (id) VALUES ($1)', ['c1']);
      throw customError;
    }),
    /Database write conflict/
  );

  assert.equal(pool.isReleased, true);
  const sqls = pool.queryLog.map(q => q.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.ok(sqls[1].includes("set_config"));
  assert.equal(sqls[2], 'INSERT INTO contacts (id) VALUES ($1)');
  assert.equal(sqls[3], 'ROLLBACK');
});

test('runInTenantTx throws if pool is invalid', async () => {
  await assert.rejects(
    runInTenantTx(null, { agencyId: 'a', locationId: 'l', actorId: 'u' }, async () => {}),
    { code: 'DATABASE_POOL_REQUIRED' }
  );
});

test('TenantTx properties are read-only and immutable', async () => {
  const pool = createMockPool();
  const context = { agencyId: 'a1', locationId: 'l1', actorId: 'u1' };

  await runInTenantTx(pool, context, async (tx) => {
    assert.throws(() => {
      tx.agencyId = 'different-agency';
    }, /Cannot set property/);
    assert.throws(() => {
      tx.locationId = 'different-location';
    }, /Cannot set property/);
    assert.throws(() => {
      tx.actorId = 'different-actor';
    }, /Cannot set property/);
  });
});

test('runInTenantTx handles connection acquisition failure gracefully', async () => {
  const pool = createMockPool({ shouldFailConnect: true });
  const context = { agencyId: 'a1', locationId: 'l1', actorId: 'u1' };

  await assert.rejects(
    runInTenantTx(pool, context, async () => {}),
    /Connection pool exhausted/
  );
  assert.equal(pool.isReleased, false);
});

test('runInTenantTx handles BEGIN failure and releases client', async () => {
  const pool = createMockPool({
    onQuery: (sql) => {
      if (sql === 'BEGIN') throw new Error('BEGIN failed on database');
      return { rows: [], rowCount: 0 };
    }
  });
  const context = { agencyId: 'a1', locationId: 'l1', actorId: 'u1' };

  await assert.rejects(
    runInTenantTx(pool, context, async () => {}),
    /BEGIN failed on database/
  );
  assert.equal(pool.isReleased, true);
});

test('runInTenantTx handles set_config failure, rolls back and releases client', async () => {
  const pool = createMockPool({
    onQuery: (sql) => {
      if (sql.includes('set_config')) throw new Error('Tenant setting failed');
      return { rows: [], rowCount: 0 };
    }
  });
  const context = { agencyId: 'a1', locationId: 'l1', actorId: 'u1' };

  await assert.rejects(
    runInTenantTx(pool, context, async () => {}),
    /Tenant setting failed/
  );
  assert.equal(pool.isReleased, true);
  const sqls = pool.queryLog.map(q => q.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.ok(sqls[1].includes('set_config'));
  assert.equal(sqls[2], 'ROLLBACK');
});

test('runInTenantTx handles COMMIT failure, rolls back and releases client', async () => {
  const pool = createMockPool({
    onQuery: (sql) => {
      if (sql === 'COMMIT') throw new Error('Serialization failure on COMMIT');
      return { rows: [], rowCount: 0 };
    }
  });
  const context = { agencyId: 'a1', locationId: 'l1', actorId: 'u1' };

  await assert.rejects(
    runInTenantTx(pool, context, async () => {
      return { ok: true };
    }),
    /Serialization failure on COMMIT/
  );
  assert.equal(pool.isReleased, true);
  const sqls = pool.queryLog.map(q => q.sql);
  assert.equal(sqls[sqls.length - 1], 'ROLLBACK');
});

test('runInTenantTx does not swallow original error when ROLLBACK itself fails', async () => {
  const pool = createMockPool({
    onQuery: (sql) => {
      if (sql === 'ROLLBACK') throw new Error('Network dropped during ROLLBACK');
      return { rows: [], rowCount: 0 };
    }
  });
  const context = { agencyId: 'a1', locationId: 'l1', actorId: 'u1' };

  await assert.rejects(
    runInTenantTx(pool, context, async () => {
      throw new Error('Original query exception');
    }),
    /Original query exception/
  );
  assert.equal(pool.isReleased, true);
});

test('runInTenantTx isolates tenant context from subsequent mutations of the input object', async () => {
  const pool = createMockPool();
  const context = { agencyId: 'original-agency', locationId: 'original-loc', actorId: 'original-user' };

  await runInTenantTx(pool, context, async (tx) => {
    // Mutate the original context object externally
    context.agencyId = 'mutated-agency';
    context.locationId = 'mutated-loc';
    context.actorId = 'mutated-user';

    assert.equal(tx.agencyId, 'original-agency');
    assert.equal(tx.locationId, 'original-loc');
    assert.equal(tx.actorId, 'original-user');
    assert.equal(tx.context.agencyId, 'original-agency');
  });
});
