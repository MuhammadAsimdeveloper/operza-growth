import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createOpportunitiesRepository } from '../lib/opportunities-repository.mjs';

function createInMemoryStoragePool() {
  const opportunities = []; // { id, agency_id, location_id, pipeline_id, stage_id, contact_id, name, value, status, owner_id, close_date, source, custom_values, created_at, updated_at }

  return {
    opportunities,
    async connect() {
      let currentAgencyId = null;
      let currentLocationId = null;
      let currentUserId = null;
      let inTx = false;

      return {
        async query(sql, params = []) {
          const normSql = sql.replace(/\s+/g, ' ').trim();

          if (normSql === 'BEGIN') {
            inTx = true;
            return { rows: [], rowCount: 0 };
          }
          if (normSql === 'COMMIT' || normSql === 'ROLLBACK') {
            inTx = false;
            currentAgencyId = null;
            currentLocationId = null;
            currentUserId = null;
            return { rows: [], rowCount: 0 };
          }
          if (normSql.includes("set_config('app.agency_id'")) {
            currentAgencyId = params[0];
            currentLocationId = params[1];
            currentUserId = params[2];
            return { rows: [], rowCount: 0 };
          }

          // INSERT into opportunities
          if (normSql.startsWith('INSERT INTO opportunities')) {
            const [
              id, agencyId, locationId, pipelineId, stageId, contactId,
              name, value, status, ownerId, closeDate, source, customValuesStr,
              createdAt, updatedAt
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT');
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              pipeline_id: pipelineId,
              stage_id: stageId,
              contact_id: contactId,
              name,
              value: Number(value),
              status,
              owner_id: ownerId,
              close_date: closeDate,
              source,
              custom_values: typeof customValuesStr === 'string' ? JSON.parse(customValuesStr) : customValuesStr,
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date()
            };
            opportunities.push(row);
            return { rows: [row], rowCount: 1 };
          }

          // SELECT count(*) FROM opportunities
          if (normSql.startsWith('SELECT count(*) as count FROM opportunities') || normSql.startsWith('SELECT count(*)::int as count FROM opportunities')) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [{ count: 0 }], rowCount: 1 };
            }
            let filtered = opportunities.filter(o => o.agency_id === agencyId && o.location_id === locationId);
            return { rows: [{ count: filtered.length }], rowCount: 1 };
          }

          // SELECT single opportunity by ID
          if (normSql.startsWith('SELECT * FROM opportunities WHERE id = $1')) {
            const [id, agencyId, locationId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const match = opportunities.find(o => o.id === id && o.agency_id === agencyId && o.location_id === locationId);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          // SELECT pipeline summary aggregation
          if (normSql.includes('GROUP BY stage_id, status')) {
            const agencyId = params[0];
            const locationId = params[1];
            const pipelineId = params[2];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const filtered = opportunities.filter(o =>
              o.agency_id === agencyId &&
              o.location_id === locationId &&
              (!pipelineId || o.pipeline_id === pipelineId)
            );

            const groups = {};
            for (const item of filtered) {
              const key = `${item.stage_id}::${item.status}`;
              if (!groups[key]) {
                groups[key] = {
                  stage_id: item.stage_id,
                  status: item.status,
                  count: 0,
                  total_value: 0
                };
              }
              groups[key].count += 1;
              groups[key].total_value += Number(item.value || 0);
            }
            return { rows: Object.values(groups), rowCount: Object.values(groups).length };
          }

          // SELECT list with filters
          if (normSql.startsWith('SELECT * FROM opportunities WHERE agency_id = $1 AND location_id = $2')) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            let filtered = opportunities.filter(o => o.agency_id === agencyId && o.location_id === locationId);

            if (normSql.includes('pipeline_id = $3') && params[2]) {
              filtered = filtered.filter(o => o.pipeline_id === params[2]);
            }
            if (normSql.includes('stage_id = $4') && params[3]) {
              filtered = filtered.filter(o => o.stage_id === params[3]);
            }
            if (normSql.includes('status = $5') && params[4]) {
              filtered = filtered.filter(o => o.status === params[4]);
            }
            if (normSql.includes('contact_id = $6') && params[5]) {
              filtered = filtered.filter(o => o.contact_id === params[5]);
            }

            return { rows: filtered, rowCount: filtered.length };
          }

          // UPDATE opportunities
          if (normSql.startsWith('UPDATE opportunities SET')) {
            const id = params[10];
            const agencyId = params[11];
            const locationId = params[12];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const idx = opportunities.findIndex(o => o.id === id && o.agency_id === agencyId && o.location_id === locationId);
            if (idx === -1) {
              return { rows: [], rowCount: 0 };
            }
            const updated = {
              ...opportunities[idx],
              name: params[0],
              value: Number(params[1]),
              status: params[2],
              pipeline_id: params[3],
              stage_id: params[4],
              contact_id: params[5],
              owner_id: params[6],
              close_date: params[7],
              source: params[8],
              custom_values: typeof params[9] === 'string' ? JSON.parse(params[9]) : params[9],
              updated_at: new Date()
            };
            opportunities[idx] = updated;
            return { rows: [updated], rowCount: 1 };
          }

          // DELETE opportunities
          if (normSql.startsWith('DELETE FROM opportunities WHERE id = $1')) {
            const [id, agencyId, locationId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const idx = opportunities.findIndex(o => o.id === id && o.agency_id === agencyId && o.location_id === locationId);
            if (idx === -1) {
              return { rows: [], rowCount: 0 };
            }
            opportunities.splice(idx, 1);
            return { rows: [], rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

test('OpportunitiesRepository — Full CRUD lifecycle under TenantTx', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createOpportunitiesRepository();

  const tenantCtx = {
    agencyId: '11111111-1111-4111-8111-111111111111',
    locationId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333'
  };

  const pipelineId = '44444444-4444-4444-8444-444444444444';
  const stageLead = '55555555-5555-4555-8555-555555555555';
  const stageClosed = '66666666-6666-4666-8666-666666666666';

  let createdOppId = null;

  // 1. Create Opportunity
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const opp = await repo.create(tx, {
      name: 'Enterprise Contract Q4',
      value: 45000,
      pipelineId,
      stageId: stageLead,
      status: 'open',
      source: 'Inbound Ingress'
    });

    assert.ok(opp.id);
    assert.equal(opp.name, 'Enterprise Contract Q4');
    assert.equal(opp.value, 45000);
    assert.equal(opp.agencyId, tenantCtx.agencyId);
    assert.equal(opp.locationId, tenantCtx.locationId);
    assert.equal(opp.status, 'open');
    createdOppId = opp.id;
  });

  // 2. Get Opportunity by ID
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const opp = await repo.getById(tx, createdOppId);
    assert.ok(opp);
    assert.equal(opp.id, createdOppId);
    assert.equal(opp.value, 45000);
  });

  // 3. List Opportunities
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const res = await repo.list(tx, { pipelineId });
    assert.equal(res.total, 1);
    assert.equal(res.opportunities.length, 1);
    assert.equal(res.opportunities[0].id, createdOppId);
  });

  // 4. Update Stage / Status
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const updated = await repo.updateStage(tx, createdOppId, {
      pipelineId,
      stageId: stageClosed,
      status: 'won'
    });
    assert.equal(updated.stageId, stageClosed);
    assert.equal(updated.status, 'won');
  });

  // 5. Delete Opportunity
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const deleted = await repo.delete(tx, createdOppId);
    assert.equal(deleted, true);

    const check = await repo.getById(tx, createdOppId);
    assert.equal(check, null);
  });
});

