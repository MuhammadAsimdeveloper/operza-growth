import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createPipelinesRepository } from '../lib/pipelines-repository.mjs';

function createInMemoryPipelinesPool() {
  const pipelines = [];
  const pipelineStages = [];

  return {
    pipelines,
    pipelineStages,
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

          if (normSql.startsWith('INSERT INTO pipelines')) {
            const [id, agencyId, locationId, name, stagesStr, status, description, createdAt, updatedAt] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO pipelines');
            }
            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              name,
              stages: typeof stagesStr === 'string' ? JSON.parse(stagesStr) : (stagesStr || []),
              status: status || 'active',
              description: description || null,
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date()
            };
            pipelines.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('INSERT INTO pipeline_stages')) {
            const [id, agencyId, locationId, pipelineId, name, position, probability, status] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO pipeline_stages');
            }
            const existingIdx = pipelineStages.findIndex(
              s => s.agency_id === agencyId && s.location_id === locationId && s.pipeline_id === pipelineId && s.id === id
            );
            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              pipeline_id: pipelineId,
              name,
              position: Number(position) || 0,
              probability: Number(probability ?? 100),
              status: status || 'active',
              created_at: new Date()
            };
            if (existingIdx >= 0) {
              pipelineStages[existingIdx] = row;
            } else {
              pipelineStages.push(row);
            }
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3 AND id = $4')) {
            const [agencyId, locationId, pipelineId, stageId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const idx = pipelineStages.findIndex(
              s => s.agency_id === agencyId && s.location_id === locationId && s.pipeline_id === pipelineId && s.id === stageId
            );
            if (idx === -1) return { rows: [], rowCount: 0 };
            const removed = pipelineStages.splice(idx, 1);
            return { rows: removed, rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3')) {
            const [agencyId, locationId, pipelineId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            let removedCount = 0;
            for (let i = pipelineStages.length - 1; i >= 0; i--) {
              const s = pipelineStages[i];
              if (s.agency_id === agencyId && s.location_id === locationId && s.pipeline_id === pipelineId) {
                pipelineStages.splice(i, 1);
                removedCount++;
              }
            }
            return { rows: [], rowCount: removedCount };
          }

          if (normSql.startsWith('SELECT * FROM pipeline_stages WHERE agency_id = $1 AND location_id = $2 AND pipeline_id = $3')) {
            const [agencyId, locationId, pipelineId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const rows = pipelineStages
              .filter(s => s.agency_id === agencyId && s.location_id === locationId && s.pipeline_id === pipelineId)
              .sort((a, b) => a.position - b.position);
            return { rows, rowCount: rows.length };
          }

          if (normSql.startsWith('SELECT * FROM pipelines WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const match = pipelines.find(p => p.agency_id === agencyId && p.location_id === locationId && p.id === id);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT count(*)::int AS total FROM pipelines')) {
            const [agencyId, locationId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [{ total: 0 }], rowCount: 1 };
            const filtered = pipelines.filter(p => p.agency_id === agencyId && p.location_id === locationId);
            return { rows: [{ total: filtered.length }], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT * FROM pipelines WHERE agency_id = $1 AND location_id = $2')) {
            const [agencyId, locationId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const rows = pipelines.filter(p => p.agency_id === agencyId && p.location_id === locationId);
            return { rows, rowCount: rows.length };
          }

          if (normSql.startsWith('UPDATE pipelines')) {
            const [name, stagesStr, status, description, agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const target = pipelines.find(p => p.agency_id === agencyId && p.location_id === locationId && p.id === id);
            if (!target) return { rows: [], rowCount: 0 };
            target.name = name;
            target.stages = typeof stagesStr === 'string' ? JSON.parse(stagesStr) : stagesStr;
            target.status = status;
            target.description = description;
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM pipelines WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) return { rows: [], rowCount: 0 };
            const idx = pipelines.findIndex(p => p.agency_id === agencyId && p.location_id === locationId && p.id === id);
            if (idx === -1) return { rows: [], rowCount: 0 };
            const removed = pipelines.splice(idx, 1);
            for (let i = pipelineStages.length - 1; i >= 0; i--) {
              const s = pipelineStages[i];
              if (s.agency_id === agencyId && s.location_id === locationId && s.pipeline_id === id) {
                pipelineStages.splice(i, 1);
              }
            }
            return { rows: removed, rowCount: 1 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

test('PipelinesRepository — Full CRUD, normalized stages sync & TenantTx isolation', async () => {
  const pool = createInMemoryPipelinesPool();
  const repo = createPipelinesRepository();

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

  // 1. Create pipeline with stages
  const created = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.createPipeline(tx, {
      name: 'Enterprise Sales Pipeline',
      description: 'B2B outbound closing funnel',
      stages: [
        { name: 'Qualified Lead', probability: 20 },
        { name: 'Discovery Call', probability: 50 },
        { name: 'Closed Won', probability: 100 }
      ]
    });
  });

  assert.ok(created.id);
  assert.equal(created.name, 'Enterprise Sales Pipeline');
  assert.equal(created.stages.length, 3);
  assert.equal(pool.pipelineStages.length, 3, 'Normalized pipeline_stages rows must be created');

  // 2. Read & list under Tenant A
  const fetched = await runInTenantTx(pool, tenantA, async (tx) => repo.getPipelineById(tx, created.id));
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.stages[1].name, 'Discovery Call');

  const listed = await runInTenantTx(pool, tenantA, async (tx) => repo.listPipelines(tx));
  assert.equal(listed.pipelines.length, 1);
  assert.equal(listed.total, 1);

  // 3. Cross-tenant isolation: Tenant B cannot read or mutate Tenant A pipeline
  const tenantBFetch = await runInTenantTx(pool, tenantB, async (tx) => repo.getPipelineById(tx, created.id));
  assert.equal(tenantBFetch, null);

  const tenantBUpdate = await runInTenantTx(pool, tenantB, async (tx) => repo.updatePipeline(tx, created.id, { name: 'Hijacked' }));
  assert.equal(tenantBUpdate, null);

  // 4. Update pipeline & sync stages
  const updated = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.updatePipeline(tx, created.id, {
      name: 'Enterprise Sales v2',
      stages: [
        { id: fetched.stages[0].id, name: 'Qualified Lead', probability: 25 },
        { name: 'Proposal Sent', probability: 75 }
      ]
    });
  });
  assert.equal(updated.name, 'Enterprise Sales v2');
  assert.equal(updated.stages.length, 2);
  assert.equal(pool.pipelineStages.length, 2);

  // 5. Delete pipeline cascades stages
  const deleted = await runInTenantTx(pool, tenantA, async (tx) => repo.deletePipeline(tx, created.id));
  assert.equal(deleted, true);
  assert.equal(pool.pipelineStages.length, 0);
});
