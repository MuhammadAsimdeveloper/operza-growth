import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createContactsRepository } from '../lib/contacts-repository.mjs';

function createInMemoryStoragePool() {
  // Simulates PostgreSQL location_records table with RLS enforcement
  const locationRecords = []; // { id, agency_id, location_id, collection, body, created_at, updated_at }

  return {
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

          // INSERT into location_records
          if (normSql.startsWith('INSERT INTO location_records')) {
            const [id, agencyId, locationId, collection, bodyStr, createdAt, updatedAt] = params;
            // RLS check: cannot write outside set_config tenant
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT');
            }
            const body = typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr;
            const existingIdx = locationRecords.findIndex(
              r => r.id === id && r.agency_id === agencyId && r.location_id === locationId && r.collection === collection
            );
            const record = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              collection,
              body,
              created_at: new Date(createdAt),
              updated_at: new Date(updatedAt)
            };
            if (existingIdx >= 0) {
              locationRecords[existingIdx] = record;
            } else {
              locationRecords.push(record);
            }
            return { rows: [record], rowCount: 1 };
          }

          // SELECT by ID from location_records
          if (normSql.startsWith('SELECT') && normSql.includes('FROM location_records') && normSql.includes('id = $3')) {
            const [agencyId, locationId, id, collection] = params;
            // RLS filter: row only visible if agency_id = currentAgencyId and location_id = currentLocationId
            const row = locationRecords.find(
              r => r.id === id &&
                   r.agency_id === currentAgencyId &&
                   r.location_id === currentLocationId &&
                   r.collection === collection
            );
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
          }

          // SELECT list from location_records
          if (normSql.startsWith('SELECT') && normSql.includes('FROM location_records')) {
            const [agencyId, locationId, collection] = params;
            const rows = locationRecords.filter(
              r => r.agency_id === currentAgencyId &&
                   r.location_id === currentLocationId &&
                   r.collection === collection
            );
            return { rows, rowCount: rows.length };
          }

          // UPDATE location_records
          if (normSql.startsWith('UPDATE location_records')) {
            const [bodyStr, updatedAt, id, agencyId, locationId, collection] = params;
            const idx = locationRecords.findIndex(
              r => r.id === id &&
                   r.agency_id === currentAgencyId &&
                   r.location_id === currentLocationId &&
                   r.collection === collection
            );
            if (idx === -1) {
              return { rows: [], rowCount: 0 };
            }
            locationRecords[idx].body = JSON.parse(bodyStr);
            locationRecords[idx].updated_at = new Date(updatedAt);
            return { rows: [locationRecords[idx]], rowCount: 1 };
          }

          // DELETE FROM location_records
          if (normSql.startsWith('DELETE FROM location_records')) {
            const [id, agencyId, locationId, collection] = params;
            const idx = locationRecords.findIndex(
              r => r.id === id &&
                   r.agency_id === currentAgencyId &&
                   r.location_id === currentLocationId &&
                   r.collection === collection
            );
            if (idx === -1) {
              return { rows: [], rowCount: 0 };
            }
            const deleted = locationRecords.splice(idx, 1)[0];
            return { rows: [deleted], rowCount: 1 };
          }

          throw new Error(`Unhandled SQL: ${normSql}`);
        },
        release() {}
      };
    }
  };
}

