/**
 * ============================================================================
 * Operza CRM Domain Routes & Smart List Saved Views Subsystem
 * ============================================================================
 * Handles contacts aggregate CRUD, bulk contact operations, formula-defended
 * CSV import/export, contact merging, activity timelines, and AST-driven Smart
 * Lists. Employs TenantTx and ContactsRepository for PostgreSQL RLS boundary.
 */

import { createSmartListView, filterSmartListRecords } from '../../../packages/platform-core/src/crm-views-store.mjs';
import { handleContactsRoutes } from './contacts.mjs';
import { handleOpportunitiesRoutes } from './opportunities.mjs';
import { handleSchedulingRoutes } from './scheduling.mjs';
import { handleWorkflowsRoutes } from './workflows.mjs';

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

  // Delegate contacts domain operations to dedicated contacts router
  if (await handleContactsRoutes(req, res, ctx)) {
    return true;
  }

  // Delegate opportunities domain operations to dedicated opportunities router
  if (await handleOpportunitiesRoutes(req, res, ctx)) {
    return true;
  }

  // Delegate scheduling domain operations to dedicated scheduling router
  if (await handleSchedulingRoutes(req, res, ctx)) {
    return true;
  }

  // Delegate workflows domain operations to dedicated workflows router
  if (await handleWorkflowsRoutes(req, res, ctx)) {
    return true;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Smart Lists — Get Specific List & Evaluate Matches
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
