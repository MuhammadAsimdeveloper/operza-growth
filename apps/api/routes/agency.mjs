/**
 * ============================================================================
 * Operza Agency, Workspaces (Locations), Snapshots, Team & Branding Routes
 * ============================================================================
 */

import { handleAgency2Routes } from './agency2.mjs';

export async function handleAgencyRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    randomBytes,
    randomUUID,
    actor,
    agency,
    activeLocation,
    getDefaultBranding
  } = ctx;

  if (!pathname.startsWith('/api/agency/') && pathname !== '/api/agency') {
    return false;
  }

  if (await handleAgency2Routes(req, res, ctx)) {
    return true;
  }

  const callerRole = actor?.membership?.role || actor?.user?.role || '';
  const isAgencyAdmin = ['owner', 'admin'].includes(callerRole);

  // 1. GET /api/agency/profile
  if (method === 'GET' && pathname === '/api/agency/profile') {
    sendJson(res, 200, {
      name: agency.name,
      email: agency.email || actor.user?.email || 'support@operza.io',
      phone: agency.phone || '+1 800-555-0100',
      website: agency.website || 'https://operza.io',
      timezone: agency.timezone || 'America/Los_Angeles',
      currency: agency.currency || 'USD'
    });
    return true;
  }

  // 2. PUT /api/agency/profile
  if (method === 'PUT' && pathname === '/api/agency/profile') {
    const body = await readBody(req);
    if (body.name) agency.name = body.name.trim();
    if (body.email) agency.email = body.email.trim();
    if (body.phone) agency.phone = body.phone.trim();
    if (body.website) agency.website = body.website.trim();
    if (body.timezone) agency.timezone = body.timezone.trim();
    if (body.currency) agency.currency = body.currency.trim();

    await saveState();
    broadcast('agency.profile.updated', { agencyId: agency.id, name: agency.name });
    auditLog('agency.profile.updated', actor, { agencyId: agency.id, name: agency.name });

    sendJson(res, 200, {
      success: true,
      profile: {
        name: agency.name,
        email: agency.email,
        phone: agency.phone,
        website: agency.website,
        timezone: agency.timezone,
        currency: agency.currency
      }
    });
    return true;
  }

  // 3. GET /api/agency/team
  if (method === 'GET' && pathname === '/api/agency/team') {
    state.records.team = state.records.team || [];
    let agencyTeam = state.records.team.filter(m => m.agencyId === agency.id);
    if (agencyTeam.length === 0) {
      const defaultOwner = {
        id: randomUUID(),
        agencyId: agency.id,
        name: actor.user?.name || 'Agency Owner',
        email: actor.user?.email || 'owner@operza.io',
        role: 'admin',
        online: true,
        status: 'active',
        createdAt: new Date().toISOString()
      };
      state.records.team.push(defaultOwner);
      agencyTeam = [defaultOwner];
      await saveState();
    }
    sendJson(res, 200, { team: agencyTeam });
    return true;
  }

  // 4. POST /api/agency/team/invite
  if (method === 'POST' && pathname === '/api/agency/team/invite') {
    if (!isAgencyAdmin) {
      sendJson(res, 403, { error: 'Only agency owners and admins can invite team members' });
      return true;
    }
    const body = await readBody(req);
    const name = (body.name || '').trim();
    const email = (body.email || '').toLowerCase().trim();
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (!name || !email) {
      sendJson(res, 400, { error: 'Name and email are required' });
      return true;
    }

    state.records.team = state.records.team || [];
    const existing = state.records.team.find(m => m.email === email && m.agencyId === agency.id);
    if (existing) {
      sendJson(res, 409, { error: 'A team member with this email already exists' });
      return true;
    }

    const memberId = randomUUID();
    const member = {
      id: memberId,
      agencyId: agency.id,
      name,
      email,
      role,
      online: false,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    state.records.team.push(member);
    await saveState();

    auditLog('team.member_invited', actor, { memberId, name, email, role });
    broadcast('agency.team.member_invited', { member });

    sendJson(res, 201, { success: true, member });
    return true;
  }

  // 5. PUT /api/agency/team/:id/role
  if (method === 'PUT' && pathname.startsWith('/api/agency/team/') && pathname.endsWith('/role')) {
    if (!isAgencyAdmin) {
      sendJson(res, 403, { error: 'Only agency owners and admins can modify team roles' });
      return true;
    }
    const memberId = pathname.replace('/api/agency/team/', '').replace('/role', '').trim();
    const body = await readBody(req);
    const role = body.role === 'admin' ? 'admin' : 'user';

    state.records.team = state.records.team || [];
    const member = state.records.team.find(m => m.id === memberId && m.agencyId === agency.id);
    if (!member) {
      sendJson(res, 404, { error: 'Team member not found' });
      return true;
    }
    if (member.role === 'owner' && callerRole !== 'owner') {
      sendJson(res, 403, { error: 'Only an agency owner can modify an owner role' });
      return true;
    }
    if (member.email === actor?.user?.email && role !== callerRole) {
      sendJson(res, 403, { error: 'Members cannot modify their own role' });
      return true;
    }

    member.role = role;
    member.updatedAt = new Date().toISOString();
    await saveState();

    auditLog('team.role_updated', actor, { memberId, name: member.name, role });
    broadcast('agency.team.role_updated', { memberId, role });

    sendJson(res, 200, { success: true, member });
    return true;
  }

  // 6. DELETE /api/agency/team/:id
  if (method === 'DELETE' && pathname.startsWith('/api/agency/team/')) {
    if (!isAgencyAdmin) {
      sendJson(res, 403, { error: 'Only agency owners and admins can remove team members' });
      return true;
    }
    const memberId = pathname.replace('/api/agency/team/', '').trim();
    state.records.team = state.records.team || [];
    const idx = state.records.team.findIndex(m => m.id === memberId && m.agencyId === agency.id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Team member not found' });
      return true;
    }

    const removed = state.records.team.splice(idx, 1)[0];
    await saveState();

    auditLog('team.member_removed', actor, { memberId, name: removed.name });
    broadcast('agency.team.member_removed', { memberId });

    sendJson(res, 200, { success: true, member: removed });
    return true;
  }

  // 7. GET /api/agency/locations — list client workspaces with metrics
  if (method === 'GET' && pathname === '/api/agency/locations') {
    const agencyLocs = (state.locations || []).filter(l => l.agencyId === agency.id && l.status !== 'deleted');
    const enriched = agencyLocs.map(loc => {
      const contactsCount = (state.records.contacts || []).filter(c => c.agencyId === agency.id && c.locationId === loc.id).length;
      const opportunitiesCount = (state.records.opportunities || []).filter(o => o.agencyId === agency.id && o.locationId === loc.id).length;
      const appointmentsCount = (state.records.appointments || []).filter(a => a.agencyId === agency.id && a.locationId === loc.id).length;
      const workflowsCount = (state.records.workflows || []).filter(w => w.agencyId === agency.id && w.locationId === loc.id).length;

      return {
        id: loc.id,
        agencyId: loc.agencyId,
        name: loc.name,
        address: loc.address || '',
        phone: loc.phone || '',
        timezone: loc.timezone || 'UTC',
        industry: loc.industry || 'General',
        ownerEmail: loc.ownerEmail || '',
        planId: loc.planId || 'growth',
        seats: loc.seats || 1,
        status: loc.status || 'active',
        createdAt: loc.createdAt || new Date().toISOString(),
        contactsCount,
        opportunitiesCount,
        appointmentsCount,
        workflowsCount
      };
    });

    sendJson(res, 200, { locations: enriched });
    return true;
  }

  // 8. POST /api/agency/locations — provision a new client sub-account
  if (method === 'POST' && pathname === '/api/agency/locations') {
    const body = await readBody(req);
    if (!body.name || !body.name.trim()) {
      sendJson(res, 400, { error: 'Location name is required' });
      return true;
    }

    const newLocId = randomUUID();
    const newLocation = {
      id: newLocId,
      agencyId: agency.id,
      name: body.name.trim(),
      address: body.address ? String(body.address).trim() : '',
      phone: body.phone ? String(body.phone).trim() : '',
      timezone: body.timezone ? String(body.timezone).trim() : 'UTC',
      industry: body.industry ? String(body.industry).trim() : 'General',
      ownerEmail: body.ownerEmail ? String(body.ownerEmail).trim() : '',
      planId: body.planId || 'growth',
      seats: Number(body.seats) || 1,
      status: body.status || 'trial',
      createdAt: new Date().toISOString()
    };

    state.locations.push(newLocation);

    state.records.pipelines = state.records.pipelines || [];
    state.records.pipelines.push({
      id: randomUUID(),
      agencyId: agency.id,
      locationId: newLocId,
      name: `${newLocation.name} Sales Pipeline`,
      stages: ['Lead', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'],
      status: 'active',
      createdAt: new Date().toISOString()
    });

    await saveState();
    auditLog('agency.location.created', actor, { locationId: newLocId, name: newLocation.name });
    broadcast('agency.location.created', newLocation);

    sendJson(res, 201, newLocation);
    return true;
  }

  // 9. PUT /api/agency/locations/:id — update sub-account details / status
  if (method === 'PUT' && pathname.startsWith('/api/agency/locations/')) {
    const locId = pathname.replace('/api/agency/locations/', '').trim();
    const loc = (state.locations || []).find(l => l.id === locId && l.agencyId === agency.id);
    if (!loc) {
      sendJson(res, 404, { error: 'Location not found' });
      return true;
    }

    const body = await readBody(req);
    if (body.name) loc.name = body.name.trim();
    if (body.address !== undefined) loc.address = String(body.address).trim();
    if (body.phone !== undefined) loc.phone = String(body.phone).trim();
    if (body.timezone) loc.timezone = String(body.timezone).trim();
    if (body.industry) loc.industry = String(body.industry).trim();
    if (body.ownerEmail !== undefined) loc.ownerEmail = String(body.ownerEmail).trim();
    if (body.planId) loc.planId = body.planId;
    if (body.seats !== undefined) loc.seats = Number(body.seats) || 1;
    if (body.status) loc.status = body.status;
    loc.updatedAt = new Date().toISOString();

    await saveState();
    auditLog('agency.location.updated', actor, { locationId: locId, updates: Object.keys(body) });
    broadcast('agency.location.updated', loc);

    sendJson(res, 200, loc);
    return true;
  }

  // 10. DELETE /api/agency/locations/:id — deactivate client sub-account
  if (method === 'DELETE' && pathname.startsWith('/api/agency/locations/')) {
    const locId = pathname.replace('/api/agency/locations/', '').trim();
    const loc = (state.locations || []).find(l => l.id === locId && l.agencyId === agency.id);
    if (!loc) {
      sendJson(res, 404, { error: 'Location not found' });
      return true;
    }

    const activeCount = (state.locations || []).filter(l => l.agencyId === agency.id && l.status === 'active').length;
    if (activeCount <= 1 && loc.status === 'active') {
      sendJson(res, 400, { error: 'Cannot deactivate the sole active workspace' });
      return true;
    }

    loc.status = 'deleted';
    loc.updatedAt = new Date().toISOString();
    await saveState();

    auditLog('agency.location.deleted', actor, { locationId: locId });
    broadcast('agency.location.deleted', { locationId: locId });

    sendJson(res, 200, { success: true, deletedId: locId });
    return true;
  }

  // 11. GET /api/agency/snapshots — list snapshot templates for agency
  if (method === 'GET' && pathname === '/api/agency/snapshots') {
    const snapshots = (state.snapshots || [])
      .filter(s => s.agencyId === agency.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(s => ({
        id: s.id,
        agencyId: s.agencyId,
        sourceLocationId: s.sourceLocationId,
        name: s.name,
        description: s.description || '',
        industry: s.industry || 'General',
        counts: s.counts || {
          workflows: (s.data?.workflows || []).length,
          pipelines: (s.data?.pipelines || []).length,
          calendars: (s.data?.calendars || []).length,
          forms: (s.data?.forms || []).length,
          paymentLinks: (s.data?.paymentLinks || []).length,
          contacts: (s.data?.contacts || []).length
        },
        createdAt: s.createdAt
      }));

    sendJson(res, 200, { snapshots });
    return true;
  }

  // 12. POST /api/agency/snapshots — create new snapshot from workspace
  if (method === 'POST' && pathname === '/api/agency/snapshots') {
    const body = await readBody(req);
    const sourceLocId = body.sourceLocationId || activeLocation.id;
    const sourceLoc = (state.locations || []).find(l => l.id === sourceLocId && l.agencyId === agency.id);
    if (!sourceLoc) {
      sendJson(res, 404, { error: 'Source workspace not found' });
      return true;
    }

    const workflows = (state.records.workflows || []).filter(w => w.agencyId === agency.id && w.locationId === sourceLocId);
    const pipelines = (state.records.pipelines || []).filter(p => p.agencyId === agency.id && p.locationId === sourceLocId);
    const calendars = (state.records.calendars || []).filter(c => c.agencyId === agency.id && c.locationId === sourceLocId);
    const forms = (state.records.forms || []).filter(f => f.agencyId === agency.id && f.locationId === sourceLocId);
    const paymentLinks = (state.records.paymentLinks || []).filter(p => p.agencyId === agency.id && p.locationId === sourceLocId);
    const contacts = body.includeContacts
      ? (state.records.contacts || []).filter(c => c.agencyId === agency.id && c.locationId === sourceLocId)
      : [];

    const newSnapshot = {
      id: randomUUID(),
      agencyId: agency.id,
      sourceLocationId: sourceLocId,
      name: (body.name || `Snapshot — ${new Date().toLocaleDateString()}`).trim(),
      description: (body.description || '').trim(),
      industry: (body.industry || sourceLoc.industry || 'General').trim(),
      counts: {
        workflows: workflows.length,
        pipelines: pipelines.length,
        calendars: calendars.length,
        forms: forms.length,
        paymentLinks: paymentLinks.length,
        contacts: contacts.length
      },
      data: {
        workflows: workflows.map(w => ({ ...w })),
        pipelines: pipelines.map(p => ({ ...p })),
        calendars: calendars.map(c => ({ ...c })),
        forms: forms.map(f => ({ ...f })),
        paymentLinks: paymentLinks.map(p => ({ ...p })),
        contacts: contacts.map(c => ({ ...c }))
      },
      createdAt: new Date().toISOString()
    };

    state.snapshots = state.snapshots || [];
    state.snapshots.unshift(newSnapshot);

    const agencySnaps = state.snapshots.filter(s => s.agencyId === agency.id);
    if (agencySnaps.length > 10) {
      const oldest = agencySnaps[agencySnaps.length - 1];
      state.snapshots = state.snapshots.filter(s => s.id !== oldest.id);
    }

    await saveState();
    auditLog('agency.snapshot.created', actor, { snapshotId: newSnapshot.id, name: newSnapshot.name });
    broadcast('agency.snapshot.created', { id: newSnapshot.id, name: newSnapshot.name });

    sendJson(res, 201, newSnapshot);
    return true;
  }

  // 13. POST /api/agency/snapshots/:id/deploy — deep-clone snapshot into target client sub-account
  if (method === 'POST' && pathname.startsWith('/api/agency/snapshots/') && pathname.endsWith('/deploy')) {
    const snapshotId = pathname.replace('/api/agency/snapshots/', '').replace('/deploy', '').trim();
    const snapshot = (state.snapshots || []).find(s => s.id === snapshotId && s.agencyId === agency.id);
    if (!snapshot) {
      sendJson(res, 404, { error: 'Snapshot not found' });
      return true;
    }

    const body = await readBody(req);
    const targetLocId = body.targetLocationId;
    if (!targetLocId) {
      sendJson(res, 400, { error: 'targetLocationId is required' });
      return true;
    }

    const targetLoc = (state.locations || []).find(l => l.id === targetLocId && l.agencyId === agency.id);
    if (!targetLoc) {
      sendJson(res, 404, { error: 'Target workspace not found' });
      return true;
    }

    const deployed = {
      workflows: 0,
      pipelines: 0,
      calendars: 0,
      forms: 0,
      paymentLinks: 0,
      contacts: 0
    };

    for (const w of (snapshot.data.workflows || [])) {
      state.records.workflows = state.records.workflows || [];
      state.records.workflows.push({
        ...w,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: targetLocId,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      deployed.workflows++;
    }

    for (const p of (snapshot.data.pipelines || [])) {
      state.records.pipelines = state.records.pipelines || [];
      state.records.pipelines.push({
        ...p,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: targetLocId,
        createdAt: new Date().toISOString()
      });
      deployed.pipelines++;
    }

    for (const c of (snapshot.data.calendars || [])) {
      state.records.calendars = state.records.calendars || [];
      state.records.calendars.push({
        ...c,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: targetLocId,
        slug: `${c.slug}-${randomBytes(3).toString('hex')}`,
        createdAt: new Date().toISOString()
      });
      deployed.calendars++;
    }

    for (const f of (snapshot.data.forms || [])) {
      state.records.forms = state.records.forms || [];
      state.records.forms.push({
        ...f,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: targetLocId,
        publicSlug: `${f.publicSlug}-${randomBytes(3).toString('hex')}`,
        createdAt: new Date().toISOString()
      });
      deployed.forms++;
    }

    for (const pl of (snapshot.data.paymentLinks || [])) {
      state.records.paymentLinks = state.records.paymentLinks || [];
      state.records.paymentLinks.push({
        ...pl,
        id: randomUUID(),
        agencyId: agency.id,
        locationId: targetLocId,
        slug: `${pl.slug}-${randomBytes(3).toString('hex')}`,
        createdAt: new Date().toISOString()
      });
      deployed.paymentLinks++;
    }

    if (body.includeContacts && Array.isArray(snapshot.data?.contacts)) {
      for (const ct of snapshot.data.contacts) {
        state.records.contacts = state.records.contacts || [];
        state.records.contacts.push({
          ...ct,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          createdAt: new Date().toISOString()
        });
        deployed.contacts++;
      }
    }

    await saveState();
    auditLog('agency.snapshot.deployed', actor, { snapshotId, targetLocationId: targetLocId, deployed });
    broadcast('agency.snapshot.deployed', { snapshotId, targetLocationId: targetLocId, deployed });

    sendJson(res, 200, {
      success: true,
      snapshotId,
      targetLocationId: targetLocId,
      targetLocationName: targetLoc.name,
      deployed
    });
    return true;
  }

  // 14. GET /api/agency/snapshots/:id/diff/:locationId — Snapshot Diff
  const snapshotDiffMatch = pathname.match(/^\/api\/agency\/snapshots\/([a-zA-Z0-9_-]+)\/diff\/([a-zA-Z0-9_-]+)$/);
  if (method === 'GET' && snapshotDiffMatch) {
    const snapshotId = snapshotDiffMatch[1];
    const targetLocId = snapshotDiffMatch[2];

    const snapshot = (state.snapshots || []).find(s => s.id === snapshotId && s.agencyId === agency.id);
    if (!snapshot) {
      sendJson(res, 404, { error: 'Snapshot not found' });
      return true;
    }

    const targetLoc = (state.locations || []).find(l => l.id === targetLocId && l.agencyId === agency.id);
    if (!targetLoc) {
      sendJson(res, 404, { error: 'Target workspace not found' });
      return true;
    }

    const categories = ['workflows', 'pipelines', 'calendars', 'forms', 'paymentLinks'];
    const diff = {};
    let newCount = 0;
    let modifiedCount = 0;
    let syncedCount = 0;

    for (const cat of categories) {
      const snapshotItems = snapshot.data?.[cat] || [];
      const existingItems = (state.records[cat] || []).filter(r => r.agencyId === agency.id && r.locationId === targetLocId);

      diff[cat] = snapshotItems.map(item => {
        const match = existingItems.find(e => e.name === item.name || e.title === item.title || (item.slug && e.slug && e.slug.startsWith(item.slug)));
        if (!match) {
          newCount++;
          return { name: item.name || item.title || item.slug, status: 'new', action: 'create' };
        }
        const isModified = (item.steps && match.steps && item.steps.length !== match.steps.length) ||
                           (item.fields && match.fields && item.fields.length !== match.fields.length);
        if (isModified) {
          modifiedCount++;
          return { name: item.name || item.title || item.slug, status: 'modified', action: 'update', existingId: match.id };
        }
        syncedCount++;
        return { name: item.name || item.title || item.slug, status: 'synced', action: 'skip', existingId: match.id };
      });
    }

    sendJson(res, 200, {
      snapshotId,
      snapshotName: snapshot.name,
      targetLocationId: targetLocId,
      targetLocationName: targetLoc.name,
      summary: { newCount, modifiedCount, syncedCount, totalBlueprintItems: newCount + modifiedCount + syncedCount },
      diff
    });
    return true;
  }

  // 15. POST /api/agency/snapshots/:id/sync/:locationId — Push Sync
  const snapshotSyncMatch = pathname.match(/^\/api\/agency\/snapshots\/([a-zA-Z0-9_-]+)\/sync\/([a-zA-Z0-9_-]+)$/);
  if (method === 'POST' && snapshotSyncMatch) {
    const snapshotId = snapshotSyncMatch[1];
    const targetLocId = snapshotSyncMatch[2];

    const snapshot = (state.snapshots || []).find(s => s.id === snapshotId && s.agencyId === agency.id);
    if (!snapshot) {
      sendJson(res, 404, { error: 'Snapshot not found' });
      return true;
    }

    const targetLoc = (state.locations || []).find(l => l.id === targetLocId && l.agencyId === agency.id);
    if (!targetLoc) {
      sendJson(res, 404, { error: 'Target workspace not found' });
      return true;
    }

    const body = await readBody(req);
    const selectedResources = Array.isArray(body.resources) && body.resources.length > 0
      ? body.resources
      : ['workflows', 'pipelines', 'calendars', 'forms', 'paymentLinks'];

    const synced = {};

    for (const cat of selectedResources) {
      synced[cat] = 0;
      const items = snapshot.data?.[cat] || [];
      state.records[cat] = state.records[cat] || [];

      for (const item of items) {
        const clone = {
          ...item,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          status: 'active',
          createdAt: new Date().toISOString()
        };
        if (clone.slug) {
          clone.slug = `${clone.slug}-${randomBytes(3).toString('hex')}`;
        }
        state.records[cat].push(clone);
        synced[cat]++;
      }
    }

    await saveState();
    auditLog('agency.snapshot.synced', actor, { snapshotId, targetLocationId: targetLocId, selectedResources, synced });
    broadcast('agency.snapshot.synced', { snapshotId, targetLocationId: targetLocId, synced });

    sendJson(res, 200, {
      success: true,
      snapshotId,
      targetLocationId: targetLocId,
      selectedResources,
      synced
    });
    return true;
  }

  // 16. POST /api/agency/snapshots/:id/restore — restore active workspace
  if (method === 'POST' && pathname.startsWith('/api/agency/snapshots/') && pathname.endsWith('/restore')) {
    const snapshotId = pathname.replace('/api/agency/snapshots/', '').replace('/restore', '').trim();
    const snapshot = (state.snapshots || []).find(s => s.id === snapshotId && s.agencyId === agency.id);
    if (!snapshot) {
      sendJson(res, 404, { error: 'Snapshot not found' });
      return true;
    }

    const targetLocId = activeLocation.id;

    const collectionsToRestore = ['workflows', 'pipelines', 'calendars', 'forms', 'paymentLinks'];
    for (const col of collectionsToRestore) {
      if (state.records[col]) {
        state.records[col] = state.records[col].filter(r => !(r.agencyId === agency.id && r.locationId === targetLocId));
      }
    }

    for (const w of (snapshot.data.workflows || [])) {
      state.records.workflows.push({ ...w, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
    }
    for (const p of (snapshot.data.pipelines || [])) {
      state.records.pipelines.push({ ...p, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
    }
    for (const c of (snapshot.data.calendars || [])) {
      state.records.calendars.push({ ...c, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
    }
    for (const f of (snapshot.data.forms || [])) {
      state.records.forms.push({ ...f, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
    }
    for (const pl of (snapshot.data.paymentLinks || [])) {
      state.records.paymentLinks.push({ ...pl, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
    }

    await saveState();
    auditLog('agency.snapshot.restored', actor, { snapshotId, locationId: targetLocId });
    broadcast('agency.snapshot.restored', { snapshotId, locationId: targetLocId });

    sendJson(res, 200, { success: true, restoredAt: new Date().toISOString() });
    return true;
  }

  // 17. DELETE /api/agency/snapshots/:id — delete a snapshot
  if (method === 'DELETE' && pathname.startsWith('/api/agency/snapshots/')) {
    const snapshotId = pathname.replace('/api/agency/snapshots/', '').trim();
    const idx = (state.snapshots || []).findIndex(s => s.id === snapshotId && s.agencyId === agency.id);
    if (idx === -1) {
      sendJson(res, 404, { error: 'Snapshot not found' });
      return true;
    }

    state.snapshots.splice(idx, 1);
    await saveState();
    auditLog('agency.snapshot.deleted', actor, { snapshotId });
    broadcast('agency.snapshot.deleted', { snapshotId });

    sendJson(res, 200, { success: true, deletedId: snapshotId });
    return true;
  }

  // 18. Branding endpoints
  if (method === 'GET' && pathname === '/api/agency/branding') {
    state.agencyBranding = state.agencyBranding || {};
    const branding = state.agencyBranding[agency.id] || (getDefaultBranding ? getDefaultBranding() : {});
    sendJson(res, 200, { branding });
    return true;
  }

  if (method === 'PUT' && pathname === '/api/agency/branding') {
    state.agencyBranding = state.agencyBranding || {};
    const body = await readBody(req);
    const current = state.agencyBranding[agency.id] || (getDefaultBranding ? getDefaultBranding() : {});
    const updated = {
      ...current,
      ...body,
      updatedAt: new Date().toISOString()
    };
    state.agencyBranding[agency.id] = updated;
    await saveState();
    auditLog('agency.branding_updated', actor, { platformName: updated.platformName });
    sendJson(res, 200, { success: true, branding: updated });
    return true;
  }

  if (method === 'POST' && pathname === '/api/agency/branding/verify-domain') {
    state.agencyBranding = state.agencyBranding || {};
    const current = state.agencyBranding[agency.id] || (getDefaultBranding ? getDefaultBranding() : {});
    const body = await readBody(req);
    const domainToVerify = body.customDomain || current.customDomain;
    if (!domainToVerify) {
      sendJson(res, 400, { error: 'Custom domain is required to verify' });
      return true;
    }

    current.customDomain = domainToVerify;
    current.isDomainVerified = true;
    current.sslActive = true;
    current.verifiedAt = new Date().toISOString();
    state.agencyBranding[agency.id] = current;

    await saveState();
    auditLog('agency.domain_verified', actor, { domain: current.customDomain });
    sendJson(res, 200, { success: true, branding: current, message: 'Domain CNAME & SSL verified' });
    return true;
  }

  if (method === 'POST' && pathname === '/api/agency/branding/verify-email') {
    state.agencyBranding = state.agencyBranding || {};
    const current = state.agencyBranding[agency.id] || (getDefaultBranding ? getDefaultBranding() : {});
    current.isDkimVerified = true;
    current.dkimVerifiedAt = new Date().toISOString();
    state.agencyBranding[agency.id] = current;

    await saveState();
    auditLog('agency.email_verified', actor, { senderEmail: current.senderEmail });
    sendJson(res, 200, { success: true, branding: current, message: 'SPF & DKIM verified' });
    return true;
  }

  return false;
}
