/**
 * ============================================================================
 * Operza CRM Enhanced Routes & Smart List Saved Views Subsystem
 * ============================================================================
 * Handles bulk contact operations, formula-defended CSV import/export, contact
 * merging, activity timelines, and AST-driven Smart List queries.
 */

import { parseAndValidateCsvImport, exportContactsToCsv } from '../../../packages/platform-core/src/csv-transfer.mjs';
import { createSmartListView, filterSmartListRecords } from '../../../packages/platform-core/src/crm-views-store.mjs';

export async function handleCrmRoutes(req, res, ctx) {
  const {
    method,
    pathname,
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
    parseCSV
  } = ctx;

  if (!pathname.startsWith('/api/crm/')) {
    return false;
  }

  // 1. Bulk Tag Contacts
  if (method === 'POST' && pathname === '/api/crm/contacts/bulk-tag') {
    const body = await readBody(req);
    const { contactIds, tag } = body;
    if (!Array.isArray(contactIds) || !tag) {
      sendJson(res, 400, { error: 'contactIds array and tag required' });
      return true;
    }

    let updated = 0;
    for (const id of contactIds) {
      const contact = (state.records.contacts || []).find(
        c => c.id === id && c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      if (contact) {
        contact.tags = Array.from(new Set([...(contact.tags || []), tag]));
        contact.updatedAt = new Date().toISOString();
        updated++;
      }
    }
    await saveState();
    auditLog('crm.contacts.bulk_tag', actor, { tag, count: updated });
    broadcast('crm.contacts.bulk_updated', { tag, count: updated });
    sendJson(res, 200, { success: true, updated });
    return true;
  }

  // 2. Import Contacts (CSV text with formula defense & deduplication)
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
    if (parsedPlan && parsedPlan.validRecords.length > 0) {
      for (const item of parsedPlan.validRecords) {
        const contact = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          firstName: item.firstName || '',
          lastName: item.lastName || '',
          email: item.email || '',
          phone: item.phone || '',
          company: item.company || '',
          source: 'CSV Import',
          tags: item.tags?.length ? item.tags : ['imported'],
          leadScore: item.leadScore || 0,
          status: 'lead',
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.contacts.push(contact);
        imported.push(contact);
      }
    } else if (typeof parseCSV === 'function') {
      const rows = parseCSV(csvText);
      for (const row of rows) {
        const contact = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          firstName: row.firstName || row.first_name || row.name || '',
          lastName: row.lastName || row.last_name || '',
          email: row.email || '',
          phone: row.phone || '',
          company: row.company || '',
          source: 'CSV Import',
          tags: row.tags ? row.tags.split(';').map(t => t.trim()) : ['imported'],
          status: row.status || 'lead',
          notes: row.notes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.contacts.push(contact);
        imported.push(contact);
      }
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

  // 3. Export Contacts (Formula injection defended CSV)
  if ((method === 'GET' || method === 'POST') && pathname === '/api/crm/contacts/export-csv') {
    state.records.contacts = state.records.contacts || [];
    const tenantContacts = state.records.contacts.filter(c => c.agencyId === agency.id && c.locationId === activeLocation.id);
    const csvOutput = exportContactsToCsv({ contacts: tenantContacts });
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="contacts-export.csv"'
    });
    res.end(csvOutput);
    return true;
  }

  // 4. Contact Merge / Dedup
  if (method === 'POST' && pathname === '/api/crm/contacts/merge') {
    const body = await readBody(req);
    const { primaryId, mergeIds } = body;
    if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
      sendJson(res, 400, { error: 'primaryId and mergeIds array required' });
      return true;
    }

    const contacts = state.records.contacts || [];
    const primary = contacts.find(c => c.id === primaryId && c.agencyId === agency.id && c.locationId === activeLocation.id);
    if (!primary) {
      sendJson(res, 404, { error: 'Primary contact not found' });
      return true;
    }

    const merged = [];
    for (const mergeId of mergeIds) {
      if (mergeId === primaryId) continue;
      const idx = contacts.findIndex(c => c.id === mergeId && c.agencyId === agency.id && c.locationId === activeLocation.id);
      if (idx === -1) continue;

      const dup = contacts[idx];

      // Merge data into primary: fill empty fields, merge tags
      for (const field of ['lastName', 'email', 'phone', 'company', 'source', 'notes']) {
        if (!primary[field] && dup[field]) primary[field] = dup[field];
      }
      primary.tags = Array.from(new Set([...(primary.tags || []), ...(dup.tags || [])]));

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

      // Remove duplicate
      contacts.splice(idx, 1);
      merged.push(mergeId);
    }

    primary.updatedAt = new Date().toISOString();
    await saveState();
    auditLog('crm.contacts.merge', actor, { primaryId, mergedIds: merged });
    sendJson(res, 200, { success: true, primaryId, mergedCount: merged.length, mergedIds: merged });
    return true;
  }

  // 5. Contact Activity Timeline
  const timelineMatch = pathname.match(/^\/api\/crm\/contacts\/([a-zA-Z0-9_-]+)\/timeline$/);
  if (method === 'GET' && timelineMatch) {
    const contactId = timelineMatch[1];
    const contact = (state.records.contacts || []).find(
      c => c.id === contactId && c.agencyId === agency.id && c.locationId === activeLocation.id
    );
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
    sendJson(res, 200, { contactId, name: `${contact.firstName} ${contact.lastName}`, timeline });
    return true;
  }

  // 6. Smart Lists — Get Specific List & Evaluate Matches
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

  // 7. Smart Lists — List All
  if (method === 'GET' && pathname === '/api/crm/smart-lists') {
    state.records.smartLists = state.records.smartLists || [];
    const lists = state.records.smartLists.filter(l => l.agencyId === agency.id);
    sendJson(res, 200, { lists });
    return true;
  }

  // 8. Smart Lists — Create
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

  // 9. Smart Lists — Query Contacts
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
