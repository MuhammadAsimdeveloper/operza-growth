import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createContactsRepository } from '../lib/contacts-repository.mjs';

function createInMemoryStoragePool() {
  // Simulates PostgreSQL location_records table with RLS enforcement
  const locationRecords = []; // { id, agency_id, location_id, collection, body, created_at, updated_at }
  const opportunities = []; // { id, agency_id, location_id, contact_id, name, status, created_at }
  const auditEvents = []; // { id, agency_id, location_id, action, details, created_at }

  return {
    locationRecords,
    opportunities,
    auditEvents,
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

          // SELECT by ID from location_records (explicit id = $3 AND collection = $4, avoiding location_id = $3 substring match)
          if (normSql.startsWith('SELECT') && normSql.includes('FROM location_records') && normSql.includes('id = $3 AND collection = $4')) {
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

          // SELECT timeline items from location_records (tasks, notes)
          if (normSql.startsWith('SELECT') && normSql.includes('FROM location_records') && normSql.includes("collection IN ('tasks', 'notes')")) {
            const [contactId, agencyId, locationId] = params;
            const rows = locationRecords.filter(
              r => r.agency_id === currentAgencyId &&
                   r.location_id === currentLocationId &&
                   (r.collection === 'tasks' || r.collection === 'notes') &&
                   (r.body?.contactId === contactId)
            );
            return { rows, rowCount: rows.length };
          }

          // SELECT list from location_records
          if (normSql.startsWith('SELECT') && normSql.includes('FROM location_records') && normSql.includes('collection = $3')) {
            const [agencyId, locationId, collection] = params;
            const rows = locationRecords.filter(
              r => r.agency_id === currentAgencyId &&
                   r.location_id === currentLocationId &&
                   r.collection === collection
            );
            return { rows, rowCount: rows.length };
          }

          // SELECT opportunities by contact_id
          if (normSql.startsWith('SELECT') && normSql.includes('FROM opportunities') && normSql.includes('contact_id = $1')) {
            const [contactId, agencyId, locationId] = params;
            const rows = opportunities.filter(
              o => o.agency_id === currentAgencyId &&
                   o.location_id === currentLocationId &&
                   o.contact_id === contactId
            );
            return { rows, rowCount: rows.length };
          }

          // SELECT audit events for contact
          if (normSql.startsWith('SELECT') && normSql.includes('FROM agency_audit_events')) {
            const [agencyId, locationId, contactId] = params;
            const rows = auditEvents.filter(
              a => a.agency_id === currentAgencyId &&
                   (a.location_id === currentLocationId || !a.location_id) &&
                   (a.details?.contactId === contactId || a.details?.id === contactId)
            );
            return { rows, rowCount: rows.length };
          }

          // UPDATE location_records (normal contact update)
          if (normSql.startsWith('UPDATE location_records') && normSql.includes('SET body = $1::jsonb')) {
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

          // UPDATE location_records re-linking contactId on related items (tasks, notes)
          if (normSql.startsWith('UPDATE location_records') && normSql.includes('jsonb_set')) {
            const [primaryId, mergeId, agencyId, locationId] = params;
            let updatedCount = 0;
            for (const r of locationRecords) {
              if (r.agency_id === currentAgencyId && r.location_id === currentLocationId && r.body?.contactId === mergeId) {
                r.body.contactId = primaryId;
                r.updated_at = new Date();
                updatedCount++;
              }
            }
            return { rows: [], rowCount: updatedCount };
          }

          // UPDATE opportunities re-linking contact_id
          if (normSql.startsWith('UPDATE opportunities') && normSql.includes('SET contact_id = $1')) {
            const [primaryId, mergeId, agencyId, locationId] = params;
            let updatedCount = 0;
            for (const o of opportunities) {
              if (o.agency_id === currentAgencyId && o.location_id === currentLocationId && o.contact_id === mergeId) {
                o.contact_id = primaryId;
                updatedCount++;
              }
            }
            return { rows: [], rowCount: updatedCount };
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

test('ContactsRepository — Atomic Contact Merge with relational re-linking', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createContactsRepository();

  const tenantCtx = {
    agencyId: 'agency-merge-test',
    locationId: 'loc-merge-1',
    actorId: 'user-merger'
  };

  let primaryId, dupId;
  await runInTenantTx(pool, tenantCtx, async (tx) => {
    // 1. Create primary contact
    const primary = await repo.create(tx, {
      firstName: 'Alice',
      lastName: '',
      email: 'alice@example.com',
      company: '',
      tags: ['lead']
    });
    primaryId = primary.id;

    // 2. Create duplicate contact with additional details
    const dup = await repo.create(tx, {
      firstName: 'Alice',
      lastName: 'Smith',
      email: '',
      phone: '+15559876543',
      company: 'Wonderland Inc',
      tags: ['vip', 'conference']
    });
    dupId = dup.id;

    // Seed opportunity for dup contact
    pool.opportunities.push({
      id: 'opp-1',
      agency_id: tenantCtx.agencyId,
      location_id: tenantCtx.locationId,
      contact_id: dupId,
      name: 'Alice Expansion Deal',
      status: 'open'
    });

    // Seed task for dup contact in location_records
    pool.locationRecords.push({
      id: 'task-1',
      agency_id: tenantCtx.agencyId,
      location_id: tenantCtx.locationId,
      collection: 'tasks',
      body: { title: 'Follow up with Alice', contactId: dupId },
      created_at: new Date(),
      updated_at: new Date()
    });

    // 3. Execute atomic merge
    const mergeResult = await repo.merge(tx, {
      primaryId,
      mergeIds: [dupId]
    });

    assert.equal(mergeResult.success, true);
    assert.equal(mergeResult.primaryId, primaryId);
    assert.equal(mergeResult.mergedCount, 1);
    assert.deepEqual(mergeResult.mergedIds, [dupId]);

    // Verify primary contact merged fields
    assert.equal(mergeResult.contact.lastName, 'Smith');
    assert.equal(mergeResult.contact.email, 'alice@example.com');
    assert.equal(mergeResult.contact.phone, '+15559876543');
    assert.equal(mergeResult.contact.company, 'Wonderland Inc');
    assert.ok(mergeResult.contact.tags.includes('lead'));
    assert.ok(mergeResult.contact.tags.includes('vip'));
    assert.ok(mergeResult.contact.tags.includes('conference'));

    // Verify duplicate contact was deleted from location_records
    const fetchedDup = await repo.getById(tx, dupId);
    assert.equal(fetchedDup, null);

    // Verify related records were re-linked to primaryId
    assert.equal(pool.opportunities[0].contact_id, primaryId);
    const updatedTask = pool.locationRecords.find(r => r.id === 'task-1');
    assert.equal(updatedTask.body.contactId, primaryId);
  });
});

test('ContactsRepository — Merge cross-tenant isolation and failure rollback', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createContactsRepository();

  const tenantA = { agencyId: 'agency-A', locationId: 'loc-A', actorId: 'user-A' };
  const tenantB = { agencyId: 'agency-B', locationId: 'loc-B', actorId: 'user-B' };

  let contactA, contactB;
  await runInTenantTx(pool, tenantA, async (tx) => {
    contactA = await repo.create(tx, { firstName: 'Contact', lastName: 'A', company: 'Company A' });
  });

  await runInTenantTx(pool, tenantB, async (tx) => {
    contactB = await repo.create(tx, { firstName: 'Contact', lastName: 'B', company: 'Company B' });
  });

  // Tenant A attempts to merge contact B (foreign tenant) -> Must throw and abort
  await assert.rejects(
    runInTenantTx(pool, tenantA, async (tx) => {
      await repo.merge(tx, {
        primaryId: contactA.id,
        mergeIds: [contactB.id]
      });
    }),
    /Secondary contact .* not found/
  );

  // Verify contact B is intact in tenant B
  await runInTenantTx(pool, tenantB, async (tx) => {
    const verifiedB = await repo.getById(tx, contactB.id);
    assert.ok(verifiedB);
    assert.equal(verifiedB.company, 'Company B');
  });
});

test('ContactsRepository — Contact Activity Timeline retrieval and tenant isolation', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createContactsRepository();

  const tenantA = { agencyId: 'agency-timeline-A', locationId: 'loc-t-A', actorId: 'user-A' };
  const tenantB = { agencyId: 'agency-timeline-B', locationId: 'loc-t-B', actorId: 'user-B' };

  let contactA;
  await runInTenantTx(pool, tenantA, async (tx) => {
    contactA = await repo.create(tx, {
      firstName: 'Sarah',
      lastName: 'Connor',
      source: 'web_form'
    });

    pool.opportunities.push({
      id: 'opp-t-1',
      agency_id: tenantA.agencyId,
      location_id: tenantA.locationId,
      contact_id: contactA.id,
      name: 'Defense Contract',
      status: 'open',
      created_at: new Date(Date.now() + 1000)
    });

    pool.locationRecords.push({
      id: 'task-t-1',
      agency_id: tenantA.agencyId,
      location_id: tenantA.locationId,
      collection: 'tasks',
      body: { title: 'Prepare perimeter defense', status: 'pending', contactId: contactA.id },
      created_at: new Date(Date.now() + 2000),
      updated_at: new Date(Date.now() + 2000)
    });

    pool.auditEvents.push({
      id: 'audit-t-1',
      agency_id: tenantA.agencyId,
      location_id: tenantA.locationId,
      action: 'crm.contact.verified',
      details: { contactId: contactA.id },
      created_at: new Date(Date.now() + 3000)
    });

    const timelineRes = await repo.getTimeline(tx, contactA.id);
    assert.ok(timelineRes);
    assert.equal(timelineRes.contactId, contactA.id);
    assert.equal(timelineRes.name, 'Sarah Connor');
    assert.ok(Array.isArray(timelineRes.timeline));
    assert.ok(timelineRes.timeline.length >= 4); // created, opp, task, audit

    // Timeline must be sorted descending by date
    for (let i = 0; i < timelineRes.timeline.length - 1; i++) {
      const d1 = new Date(timelineRes.timeline[i].date).getTime();
      const d2 = new Date(timelineRes.timeline[i + 1].date).getTime();
      assert.ok(d1 >= d2, 'Timeline events must be sorted descending');
    }
  });

  // Tenant B attempts to get timeline for Tenant A's contact -> Must return null
  await runInTenantTx(pool, tenantB, async (tx) => {
    const crossTimeline = await repo.getTimeline(tx, contactA.id);
    assert.equal(crossTimeline, null, 'Tenant B must not access Tenant A timeline');
  });
});
