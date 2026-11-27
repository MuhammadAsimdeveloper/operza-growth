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
import { createOrdersRepository } from '../../../packages/db/lib/orders-repository.mjs';
import { createPaymentsRepository } from '../../../packages/db/lib/payments-repository.mjs';
import { createInvoicesRepository } from '../../../packages/db/lib/invoices-repository.mjs';
import { createLedgerRepository } from '../../../packages/db/lib/ledger-repository.mjs';
import { createContactsRepository } from '../../../packages/db/lib/contacts-repository.mjs';
import { createOpportunitiesRepository } from '../../../packages/db/lib/opportunities-repository.mjs';
import { toCents, fromCents } from '../../../packages/db/lib/money.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { handleSites2Routes } from './sites2.mjs';

const funnelsRepo = createFunnelsRepository();
const ordersRepo = createOrdersRepository();
const paymentsRepo = createPaymentsRepository();
const invoicesRepo = createInvoicesRepository();
const ledgerRepo = createLedgerRepository();
const contactsRepo = createContactsRepository();
const opportunitiesRepo = createOpportunitiesRepository();

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

  if (await handleSites2Routes({ req, res, pathname, method, ctx })) {
    return true;
  }

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

    const upsellCents = toCents(product.price || product.amount, { allowZero: false });
    const upsellPrice = fromCents(upsellCents);
    const upsellItem = {
      id: product.id || randomUUID(),
      name: product.name || 'Executive 1-Click Upsell',
      price: upsellPrice,
      amount: upsellPrice,
      quantity: 1,
      type: 'one_click_upsell'
    };

    if (pgPool) {
      const lookupRes = await pgPool.query(
        `SELECT agency_id, location_id FROM orders WHERE id = $1 LIMIT 1`,
        [orderId]
      );
      if (lookupRes.rows.length === 0) {
        sendJson(res, 404, { error: 'Original order not found' });
        return true;
      }
      const { agency_id: agId, location_id: locId } = lookupRes.rows[0];
      const txResult = await runInTenantTx(pgPool, { agencyId: agId, locationId: locId, actorId: 'public_upsell' }, async (tx) => {
        const updatedOrder = await ordersRepo.addUpsellItem(tx, orderId, upsellItem, upsellCents);
        if (!updatedOrder) return null;

        const payment = await paymentsRepo.createPayment(tx, {
          orderId: updatedOrder.id,
          contactId: updatedOrder.contactId,
          amountCents: upsellCents,
          currency: updatedOrder.currency || 'USD',
          status: 'succeeded',
          provider: !process.env.STRIPE_SECRET_KEY ? 'simulated' : 'stripe',
          idempotencyKey: req.headers['idempotency-key'] || body.idempotencyKey || null,
          method: 'stripe_tokenized_1click'
        });

        await ledgerRepo.recordTransaction(tx, {
          accountType: 'stripe_escrow',
          entryType: 'credit',
          amountCents: upsellCents,
          referenceType: 'upsell_payment',
          referenceId: payment.id,
          description: `1-click upsell: ${upsellItem.name}`,
          idempotencyKey: `led_upsell_${payment.id}`,
          currency: updatedOrder.currency || 'USD'
        });

        return { order: updatedOrder, payment };
      });

      if (!txResult) {
        sendJson(res, 404, { error: 'Original order not found' });
        return true;
      }

      auditLog('funnel.upsell.purchased', null, { orderId: txResult.order.id, amount: upsellPrice, itemName: upsellItem.name });
      broadcast('crm.order.updated', { orderId: txResult.order.id, amount: txResult.order.amount, hasUpsell: true });

      sendJson(res, 200, {
        success: true,
        upsellGranted: true,
        order: txResult.order,
        payment: txResult.payment
      });
      return true;
    }

    state.records.orders = state.records.orders || [];
    const order = state.records.orders.find(o => o.id === orderId);
    if (!order) {
      sendJson(res, 404, { error: 'Original order not found' });
      return true;
    }

    order.items = Array.isArray(order.items) ? [...order.items, upsellItem] : [upsellItem];
    order.amount = fromCents(toCents(order.amount || 0) + upsellCents);
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

    const isWebsite = site.kind === 'website';
    const defaultTag = isWebsite ? 'website-lead' : 'funnel-lead';
    const defaultSource = isWebsite ? `Hosted Website (${site.name})` : `Funnel: ${site.name}`;
    const emailKey = email ? String(email).toLowerCase().trim() : '';
    const oppValue = bumpAccepted && site.checkout?.bumps?.[0]?.price ? site.checkout.bumps[0].price : 1000;

    let contact = null;
    let opp = null;
    let order = null;

    if (pgPool) {
      const txResult = await runInTenantTx(pgPool, { agencyId, locationId, actorId: 'public_visitor' }, async (tx) => {
        site = await funnelsRepo.recordOptin(tx, site.id, pageSlug);

        if (emailKey) {
          const existingList = await contactsRepo.list(tx, { search: emailKey, limit: 10 });
          contact = existingList.contacts.find(c => c.email === emailKey) || null;
        }
        if (!contact) {
          contact = await contactsRepo.create(tx, {
            firstName: firstName || 'Lead',
            lastName: lastName || '',
            email: emailKey,
            phone: phone || '',
            company: company || (isWebsite ? site.name : ''),
            source: defaultSource,
            tags: [defaultTag, site.name],
            status: 'lead'
          });
        } else {
          const nextTags = Array.from(new Set([...(contact.tags || []), defaultTag, site.name]));
          contact = await contactsRepo.update(tx, contact.id, {
            firstName: firstName || contact.firstName,
            lastName: lastName || contact.lastName,
            phone: phone || contact.phone,
            tags: nextTags
          });
        }

        opp = await opportunitiesRepo.create(tx, {
          name: `${contact.firstName} ${contact.lastName || ''} - ${site.name}`.trim(),
          contactId: contact.id,
          pipelineId: randomUUID(),
          stageId: randomUUID(),
          value: oppValue,
          status: 'open',
          source: `Funnel: ${site.name}`
        });

        if (bumpAccepted && (site.checkout?.bumps?.length || site.checkout?.bumpPrice || site.checkout?.price)) {
          const bump = site.checkout?.bumps?.length
            ? (site.checkout.bumps.find(b => b.enabled) || site.checkout.bumps[0])
            : { price: site.checkout?.bumpPrice || 47, headline: site.checkout?.bumpTitle || 'VIP Order Bump' };

          const baseCents = toCents(site.checkout?.price || 0);
          const bumpCents = toCents(bump.price || site.checkout?.bumpPrice || 47);
          const totalCents = baseCents > 0 ? baseCents + bumpCents : bumpCents;
          const orderNum = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;

          order = await ordersRepo.createOrder(tx, {
            orderNumber: orderNum,
            contactId: contact.id,
            opportunityId: opp.id,
            contactName: `${contact.firstName} ${contact.lastName}`.trim(),
            amountCents: totalCents,
            currency: 'USD',
            status: 'completed',
            items: [
              ...(baseCents > 0 ? [{ name: site.name || 'Primary Offer', price: fromCents(baseCents), quantity: 1 }] : []),
              { name: bump.headline || bump.title || 'Order Bump', price: fromCents(bumpCents), quantity: 1 }
            ],
            source: `Funnel Opt-In: ${site.name}`
          });

          const inv = await invoicesRepo.createInvoice(tx, {
            number: `INV-${orderNum.replace('ORD-', '')}`,
            orderId: order.id,
            contactId: contact.id,
            contactName: `${contact.firstName} ${contact.lastName}`.trim(),
            amountCents: bumpCents,
            currency: 'USD',
            status: 'paid'
          });

          const payment = await paymentsRepo.createPayment(tx, {
            orderId: order.id,
            invoiceId: inv.id,
            contactId: contact.id,
            amountCents: totalCents,
            currency: 'USD',
            status: 'succeeded',
            provider: !process.env.STRIPE_SECRET_KEY ? 'simulated' : 'stripe',
            method: 'funnel_order_bump'
          });

          if (totalCents > 0) {
            await ledgerRepo.recordTransaction(tx, {
              accountType: 'stripe_escrow',
              entryType: 'credit',
              amountCents: totalCents,
              referenceType: 'order_payment',
              referenceId: payment.id,
              description: `Funnel order bump for ${site.name}`,
              idempotencyKey: `led_bump_${order.id}`,
              currency: 'USD'
            });
          }
        }

        return { contact, opp, order };
      });
      contact = txResult.contact;
      opp = txResult.opp;
      order = txResult.order;
    } else {
      site.optins = (site.optins || 0) + 1;
      if (Array.isArray(site.pages) && pageSlug) {
        const targetPage = site.pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
        if (targetPage) targetPage.optins = (targetPage.optins || 0) + 1;
      }

      state.records.contacts = state.records.contacts || [];
      contact = emailKey
        ? state.records.contacts.find(c => c.agencyId === agencyId && c.email && c.email.toLowerCase() === emailKey)
        : null;

      if (!contact) {
        contact = {
          id: randomUUID(),
          agencyId,
          locationId,
          firstName: firstName || 'Lead',
          lastName: lastName || '',
          email: emailKey,
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
      opp = {
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
    }

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
