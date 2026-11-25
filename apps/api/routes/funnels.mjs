/**
 * ============================================================================
 * Operza Funnels & Websites Domain Router — TenantTx & FunnelsRepository Boundary
 * ============================================================================
 * Handles:
 * 1. CRM Funnels/Websites CRUD: /api/crm/websites*, /api/crm/funnels*
 * 2. Public Funnel/Website Lookup: GET /api/funnels/public/:slugOrId, /api/websites/public/:slugOrId
 * 3. Public Opt-In Lead & Order Bump Ingress: POST /api/funnels/optin/:slugOrId, /api/websites/optin/:slugOrId
 * 4. 1-Click Post-Purchase Upsell: POST /api/funnels/checkout/one-click-upsell
 */

import { randomUUID } from 'node:crypto';
import { createFunnelsRepository, normalizeFunnelRow } from '../../../packages/db/lib/funnels-repository.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';

const funnelsRepo = createFunnelsRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function matchesSiteSlugOrId(w, slugOrId) {
  const lower = String(slugOrId || '').toLowerCase();
  return (
    w.id === slugOrId ||
    (w.slug && w.slug.toLowerCase() === lower) ||
    (w.domain && w.domain.toLowerCase() === lower) ||
    ((w.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') === lower)
  );
}

export async function handleFunnelsRoutes(req, res, ctx) {
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
    pgPool,
    triggerWorkflowExecution
  } = ctx;

  const isPublicFunnelRoute =
    pathname.startsWith('/api/funnels/public/') ||
    pathname.startsWith('/api/websites/public/') ||
    pathname.startsWith('/api/funnels/optin/') ||
    pathname.startsWith('/api/websites/optin/') ||
    pathname === '/api/funnels/checkout/one-click-upsell';

  const isCrmFunnelRoute =
    pathname === '/api/crm/websites' ||
    pathname.startsWith('/api/crm/websites/') ||
    pathname === '/api/crm/funnels' ||
    pathname.startsWith('/api/crm/funnels/');

  if (!isPublicFunnelRoute && !isCrmFunnelRoute) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);

  // ═════════════════════════════════════════════════════════════════════════
  // 1. PUBLIC FUNNEL / WEBSITE ENDPOINTS
  // ═════════════════════════════════════════════════════════════════════════

  if (method === 'POST' && pathname === '/api/funnels/checkout/one-click-upsell') {
    const body = await readBody(req);
    const product = body?.product || body?.upsellItem;
    const { orderId } = body || {};
    if (!orderId || !product || (!product.price && !product.amount)) {
      sendJson(res, 400, { error: 'orderId and product/upsellItem with price are required for 1-click upsell' });
      return true;
    }

    state.records.orders = state.records.orders || [];
    const order = state.records.orders.find(o => o.id === orderId);
    if (!order) {
      sendJson(res, 404, { error: 'Original order not found' });
      return true;
    }

    const upsellPrice = Number(product.price || product.amount);
    const upsellItem = {
      id: product.id || randomUUID(),
      name: product.name || 'Executive 1-Click Upsell',
      price: upsellPrice,
      amount: upsellPrice,
      quantity: 1,
      type: 'one_click_upsell'
    };

    order.items = Array.isArray(order.items) ? [...order.items, upsellItem] : [upsellItem];
    order.amount = (Number(order.amount) || 0) + upsellPrice;
    order.hasUpsell = true;
    order.updatedAt = new Date().toISOString();

    state.records.payments = state.records.payments || [];
    const payment = {
      id: randomUUID(),
      agencyId: order.agencyId,
      locationId: order.locationId,
      contactId: order.contactId,
      orderId: order.id,
      amount: upsellPrice,
      currency: order.currency || 'USD',
      status: 'succeeded',
      method: 'stripe_tokenized_1click',
      createdAt: new Date().toISOString()
    };
    state.records.payments.push(payment);
    await saveState();

    auditLog('funnel.upsell.purchased', null, { orderId: order.id, amount: upsellPrice, itemName: upsellItem.name });
    broadcast('crm.order.updated', { orderId: order.id, amount: order.amount, hasUpsell: true });

    sendJson(res, 200, {
      success: true,
      upsellGranted: true,
      order,
      payment
    });
    return true;
  }

  if (method === 'GET' && (pathname.startsWith('/api/funnels/public/') || pathname.startsWith('/api/websites/public/'))) {
    const slugOrId = pathname.replace(/^\/api\/(funnels|websites)\/public\//, '').trim();
    const pageSlug = queryUrl.searchParams.get('pageSlug');

    let site = null;
    if (pgPool) {
      try {
        const lookupRes = await pgPool.query(
          `SELECT * FROM location_records WHERE collection = 'websites' AND (id::text = $1 OR body->>'slug' = $1 OR body->>'domain' = $1) LIMIT 1`,
          [slugOrId]
        );
        if (lookupRes.rows.length > 0) {
          const found = normalizeFunnelRow(lookupRes.rows[0]);
          site = await runInTenantTx(pgPool, {
            agencyId: found.agencyId,
            locationId: found.locationId,
            actorId: 'public_visitor'
          }, async (tx) => funnelsRepo.recordVisit(tx, found.id, pageSlug));
        }
      } catch (err) {
        console.warn('[FUNNELS-ROUTER] PG public lookup warning:', err.message);
      }
    }

    if (!site && !pgPool) {
      state.records.websites = state.records.websites || [];
      site = state.records.websites.find(w => matchesSiteSlugOrId(w, slugOrId));
      if (site) {
        site.visits = (site.visits || 0) + 1;
        if (Array.isArray(site.pages)) {
          if (pageSlug) {
            const targetPage = site.pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
            if (targetPage) targetPage.visits = (targetPage.visits || 0) + 1;
          } else if (site.pages[0]) {
            site.pages[0].visits = (site.pages[0].visits || 0) + 1;
          }
        }
        await saveState();
      }
    }

    if (!site) {
      sendJson(res, 404, { error: 'Funnel or website not found' });
      return true;
    }

    sendJson(res, 200, {
      id: site.id,
      name: site.name,
      kind: site.kind || 'funnel',
      published: site.published,
      visits: site.visits,
      optins: site.optins || 0,
      pages: site.pages || [],
      globalHeader: site.globalHeader || null,
      globalFooter: site.globalFooter || null,
      checkout: site.checkout || null
    });
    return true;
  }

  if (method === 'POST' && (pathname.startsWith('/api/funnels/optin/') || pathname.startsWith('/api/websites/optin/'))) {
    const slugOrId = pathname.replace(/^\/api\/(funnels|websites)\/optin\//, '').trim();
    let site = null;

    if (pgPool) {
      try {
        const lookupRes = await pgPool.query(
          `SELECT * FROM location_records WHERE collection = 'websites' AND (id::text = $1 OR body->>'slug' = $1 OR body->>'domain' = $1) LIMIT 1`,
          [slugOrId]
        );
        if (lookupRes.rows.length > 0) {
          site = normalizeFunnelRow(lookupRes.rows[0]);
        }
      } catch (err) {
        console.warn('[FUNNELS-ROUTER] PG optin lookup warning:', err.message);
      }
    } else {
      state.records.websites = state.records.websites || [];
      site = state.records.websites.find(w => matchesSiteSlugOrId(w, slugOrId));
    }

    if (!site) {
      sendJson(res, 404, { error: 'Funnel or website not found' });
      return true;
    }

    const body = await readBody(req);
    const { firstName, lastName, email, phone, company, pageSlug, bumpAccepted } = body || {};
    if (!firstName && !email) {
      sendJson(res, 400, { error: 'First name or email is required' });
      return true;
    }

    const agencyId = site.agencyId || state.agencies?.[0]?.id;
    const locationId = site.locationId || state.locations?.[0]?.id;

    if (pgPool) {
      await runInTenantTx(pgPool, { agencyId, locationId, actorId: 'public_visitor' }, async (tx) => {
        site = await funnelsRepo.recordOptin(tx, site.id, pageSlug);
      });
    } else {
      site.optins = (site.optins || 0) + 1;
      if (Array.isArray(site.pages) && pageSlug) {
        const targetPage = site.pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
        if (targetPage) targetPage.optins = (targetPage.optins || 0) + 1;
      }
    }

    const isWebsite = site.kind === 'website';
    const defaultTag = isWebsite ? 'website-lead' : 'funnel-lead';
    const defaultSource = isWebsite ? `Hosted Website (${site.name})` : `Funnel: ${site.name}`;

    state.records.contacts = state.records.contacts || [];
    let contact = email
      ? state.records.contacts.find(c => c.agencyId === agencyId && c.email && c.email.toLowerCase() === email.toLowerCase())
      : null;

    if (!contact) {
      contact = {
        id: randomUUID(),
        agencyId,
        locationId,
        firstName: firstName || 'Lead',
        lastName: lastName || '',
        email: (email || '').toLowerCase().trim(),
        phone: phone || '',
        company: company || (isWebsite ? site.name : ''),
        source: defaultSource,
        tags: [defaultTag, site.name],
        status: 'lead',
        notes: body.message ? [{ id: randomUUID(), body: body.message, at: new Date().toISOString(), author: 'Web Lead' }] : [],
        createdAt: new Date().toISOString()
      };
      state.records.contacts.push(contact);
    } else {
      if (firstName) contact.firstName = firstName;
      if (lastName) contact.lastName = lastName;
      if (phone) contact.phone = phone;
      if (body.message) {
        contact.notes = contact.notes || [];
        contact.notes.push({ id: randomUUID(), body: body.message, at: new Date().toISOString(), author: 'Web Lead' });
      }
      contact.tags = Array.from(new Set([...(contact.tags || []), defaultTag, site.name]));
    }

    const oppId = randomUUID();
    const oppValue = bumpAccepted && site.checkout?.bumps?.[0]?.price ? site.checkout.bumps[0].price : 1000;
    const opp = {
      id: oppId,
      agencyId,
      locationId,
      name: `${contact.firstName} ${contact.lastName || ''} - ${site.name}`.trim(),
      contactId: contact.id,
      stage: 'New Inbound Lead',
      value: oppValue,
      status: 'open',
      source: `Funnel: ${site.name}`,
      createdAt: new Date().toISOString()
    };
    state.records.opportunities = state.records.opportunities || [];
    state.records.opportunities.push(opp);

    let order = null;
    if (bumpAccepted && (site.checkout?.bumps?.length || site.checkout?.bumpPrice || site.checkout?.price)) {
      const bump = site.checkout?.bumps?.length
        ? (site.checkout.bumps.find(b => b.enabled) || site.checkout.bumps[0])
        : { price: site.checkout?.bumpPrice || 47, headline: site.checkout?.bumpTitle || 'VIP Order Bump' };

      const baseAmount = site.checkout?.price || 0;
      const bumpAmt = bump.price || site.checkout?.bumpPrice || 47;
      const totalAmount = baseAmount > 0 ? baseAmount + bumpAmt : bumpAmt;

      const orderId = randomUUID();
      const invoiceId = randomUUID();
      const orderNum = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
      order = {
        id: orderId,
        agencyId,
        locationId,
        orderNumber: orderNum,
        contactId: contact.id,
        contactName: `${contact.firstName} ${contact.lastName}`.trim(),
        amount: totalAmount,
        currency: 'USD',
        status: 'completed',
        items: [
          ...(baseAmount > 0 ? [{ name: site.name || 'Primary Offer', price: baseAmount, quantity: 1 }] : []),
          { name: bump.headline || bump.title || 'Order Bump', price: bumpAmt, quantity: 1 }
        ],
        bumpAccepted: true,
        bumpAmount: bumpAmt,
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      state.records.orders = state.records.orders || [];
      state.records.orders.push(order);

      const invoice = {
        id: invoiceId,
        agencyId,
        locationId,
        number: `INV-${orderNum.replace('ORD-', '')}`,
        contactName: `${contact.firstName} ${contact.lastName}`.trim(),
        amount: bump.price,
        status: 'paid',
        dueDate: new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString()
      };
      state.records.invoices = state.records.invoices || [];
      state.records.invoices.push(invoice);
    }

    await saveState();

    broadcast('funnel.optin.received', { siteId: site.id, contactId: contact.id, siteName: site.name });
    auditLog('funnel.optin', null, { siteId: site.id, siteName: site.name, contactId: contact.id });

    if (triggerWorkflowExecution) {
      triggerWorkflowExecution({
        agencyId,
        locationId,
        triggerType: 'funnel_optin',
        triggerContext: { site, contact, opportunity: opp, order }
      }).catch(console.error);
    }

    sendJson(res, 201, {
      success: true,
      siteId: site.id,
      contact,
      opportunity: opp,
      order,
      paymentToken: `tok_opz_1click_${order ? order.id : randomUUID().slice(0, 8)}`
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. AUTHENTICATED CRM FUNNELS / WEBSITES CRUD
  // ═════════════════════════════════════════════════════════════════════════

  const tenantCtx = (agency && activeLocation) ? {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.user?.id || actor?.keyId || 'system'
  } : null;

  if (!tenantCtx || !tenantCtx.agencyId || !tenantCtx.locationId) {
    sendJson(res, 400, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
    return true;
  }

  const isCollectionPath = pathname === '/api/crm/websites' || pathname === '/api/crm/funnels';
  const recordId = isCollectionPath ? null : pathname.replace(/^\/api\/crm\/(websites|funnels)\//, '').trim();

  if (method === 'GET' && isCollectionPath) {
    if (!checkScope(actor, 'funnels:read', ['websites:read'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'funnels:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (pgPool) {
      try {
        const list = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return funnelsRepo.listFunnels(tx, {
            kind: pathname.includes('/funnels') ? 'funnel' : queryUrl.searchParams.get('kind'),
            search: queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q')
          });
        });
        sendJson(res, 200, { data: list, count: list.length });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve funnels: ' + err.message });
      }
      return true;
    }

    state.records.websites = state.records.websites || [];
    let list = state.records.websites.filter(
      w => w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
    );
    if (pathname.includes('/funnels')) {
      list = list.filter(w => !w.kind || w.kind === 'funnel');
    }
    sendJson(res, 200, { data: list, count: list.length });
    return true;
  }

  if (method === 'POST' && isCollectionPath) {
    if (!checkScope(actor, 'funnels:write', ['websites:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'funnels:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const body = await readBody(req);
    if (!body || typeof body.name !== 'string' || !body.name.trim()) {
      sendJson(res, 400, { error: 'Funnel or website name is required', code: 'FUNNEL_NAME_REQUIRED' });
      return true;
    }

    const { agencyId: _a, locationId: _l, ...sanitized } = body;

    if (pgPool) {
      try {
        const created = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
          return funnelsRepo.createFunnel(tx, sanitized);
        });
        auditLog('crm.websites.created', actor, { id: created.id });
        broadcast('crm.websites.created', created);
        sendJson(res, 201, created);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to create funnel: ' + err.message });
      }
      return true;
    }

    state.records.websites = state.records.websites || [];
    const created = {
      ...sanitized,
      id: randomUUID(),
      agencyId: agency.id,
      locationId: activeLocation.id,
      name: sanitized.name.trim(),
      kind: sanitized.kind || 'funnel',
      visits: Number(sanitized.visits) || 0,
      optins: Number(sanitized.optins) || 0,
      pages: Array.isArray(sanitized.pages) ? sanitized.pages : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.records.websites.push(created);
    await saveState();
    auditLog('crm.websites.created', actor, { id: created.id });
    broadcast('crm.websites.created', created);
    sendJson(res, 201, created);
    return true;
  }

  if (method === 'GET' && recordId) {
    if (!checkScope(actor, 'funnels:read', ['websites:read'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'funnels:read'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (pgPool) {
      try {
        const found = await runInTenantTx(pgPool, tenantCtx, async (tx) => funnelsRepo.getFunnelById(tx, recordId));
        if (!found) {
          sendJson(res, 404, { error: 'Funnel or website not found' });
          return true;
        }
        sendJson(res, 200, found);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to retrieve funnel: ' + err.message });
      }
      return true;
    }

    const found = (state.records.websites || []).find(
      w => w.id === recordId && w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
    );
    if (!found) {
      sendJson(res, 404, { error: 'Funnel or website not found' });
      return true;
    }
    sendJson(res, 200, found);
    return true;
  }

  if ((method === 'PUT' || method === 'PATCH') && recordId) {
    if (!checkScope(actor, 'funnels:write', ['websites:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'funnels:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    const body = await readBody(req);
    const { agencyId: _a, locationId: _l, id: _id, ...sanitized } = body || {};

    if (pgPool) {
      try {
        const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => funnelsRepo.updateFunnel(tx, recordId, sanitized));
        if (!updated) {
          sendJson(res, 404, { error: 'Funnel or website not found' });
          return true;
        }
        auditLog('crm.websites.updated', actor, { id: recordId });
        broadcast('crm.websites.updated', updated);
        sendJson(res, 200, updated);
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to update funnel: ' + err.message });
      }
      return true;
    }

    state.records.websites = state.records.websites || [];
    const idx = state.records.websites.findIndex(
      w => w.id === recordId && w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
    );
    if (idx === -1) {
      sendJson(res, 404, { error: 'Funnel or website not found' });
      return true;
    }
    const updated = {
      ...state.records.websites[idx],
      ...sanitized,
      id: recordId,
      agencyId: agency.id,
      locationId: activeLocation.id,
      updatedAt: new Date().toISOString()
    };
    state.records.websites[idx] = updated;
    await saveState();
    auditLog('crm.websites.updated', actor, { id: recordId });
    broadcast('crm.websites.updated', updated);
    sendJson(res, 200, updated);
    return true;
  }

  if (method === 'DELETE' && recordId) {
    if (!checkScope(actor, 'funnels:write', ['websites:write'])) {
      sendJson(res, 403, { error: "Insufficient API key scope. Required: 'funnels:write'", code: 'INSUFFICIENT_SCOPES' });
      return true;
    }

    if (pgPool) {
      try {
        const deleted = await runInTenantTx(pgPool, tenantCtx, async (tx) => funnelsRepo.deleteFunnel(tx, recordId));
        if (!deleted) {
          sendJson(res, 404, { error: 'Funnel or website not found' });
          return true;
        }
        auditLog('crm.websites.deleted', actor, { id: recordId });
        broadcast('crm.websites.deleted', { id: recordId });
        sendJson(res, 200, { success: true, id: recordId });
      } catch (err) {
        sendJson(res, 500, { error: 'Failed to delete funnel: ' + err.message });
      }
      return true;
    }

    state.records.websites = state.records.websites || [];
    const idx = state.records.websites.findIndex(
      w => w.id === recordId && w.agencyId === agency.id && (!w.locationId || w.locationId === activeLocation.id)
    );
    if (idx === -1) {
      sendJson(res, 404, { error: 'Funnel or website not found' });
      return true;
    }
    state.records.websites.splice(idx, 1);
    await saveState();
    auditLog('crm.websites.deleted', actor, { id: recordId });
    broadcast('crm.websites.deleted', { id: recordId });
    sendJson(res, 200, { success: true, id: recordId });
    return true;
  }

  return false;
}
