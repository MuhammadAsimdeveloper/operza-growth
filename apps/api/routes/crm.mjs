/**
 * ============================================================================
 * Operza CRM Domain Routes & Smart List Saved Views Subsystem
 * ============================================================================
 * Handles contacts aggregate CRUD, bulk contact operations, formula-defended
 * CSV import/export, contact merging, activity timelines, and AST-driven Smart
 * Lists. Employs TenantTx and ContactsRepository for PostgreSQL RLS boundary.
 */

import { parseAndValidateCsvImport, exportContactsToCsv } from '../../../packages/platform-core/src/csv-transfer.mjs';
import { createSmartListView, filterSmartListRecords } from '../../../packages/platform-core/src/crm-views-store.mjs';
import { createContactsRepository } from '../../../packages/db/lib/contacts-repository.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';

const contactsRepo = createContactsRepository();

export async function handleCrmRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    actor,
    agency,
    activeLocation,
    randomUUID,
    parseCSV,
    pgPool,
    triggerWorkflowExecution,
    dispatchZapierEvent,
    zapierRepository,
    syncRelationalWrite
  } = ctx;

  if (!pathname.startsWith('/api/crm/')) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Bulk Tag Contacts: POST /api/crm/contacts/bulk-tag
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/crm/contacts/bulk-tag') {
    const body = await readBody(req);
    const { contactIds, tag } = body;
    if (!Array.isArray(contactIds) || !tag) {
      sendJson(res, 400, { error: 'contactIds array and tag required' });
      return true;
    }

    let updated = 0;
    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.bulkTag(tx, { contactIds, tag });
      });
    }

    // Keep in-memory state in sync
    state.records.contacts = state.records.contacts || [];
    for (const id of contactIds) {
      const contact = state.records.contacts.find(
        c => c.id === id && c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      if (contact) {
        contact.tags = Array.from(new Set([...(contact.tags || []), tag]));
        contact.updatedAt = new Date().toISOString();
        if (!pgPool) updated++;
      }
    }

    await saveState();
    auditLog('crm.contacts.bulk_tag', actor, { tag, count: updated });
    broadcast('crm.contacts.bulk_updated', { tag, count: updated });
    sendJson(res, 200, { success: true, updated });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Import Contacts: POST /api/crm/contacts/import
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/crm/contacts/import') {
    const body = await readBody(req);
    const csvText = body.csv || body.data || '';
    if (!csvText) {
      sendJson(res, 400, { error: 'csv field with CSV text is required' });
      return true;
    }

    state.records.contacts = state.records.contacts || [];
    const tenantExisting = state.records.contacts.filter(c => c.agencyId === agency.id && c.locationId === activeLocation.id);

    let parsedPlan = null;
    try {
      parsedPlan = parseAndValidateCsvImport({
        text: csvText,
        agencyId: agency.id,
        locationId: activeLocation.id,
        existingContacts: body.allowDuplicates ? [] : tenantExisting
      });
    } catch {
      parsedPlan = null;
    }

    const imported = [];
    const toImportRows = [];

    if (parsedPlan && parsedPlan.validRecords.length > 0) {
      for (const item of parsedPlan.validRecords) {
        toImportRows.push({
          firstName: item.firstName || '',
          lastName: item.lastName || '',
          email: item.email || '',
          phone: item.phone || '',
          company: item.company || '',
          source: 'CSV Import',
          tags: item.tags?.length ? item.tags : ['imported'],
          leadScore: item.leadScore || 0,
          status: 'lead',
          notes: ''
        });
      }
    } else if (typeof parseCSV === 'function') {
      const rows = parseCSV(csvText);
      for (const row of rows) {
        toImportRows.push({
          firstName: row.firstName || row.first_name || row.name || '',
          lastName: row.lastName || row.last_name || '',
          email: row.email || '',
          phone: row.phone || '',
          company: row.company || '',
          source: 'CSV Import',
          tags: row.tags ? row.tags.split(';').map(t => t.trim()) : ['imported'],
          status: row.status || 'lead',
          notes: row.notes || ''
        });
      }
    }

    if (pgPool && toImportRows.length > 0) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        for (const item of toImportRows) {
          const contact = await contactsRepo.create(tx, item);
          imported.push(contact);
        }
      });
    } else {
      for (const item of toImportRows) {
        const contact = {
          ...item,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        imported.push(contact);
      }
    }

    for (const c of imported) {
      const idx = state.records.contacts.findIndex(x => x.id === c.id);
      if (idx >= 0) state.records.contacts[idx] = c;
      else state.records.contacts.push(c);
    }

    await saveState();
    auditLog('crm.contacts.import', actor, { count: imported.length });
    broadcast('crm.contacts.imported', { count: imported.length });
    sendJson(res, 201, {
      success: true,
      imported: imported.length,
      contacts: imported.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email })),
      plan: parsedPlan ? { rowCount: parsedPlan.rowCount, duplicateCount: parsedPlan.duplicateCount } : null
    });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Export Contacts: GET / POST /api/crm/contacts/export-csv
  // ─────────────────────────────────────────────────────────────────────────
  if ((method === 'GET' || method === 'POST') && pathname === '/api/crm/contacts/export-csv') {
    let tenantContacts = [];
    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      const listRes = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.list(tx, { limit: 1000 });
      });
      tenantContacts = listRes.data;
    } else {
      state.records.contacts = state.records.contacts || [];
      tenantContacts = state.records.contacts.filter(c => c.agencyId === agency.id && c.locationId === activeLocation.id);
    }

    const csvOutput = exportContactsToCsv({ contacts: tenantContacts });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts-export.csv"'
    });
    res.end(csvOutput);
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Contact Merge / Dedup: POST /api/crm/contacts/merge
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/crm/contacts/merge') {
    const body = await readBody(req);
    const { primaryId, mergeIds } = body;
    if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
      sendJson(res, 400, { error: 'primaryId and mergeIds array required' });
      return true;
    }

    const contacts = state.records.contacts || [];
    let primary = contacts.find(c => c.id === primaryId && c.agencyId === agency.id && c.locationId === activeLocation.id);

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      const pgPrimary = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.getById(tx, primaryId);
      });
      if (!primary && pgPrimary) primary = pgPrimary;
    }

    if (!primary) {
      sendJson(res, 404, { error: 'Primary contact not found' });
      return true;
    }

    const merged = [];
    for (const mergeId of mergeIds) {
      if (mergeId === primaryId) continue;
      const idx = contacts.findIndex(c => c.id === mergeId && c.agencyId === agency.id && c.locationId === activeLocation.id);
      const dup = idx >= 0 ? contacts[idx] : null;

      if (dup) {
        for (const field of ['lastName', 'email', 'phone', 'company', 'source', 'notes']) {
          if (!primary[field] && dup[field]) primary[field] = dup[field];
        }
        primary.tags = Array.from(new Set([...(primary.tags || []), ...(dup.tags || [])]));
      }

      // Re-link related records
      for (const opp of (state.records.opportunities || [])) {
        if (opp.contactId === mergeId) opp.contactId = primaryId;
      }
      for (const task of (state.records.tasks || [])) {
        if (task.contactId === mergeId) task.contactId = primaryId;
      }
      for (const note of (state.records.notes || [])) {
        if (note.contactId === mergeId) note.contactId = primaryId;
      }

      if (idx >= 0) contacts.splice(idx, 1);
      merged.push(mergeId);

      // Delete duplicate in database if pgPool is active
      if (pgPool) {
        const tenantCtx = {
          agencyId: agency.id,
          locationId: activeLocation.id,
          actorId: actor?.user?.id || actor?.keyId || 'system'
        };
        await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          await contactsRepo.delete(tx, mergeId);
        }).catch(() => {});
      }
    }

    primary.updatedAt = new Date().toISOString();

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        await contactsRepo.update(tx, primary.id, primary);
      }).catch(() => {});
    }

    await saveState();
    auditLog('crm.contacts.merge', actor, { primaryId, mergedIds: merged });
    sendJson(res, 200, { success: true, primaryId, mergedCount: merged.length, mergedIds: merged });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Contact Activity Timeline: GET /api/crm/contacts/:id/timeline
  // ─────────────────────────────────────────────────────────────────────────
  const timelineMatch = pathname.match(/^\/api\/crm\/contacts\/([a-zA-Z0-9_-]+)\/timeline$/);
  if (method === 'GET' && timelineMatch) {
    const contactId = timelineMatch[1];
    let contact = (state.records.contacts || []).find(
      c => c.id === contactId && c.agencyId === agency.id && c.locationId === activeLocation.id
    );

    if (!contact && pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      contact = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.getById(tx, contactId);
      });
    }

    if (!contact) {
      sendJson(res, 404, { error: 'Contact not found' });
      return true;
    }

    const timeline = [];
    timeline.push({ type: 'contact_created', date: contact.createdAt, detail: `Contact created from ${contact.source || 'manual'}` });

    for (const opp of (state.records.opportunities || [])) {
      if (opp.contactId === contactId) {
        timeline.push({ type: 'opportunity', date: opp.createdAt, detail: `Opportunity: ${opp.name} (${opp.stage})`, recordId: opp.id });
      }
    }
    for (const task of (state.records.tasks || [])) {
      if (task.contactId === contactId) {
        timeline.push({ type: 'task', date: task.createdAt, detail: `Task: ${task.title} (${task.status})`, recordId: task.id });
      }
    }
    for (const note of (state.records.notes || [])) {
      if (note.contactId === contactId) {
        timeline.push({ type: 'note', date: note.createdAt, detail: `Note: ${(note.text || '').slice(0, 100)}`, recordId: note.id });
      }
    }
    for (const entry of (state.audit || [])) {
      if (entry.details && (entry.details.contactId === contactId || entry.details.id === contactId)) {
        timeline.push({ type: 'audit', date: entry.timestamp, detail: entry.action });
      }
    }

    timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    sendJson(res, 200, {
      contactId,
      name: `${contact.firstName} ${contact.lastName}`,
      timeline,
      events: timeline
    });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Client Portal Access Toggle: PUT /api/crm/contacts/:id/portal-access
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'PUT' && pathname.startsWith('/api/crm/contacts/') && pathname.endsWith('/portal-access')) {
    const contactId = pathname.replace('/api/crm/contacts/', '').replace('/portal-access', '').trim();
    state.records.contacts = state.records.contacts || [];
    let contact = state.records.contacts.find(c => c.id === contactId && c.agencyId === agency.id);

    if (!contact && pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      contact = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.getById(tx, contactId);
      });
    }

    if (!contact) {
      return sendJson(res, 404, { error: 'Contact not found' });
    }

    const body = await readBody(req);
    const granted = body.portalAccess !== undefined ? Boolean(body.portalAccess) : true;
    contact.portalAccess = granted;

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        await contactsRepo.update(tx, contactId, { portalAccess: granted });
      }).catch(() => {});
    }

    await saveState();
    broadcast('contact.portalAccess.updated', { contactId: contact.id, portalAccess: granted });
    auditLog('contact.portal_access', actor, { contactId: contact.id, granted });

    return sendJson(res, 200, { success: true, contactId: contact.id, portalAccess: granted });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Contacts Collection List: GET /api/crm/contacts
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/crm/contacts') {
    let result = null;

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      result = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.list(tx, {
          search: queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q'),
          tag: queryUrl.searchParams.get('tag'),
          status: queryUrl.searchParams.get('status'),
          sort: queryUrl.searchParams.get('sort') || 'createdAt',
          order: queryUrl.searchParams.get('order') || 'desc',
          page: queryUrl.searchParams.get('page'),
          limit: queryUrl.searchParams.get('limit')
        });
      });
    } else {
      state.records.contacts = state.records.contacts || [];
      let filtered = state.records.contacts.filter(
        r => r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
      );

      const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(r =>
          [r.firstName, r.lastName, r.email, r.phone, r.company, ...(r.tags || [])]
            .some(v => String(v || '').toLowerCase().includes(q))
        );
      }

      const tagFilter = queryUrl.searchParams.get('tag');
      if (tagFilter) {
        filtered = filtered.filter(r => Array.isArray(r.tags) && r.tags.some(t => t.toLowerCase() === tagFilter.toLowerCase()));
      }

      const statusFilter = queryUrl.searchParams.get('status');
      if (statusFilter) {
        filtered = filtered.filter(r => r.status && r.status.toLowerCase() === statusFilter.toLowerCase());
      }

      const sortField = queryUrl.searchParams.get('sort') || 'createdAt';
      const sortOrder = queryUrl.searchParams.get('order') || 'desc';
      filtered.sort((a, b) => {
        const aVal = a[sortField] ?? '';
        const bVal = b[sortField] ?? '';
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        }
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortOrder === 'asc' ? cmp : -cmp;
      });

      const total = filtered.length;
      const page = Math.max(1, Number(queryUrl.searchParams.get('page')) || 1);
      const limit = Math.min(200, Math.max(1, Number(queryUrl.searchParams.get('limit')) || 25));
      const startIdx = (page - 1) * limit;
      const pageData = filtered.slice(startIdx, startIdx + limit);
      const totalPages = Math.ceil(total / limit);

      result = {
        data: pageData,
        pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
      };
    }

    return sendJson(res, 200, {
      data: result.data,
      pagination: result.pagination,
      length: result.data.length
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Contact Single Record: GET /api/crm/contacts/:id
  // ─────────────────────────────────────────────────────────────────────────
  const singleContactMatch = pathname.match(/^\/api\/crm\/contacts\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && singleContactMatch) {
    const contactId = singleContactMatch[1];
    let contact = null;

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      contact = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.getById(tx, contactId);
      });
    }

    if (!contact) {
      state.records.contacts = state.records.contacts || [];
      contact = state.records.contacts.find(
        r => r.id === contactId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
      );
    }

    if (!contact) {
      return sendJson(res, 404, { error: 'Record not found' });
    }
    return sendJson(res, 200, contact);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Contact Create: POST /api/crm/contacts
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/crm/contacts') {
    const body = await readBody(req);

    // Schema validation for required fields
    if (!body.firstName || (typeof body.firstName === 'string' && !body.firstName.trim())) {
      return sendJson(res, 400, { error: "Field 'firstName' is required for contacts" });
    }

    // Security: Prevent client from injecting or overriding tenant context IDs
    const assignedId = (typeof body.id === 'string' && body.id.trim()) ? body.id.trim() : randomUUID();
    delete body.id;
    delete body.agencyId;
    delete body.locationId;

    let newRecord = null;
    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      newRecord = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.create(tx, { ...body, id: assignedId });
      });
    } else {
      newRecord = {
        ...body,
        id: assignedId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    state.records.contacts = state.records.contacts || [];
    const existingIdx = state.records.contacts.findIndex(r => r.id === assignedId);
    if (existingIdx >= 0) {
      state.records.contacts[existingIdx] = newRecord;
    } else {
      state.records.contacts.push(newRecord);
    }

    await saveState();
    if (typeof syncRelationalWrite === 'function') {
      await syncRelationalWrite('contacts', 'create', newRecord, agency.id).catch(() => {});
    }

    auditLog('crm.contacts.created', actor, { id: newRecord.id });
    broadcast('crm.contacts.created', { id: newRecord.id, ...newRecord });

    // Workflow trigger
    if (typeof triggerWorkflowExecution === 'function') {
      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'tag',
        triggerContext: { contact: newRecord }
      }).catch(console.error);
    }

    // Zapier webhook event
    if (typeof dispatchZapierEvent === 'function') {
      dispatchZapierEvent({
        zapierRepository,
        state,
        agencyId: agency.id,
        locationId: activeLocation.id,
        event: 'contact.created',
        data: newRecord
      }).catch(console.error);
    }

    return sendJson(res, 201, newRecord);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Contact Update: PUT /api/crm/contacts/:id
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'PUT' && singleContactMatch) {
    const contactId = singleContactMatch[1];
    const body = await readBody(req);

    // Security: Strip tenant injection and ID mutation
    delete body.id;
    delete body.agencyId;
    delete body.locationId;
    delete body.createdAt;

    state.records.contacts = state.records.contacts || [];
    const index = state.records.contacts.findIndex(
      r => r.id === contactId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
    );

    let previousRecord = index >= 0 ? { ...state.records.contacts[index] } : null;
    let updated = null;

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        return contactsRepo.update(tx, contactId, body);
      });
      if (!updated && index === -1) {
        return sendJson(res, 404, { error: 'Record not found' });
      }
    }

    if (!updated) {
      if (index === -1) return sendJson(res, 404, { error: 'Record not found' });
      updated = {
        ...state.records.contacts[index],
        ...body,
        id: contactId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        updatedAt: new Date().toISOString()
      };
    }

    if (index >= 0) {
      state.records.contacts[index] = updated;
    } else {
      state.records.contacts.push(updated);
    }

    await saveState();
    if (typeof syncRelationalWrite === 'function') {
      await syncRelationalWrite('contacts', 'update', updated, agency.id).catch(() => {});
    }

    auditLog('crm.contacts.updated', actor, { id: contactId });
    broadcast('crm.contacts.updated', { id: contactId, ...updated });

    // Workflow trigger
    if (typeof triggerWorkflowExecution === 'function') {
      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'contact_updated',
        triggerContext: { contact: updated, previous: previousRecord }
      }).catch(console.error);
    }

    // Zapier webhook event
    if (typeof dispatchZapierEvent === 'function') {
      dispatchZapierEvent({
        zapierRepository,
        state,
        agencyId: agency.id,
        locationId: activeLocation.id,
        event: 'contact.updated',
        data: updated
      }).catch(console.error);
    }

    return sendJson(res, 200, updated);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Contact Delete: DELETE /api/crm/contacts/:id
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'DELETE' && singleContactMatch) {
    const contactId = singleContactMatch[1];
    state.records.contacts = state.records.contacts || [];
    const index = state.records.contacts.findIndex(
      r => r.id === contactId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id)
    );

    let deleted = null;
    if (index >= 0) {
      deleted = state.records.contacts.splice(index, 1)[0];
    }

    if (pgPool) {
      const tenantCtx = {
        agencyId: agency.id,
        locationId: activeLocation.id,
        actorId: actor?.user?.id || actor?.keyId || 'system'
      };
      const pgDeleted = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
        const item = await contactsRepo.getById(tx, contactId);
        if (!item) return null;
        await contactsRepo.delete(tx, contactId);
        return item;
      });
      if (!deleted && pgDeleted) deleted = pgDeleted;
    }

    if (!deleted) {
      return sendJson(res, 404, { error: 'Record not found' });
    }

    await saveState();
    if (typeof syncRelationalWrite === 'function') {
      await syncRelationalWrite('contacts', 'delete', deleted, agency.id).catch(() => {});
    }

    auditLog('crm.contacts.deleted', actor, { id: contactId });
    broadcast('crm.contacts.deleted', { id: contactId });
    return sendJson(res, 200, { success: true, deleted });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 12. Smart Lists — Get Specific List & Evaluate Matches
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname.startsWith('/api/crm/smart-lists/')) {
    const listId = pathname.replace('/api/crm/smart-lists/', '').replace(/\/evaluate$/, '').trim();
    state.records.smartLists = state.records.smartLists || [];
    const list = state.records.smartLists.find(l => l.id === listId && l.agencyId === agency.id);
    if (!list) {
      sendJson(res, 404, { error: 'Smart list not found' });
      return true;
    }

    state.records.contacts = state.records.contacts || [];
    const tenantContacts = state.records.contacts.filter(c => c.agencyId === agency.id);

    let matches = tenantContacts;
    const rule = (list.rule || '').toLowerCase().trim();

    if (rule) {
      if (rule.includes('customer')) {
        matches = tenantContacts.filter(c => c.status === 'customer' || (c.tags || []).includes('customer'));
      } else if (rule.includes('lead')) {
        matches = tenantContacts.filter(c => c.status === 'lead' || (c.tags || []).includes('lead'));
      } else if (rule.startsWith('tag:') || rule.includes('tags contains') || rule.includes('tagged')) {
        const tagTarget = rule.replace('tag:', '').replace('tags contains', '').replace('tagged', '').replace(/['"]/g, '').trim();
        matches = tenantContacts.filter(c => (c.tags || []).some(t => t.toLowerCase().includes(tagTarget)));
      } else if (rule.includes('company')) {
        matches = tenantContacts.filter(c => Boolean(c.company && c.company.trim()));
      } else if (rule.includes('promoter')) {
        matches = tenantContacts.filter(c => (c.tags || []).includes('promoter'));
      }
    } else if (list.filterField && list.value) {
      const field = list.filterField;
      const val = String(list.value).toLowerCase();
      matches = tenantContacts.filter(c => {
        const cVal = String(c[field] || '').toLowerCase();
        return list.operator === 'equals' ? cVal === val : cVal.includes(val);
      });
    }

    list.count = matches.length;
    await saveState();

    sendJson(res, 200, {
      list,
      count: matches.length,
      contacts: matches
    });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 13. Smart Lists — List All
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'GET' && pathname === '/api/crm/smart-lists') {
    state.records.smartLists = state.records.smartLists || [];
    const lists = state.records.smartLists.filter(l => l.agencyId === agency.id);
    sendJson(res, 200, { lists });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 14. Smart Lists — Create
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname === '/api/crm/smart-lists') {
    const body = await readBody(req);
    const smartList = createSmartListView({
      id: randomUUID(),
      agencyId: agency.id,
      locationId: activeLocation.id,
      name: body.name || 'Untitled Smart List',
      logic: body.logic || 'and',
      conditions: body.conditions || [],
      createdBy: actor?.user?.id || 'system'
    });
    state.records.smartLists = state.records.smartLists || [];
    state.records.smartLists.push(smartList);
    await saveState();
    sendJson(res, 201, { success: true, list: smartList });
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 15. Smart Lists — Query Contacts
  // ─────────────────────────────────────────────────────────────────────────
  if (method === 'POST' && pathname.startsWith('/api/crm/smart-lists/') && pathname.endsWith('/query')) {
    const listId = pathname.split('/')[4];
    state.records.smartLists = state.records.smartLists || [];
    const list = state.records.smartLists.find(l => l.id === listId && l.agencyId === agency.id);
    if (!list) {
      sendJson(res, 404, { error: 'Smart list not found' });
      return true;
    }
    state.records.contacts = state.records.contacts || [];
    const tenantContacts = state.records.contacts.filter(c => c.agencyId === agency.id && c.locationId === activeLocation.id);
    const body = await readBody(req);
    const result = filterSmartListRecords({
      view: list,
      records: tenantContacts,
      agencyId: agency.id,
      locationId: activeLocation.id,
      limit: body.limit || 50,
      offset: body.offset || 0
    });
    sendJson(res, 200, {
      success: true,
      list,
      total: result.total,
      contacts: result.items,
      limit: result.limit,
      offset: result.offset
    });
    return true;
  }

  return false;
}
