import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createFunnelsRepository } from '../lib/funnels-repository.mjs';

function createInMemoryFunnelsPool() {
  const records = []; // { id, agency_id, location_id, collection, body, created_at, updated_at }

  return {
    records,
    async connect() {
      let currentAgencyId = null;
      let currentLocationId = null;

      return {
        async query(sql, params = []) {
          const normSql = sql.replace(/\s+/g, ' ').trim();

          if (normSql === 'BEGIN') return { rows: [], rowCount: 0 };
          if (normSql === 'COMMIT' || normSql === 'ROLLBACK') {
            currentAgencyId = null;
            currentLocationId = null;
            return { rows: [], rowCount: 0 };
          }
          if (normSql.includes("set_config('app.agency_id'")) {
            currentAgencyId = params[0];
            currentLocationId = params[1];
            return { rows: [], rowCount: 0 };
          }

          if (normSql.startsWith('INSERT INTO location_records')) {
            const [id, agencyId, locationId, collection, bodyStr, createdAt, updatedAt] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO location_records');
            }
            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              collection,
              body: typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr,
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date()
            };
            records.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT * FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4')) {
            const [agencyId, locationId, collection, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const match = records.find(r => r.agency_id === agencyId && r.location_id === locationId && r.collection === collection && r.id === id);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT * FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3')) {
            const [agencyId, locationId, collection] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const rows = records.filter(r => r.agency_id === agencyId && r.location_id === locationId && r.collection === collection);
            return { rows, rowCount: rows.length };
          }

          if (normSql.startsWith('UPDATE location_records')) {
            const [bodyStr, agencyId, locationId, collection, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const target = records.find(r => r.agency_id === agencyId && r.location_id === locationId && r.collection === collection && r.id === id);
            if (!target) return { rows: [], rowCount: 0 };
            target.body = typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr;
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4')) {
            const [agencyId, locationId, collection, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const idx = records.findIndex(r => r.agency_id === agencyId && r.location_id === locationId && r.collection === collection && r.id === id);
            if (idx === -1) return { rows: [], rowCount: 0 };
            const removed = records.splice(idx, 1);
            return { rows: removed, rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

test('FunnelsRepository — CRUD, visit/optin counters & TenantTx isolation', async () => {
  const pool = createInMemoryFunnelsPool();
  const repo = createFunnelsRepository();

  const tenantA = {
    agencyId: '11111111-1111-4111-8111-111111111111',
    locationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actorId: 'user-a'
  };

  const tenantB = {
    agencyId: '22222222-2222-4222-8222-222222222222',
    locationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actorId: 'user-b'
  };

  const created = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.createFunnel(tx, {
      name: 'Scale Masterclass',
      slug: 'scale-masterclass',
      kind: 'funnel',
      published: true,
      pages: [{ id: 'p1', slug: 'optin', title: 'Opt-in' }]
    });
  });

  assert.ok(created.id);
  assert.equal(created.slug, 'scale-masterclass');
  assert.equal(created.visits, 0);

  const visited = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.recordVisit(tx, created.id, 'optin');
  });
  assert.equal(visited.visits, 1);
  assert.equal(visited.pages[0].visits, 1);

  const optedIn = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.recordOptin(tx, created.id, 'optin');
  });
  assert.equal(optedIn.optins, 1);
  assert.equal(optedIn.pages[0].optins, 1);

  // Tenant B isolation
  const tenantBRead = await runInTenantTx(pool, tenantB, async (tx) => repo.getFunnelById(tx, created.id));
  assert.equal(tenantBRead, null);

  const deleted = await runInTenantTx(pool, tenantA, async (tx) => repo.deleteFunnel(tx, created.id));
  assert.equal(deleted, true);
});