test('OpportunitiesRepository — Strict multi-tenant isolation guarantees', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createOpportunitiesRepository();

  const tenantA = {
    agencyId: 'aaaa1111-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    locationId: 'aaaa2222-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actorId: 'aaaa3333-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  };

  const tenantB = {
    agencyId: 'bbbb1111-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    locationId: 'bbbb2222-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actorId: 'bbbb3333-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  };

  let oppAId = null;

  // Tenant A creates an opportunity
  await runInTenantTx(pool, tenantA, async (tx) => {
    const opp = await repo.create(tx, {
      name: 'Confidential Deal A',
      value: 100000,
      pipelineId: 'p-1',
      stageId: 's-1'
    });
    oppAId = opp.id;
  });

  // Tenant B cannot retrieve Tenant A's opportunity
  await runInTenantTx(pool, tenantB, async (tx) => {
    const opp = await repo.getById(tx, oppAId);
    assert.equal(opp, null, 'Tenant B must receive null when querying Tenant A opportunity');

    const list = await repo.list(tx);
    assert.equal(list.total, 0, 'Tenant B must see 0 opportunities');

    const updated = await repo.update(tx, oppAId, { name: 'Compromised' });
    assert.equal(updated, null, 'Tenant B cannot update Tenant A opportunity');

    const deleted = await repo.delete(tx, oppAId);
    assert.equal(deleted, false, 'Tenant B cannot delete Tenant A opportunity');
  });
});

test('OpportunitiesRepository — Pipeline summary aggregation', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createOpportunitiesRepository();

  const tenantCtx = {
    agencyId: '11111111-1111-4111-8111-111111111111',
    locationId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333'
  };

  const pipelineId = 'p-sales';
  const stage1 = 's-lead';
  const stage2 = 's-demo';

  await runInTenantTx(pool, tenantCtx, async (tx) => {
    await repo.create(tx, { name: 'Deal 1', value: 1000, pipelineId, stageId: stage1, status: 'open' });
    await repo.create(tx, { name: 'Deal 2', value: 2000, pipelineId, stageId: stage1, status: 'open' });
    await repo.create(tx, { name: 'Deal 3', value: 5000, pipelineId, stageId: stage2, status: 'won' });

    const summary = await repo.getPipelineSummary(tx, pipelineId);
    assert.ok(Array.isArray(summary));

    const stage1Summary = summary.find(s => s.stageId === stage1 && s.status === 'open');
    assert.ok(stage1Summary);
    assert.equal(stage1Summary.count, 2);
    assert.equal(stage1Summary.totalValue, 3000);

    const stage2Summary = summary.find(s => s.stageId === stage2 && s.status === 'won');
    assert.ok(stage2Summary);
    assert.equal(stage2Summary.count, 1);
    assert.equal(stage2Summary.totalValue, 5000);
  });
});

test('OpportunitiesRepository — Sort allowlist protection', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createOpportunitiesRepository();

  const tenantCtx = {
    agencyId: '11111111-1111-4111-8111-111111111111',
    locationId: '22222222-2222-4222-8222-222222222222',
    actorId: '33333333-3333-4333-8333-333333333333'
  };

  await runInTenantTx(pool, tenantCtx, async (tx) => {
    // Attempt SQL injection in sortBy
    await assert.rejects(
      async () => {
        await repo.list(tx, { sortBy: 'value; DROP TABLE opportunities; --' });
      },
      /INVALID_SORT_FIELD/
    );
  });
});