test('ContactsRepository — CRUD lifecycle within TenantTx', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createContactsRepository();

  const tenantCtx = {
    agencyId: 'agency-alpha',
    locationId: 'loc-alpha-1',
    actorId: 'user-alice'
  };

  // 1. Create contact
  let createdContact = null;
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    createdContact = await repo.create(tx, {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@example.com',
      phone: '+15551234567',
      company: 'Acme Corp',
      tags: ['vip', 'lead'],
      status: 'lead'
    });
  });

  assert.ok(createdContact);
  assert.ok(createdContact.id);
  assert.equal(createdContact.firstName, 'John');
  assert.equal(createdContact.lastName, 'Doe');
  assert.equal(createdContact.email, 'john.doe@example.com');
  assert.equal(createdContact.agencyId, 'agency-alpha');
  assert.equal(createdContact.locationId, 'loc-alpha-1');
  assert.deepEqual(createdContact.tags, ['vip', 'lead']);

  // 2. Read contact by ID
  let fetchedContact = null;
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    fetchedContact = await repo.getById(tx, createdContact.id);
  });

  assert.ok(fetchedContact);
  assert.equal(fetchedContact.id, createdContact.id);
  assert.equal(fetchedContact.email, 'john.doe@example.com');

  // 3. Update contact
  let updatedContact = null;
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    updatedContact = await repo.update(tx, createdContact.id, {
      status: 'customer',
      company: 'Acme International'
    });
  });

  assert.ok(updatedContact);
  assert.equal(updatedContact.status, 'customer');
  assert.equal(updatedContact.company, 'Acme International');
  assert.equal(updatedContact.firstName, 'John'); // Unchanged fields preserved

  // 4. List contacts with filtering
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const listResult = await repo.list(tx, {
      search: 'Acme',
      tag: 'vip',
      status: 'customer'
    });
    assert.equal(listResult.data.length, 1);
    assert.equal(listResult.data[0].id, createdContact.id);
    assert.equal(listResult.pagination.total, 1);
  });

  // 5. Delete contact
  let deleteSuccess = false;
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    deleteSuccess = await repo.delete(tx, createdContact.id);
  });
  assert.equal(deleteSuccess, true);

  // 6. Verify deleted contact returns null
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    const afterDelete = await repo.getById(tx, createdContact.id);
    assert.equal(afterDelete, null);
  });
});

test('ContactsRepository — Strict multi-tenant isolation guarantees (Negative tests)', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createContactsRepository();

  const tenantA = {
    agencyId: 'agency-A',
    locationId: 'loc-A-1',
    actorId: 'user-A'
  };

  const tenantB = {
    agencyId: 'agency-B',
    locationId: 'loc-B-1',
    actorId: 'user-B'
  };

  // Tenant A creates a contact
  let contactA = null;
  await runInTenantTx(pool, tenantA, async (tx) => {
    contactA = await repo.create(tx, {
      firstName: 'Confidential',
      lastName: 'Client A',
      email: 'secret@corp-a.com',
      company: 'Corp A'
    });
  });

  assert.ok(contactA);

  // Tenant B attempts to read Tenant A's contact by ID -> Must return null
  await runInTenantTx(pool, tenantB, async (tx) => {
    const crossRead = await repo.getById(tx, contactA.id);
    assert.equal(crossRead, null, 'Tenant B must not be able to read Tenant A contact');
  });

  // Tenant B attempts to list contacts -> Must return empty array
  await runInTenantTx(pool, tenantB, async (tx) => {
    const listB = await repo.list(tx);
    assert.equal(listB.data.length, 0, 'Tenant B contact list must not contain Tenant A records');
    assert.equal(listB.pagination.total, 0);
  });

  // Tenant B attempts to update Tenant A's contact -> Must return null
  await runInTenantTx(pool, tenantB, async (tx) => {
    const crossUpdate = await repo.update(tx, contactA.id, {
      company: 'Hacked by B'
    });
    assert.equal(crossUpdate, null, 'Tenant B must not be able to update Tenant A contact');
  });

  // Tenant B attempts to delete Tenant A's contact -> Must return false
  await runInTenantTx(pool, tenantB, async (tx) => {
    const crossDelete = await repo.delete(tx, contactA.id);
    assert.equal(crossDelete, false, 'Tenant B must not be able to delete Tenant A contact');
  });

  // Verify Tenant A's contact is completely intact
  await runInTenantTx(pool, tenantA, async (tx) => {
    const verifyA = await repo.getById(tx, contactA.id);
    assert.ok(verifyA);
    assert.equal(verifyA.company, 'Corp A');
  });
});
