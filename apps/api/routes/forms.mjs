/**
 * ============================================================================
 * Operza Forms & Public Submissions Router — TenantTx Boundary
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createFormsRepository } from '../../../packages/db/lib/forms-repository.mjs';

const formsRepo = createFormsRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function stripTenantFields(body) {
  if (!body || typeof body !== 'object') return {};
  const { agencyId: _a, locationId: _l, ...rest } = body;
  return rest;
}

function validateSubmissionFields(form, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return 'answers must be an object';
  }
  const serialized = JSON.stringify(answers);
  if (serialized.length > 65_536) {
    return 'Submission payload exceeds maximum allowed size';
  }
  const keys = Object.keys(answers);
  if (keys.length === 0) {
    return 'Form submission answers cannot be empty';
  }
  for (const field of form.fields || []) {
    if (!field?.required) continue;
    const key = field.id || field.name;
    if (Object.prototype.hasOwnProperty.call(answers, key) && String(answers[key] ?? '').trim() === '') {
      return `Missing required field: ${field.label || key}`;
    }
  }
  return null;
}

export async function handleFormsRoutes(req, res, ctx) {
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
    triggerWorkflowExecution,
    randomUUID
  } = ctx;

  const queryUrl = url || new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);

  // ── 1. Public Form Lookup ─────────────────────────────────────────────────
  if (method === 'GET' && pathname.startsWith('/api/forms/public/')) {
    const slug = pathname.replace('/api/forms/public/', '').trim();
    const form = (state.records?.forms || []).find(
      f => (f.publicSlug === slug || f.slug === slug || f.id === slug) &&
           (f.status === 'published' || f.published === true)
    );
    if (!form) {
      sendJson(res, 404, { error: 'Form not found or unpublished' });
      return true;
    }
    sendJson(res, 200, {
      id: form.id,
      name: form.name,
      fields: form.fields,
      description: form.description,
      completion: form.completion
    });
    return true;
  }

  // ── 2. Public Form Submission Ingress ─────────────────────────────────────
  if (method === 'POST' && pathname.startsWith('/api/forms/submit/')) {
    const slug = pathname.replace('/api/forms/submit/', '').trim();
    const form = (state.records?.forms || []).find(
      f => (f.publicSlug === slug || f.slug === slug || f.id === slug) &&
           (f.status === 'published' || f.published === true)
    );
    if (!form) {
      sendJson(res, 404, { error: 'Form not found or unpublished' });
      return true;
    }

    const body = await readBody(req);
    if (body.website || body.hp || body.company_fax) {
      sendJson(res, 400, { error: 'Bot submission rejected', code: 'BOT_SUBMISSION_REJECTED' });
      return true;
    }

    const answers = body.answers || {};
    const validationError = validateSubmissionFields(form, answers);
    if (validationError) {
      sendJson(res, 400, { error: validationError, code: 'FORM_VALIDATION_FAILED' });
      return true;
    }

    // Derive tenant context strictly from server-side published form record
    const formAgencyId = form.agencyId;
    const formLocationId = form.locationId;

    let email = answers.email || answers.workEmail || answers.fld_email || '';
    let firstName = answers.firstName || answers.first_name || answers.name || answers.fld_first || '';
    let lastName = answers.lastName || answers.last_name || answers.fld_last || '';
    let phone = answers.phone || answers.phoneNumber || answers.fld_phone || '';
    let company = answers.company || answers.companyName || '';

    if (!email || !firstName) {
      for (const [k, v] of Object.entries(answers)) {
        const lk = k.toLowerCase();
        if (!email && (lk.includes('email') || (typeof v === 'string' && v.includes('@')))) email = v;
        if (!firstName && (lk.includes('first') || lk === 'name')) firstName = v;
        if (!lastName && lk.includes('last')) lastName = v;
        if (!phone && lk.includes('phone')) phone = v;
      }
    }
    firstName = firstName || 'Website';
    lastName = lastName || 'Lead';

    state.records.contacts = state.records.contacts || [];
    let contact = email ? state.records.contacts.find(c => c.email === email && c.agencyId === formAgencyId) : null;
    let contactId = contact?.id;

    if (!contact) {
      contactId = randomUUID();
      contact = {
        id: contactId,
        agencyId: formAgencyId,
        locationId: formLocationId,
        firstName, lastName, email, phone, company,
        source: `Form: ${form.name}`,
        tags: ['web-lead', form.name],
        status: 'lead',
        customValues: answers,
        createdAt: new Date().toISOString()
      };
      state.records.contacts.push(contact);
      broadcast?.('crm.contact.created', { id: contactId, firstName, lastName, source: 'form' });
    } else {
      contact.tags = contact.tags || [];
      if (!contact.tags.includes('web-lead')) contact.tags.push('web-lead');
      if (!contact.tags.includes(form.name)) contact.tags.push(form.name);
      contact.customValues = { ...(contact.customValues || {}), ...answers };
      contact.updatedAt = new Date().toISOString();
      broadcast?.('crm.contact.updated', { id: contactId, firstName: contact.firstName, lastName: contact.lastName });
    }

    form.submissions = (form.submissions || 0) + 1;
    state.records.formSubmissions = state.records.formSubmissions || [];
    const submissionId = randomUUID();
    const submission = {
      id: submissionId,
      agencyId: formAgencyId,
      locationId: formLocationId,
      formId: form.id,
      formName: form.name,
      contactId,
      contactName: `${firstName} ${lastName}`.trim(),
      email,
      phone,
      company,
      answers,
      source: body.source || 'web_form',
      status: 'new',
      submittedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    state.records.formSubmissions.push(submission);

    const oppId = randomUUID();
    const opportunity = {
      id: oppId,
      agencyId: formAgencyId,
      locationId: formLocationId,
      contactId,
      name: `${firstName} ${lastName} - ${form.name}`,
      pipeline: 'Lead Pipeline',
      stage: 'New Inbound Lead',
      value: 1000,
      status: 'open',
      source: form.name,
      createdAt: new Date().toISOString()
    };
    state.records.opportunities = state.records.opportunities || [];
    state.records.opportunities.push(opportunity);

    await saveState();

    auditLog?.('form.submitted', null, { formId: form.id, submissionId, contactId });
    broadcast?.('crm.form.submitted', { formId: form.id, contactId, submissionId });
    broadcast?.('crm.form.submission_received', { formId: form.id, submissionId, contactName: `${firstName} ${lastName}`.trim() });
    broadcast?.('crm.opportunity.created', { id: oppId, name: opportunity.name });

    if (typeof triggerWorkflowExecution === 'function') {
      triggerWorkflowExecution({
        agencyId: formAgencyId,
        locationId: formLocationId,
        triggerType: 'form',
        triggerContext: { form, submission, contact, opportunity, answers }
      }).catch(err => console.error('Form workflow trigger failed:', err));
    }

    sendJson(res, 200, {
      success: true,
      message: 'Thank you! Submission received.',
      submissionId,
      contactId,
      completion: form.completion || { type: 'message', message: 'Thank you for your submission!' }
    });
    return true;
  }

  // Authenticated tenant context required below
  const agencyId = agency?.id;
  const locationId = activeLocation?.id;
  const actorId = actor?.user?.id || 'system';

  // ── 3. POST /api/forms/:id/publish ────────────────────────────────────────
  if (method === 'POST' && pathname.startsWith('/api/forms/') && pathname.endsWith('/publish')) {
    if (!checkScope(actor, 'forms:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (forms:write required)' });
      return true;
    }
    const formId = pathname.replace('/api/forms/', '').replace('/publish', '').trim();
    const body = stripTenantFields(await readBody(req));

    if (pgPool) {
      const updated = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, async tx => {
        const existing = await formsRepo.getForm(tx, { agencyId, locationId, id: formId });
        if (!existing) return null;
        const isPublished = body.published !== undefined ? Boolean(body.published) : !existing.published;
        return formsRepo.updateForm(tx, {
          agencyId,
          locationId,
          id: formId,
          patch: { published: isPublished, status: isPublished ? 'published' : 'draft' }
        });
      });
      if (!updated) {
        sendJson(res, 404, { error: 'Form not found' });
        return true;
      }
      auditLog?.(updated.published ? 'form.published' : 'form.unpublished', actor, { formId, name: updated.name });
      broadcast?.('crm.form.updated', { id: formId, published: updated.published, status: updated.status });
      sendJson(res, 200, { success: true, form: updated });
      return true;
    }

    state.records.forms = state.records.forms || [];
    const form = state.records.forms.find(f => f.id === formId && f.agencyId === agencyId);
    if (!form) {
      sendJson(res, 404, { error: 'Form not found' });
      return true;
    }
    const isPublished = body.published !== undefined ? Boolean(body.published) : !form.published;
    form.published = isPublished;
    form.status = isPublished ? 'published' : 'draft';
    form.updatedAt = new Date().toISOString();
    await saveState();

    auditLog?.(isPublished ? 'form.published' : 'form.unpublished', actor, { formId, name: form.name });
    broadcast?.('crm.form.updated', { id: formId, published: isPublished, status: form.status });
    sendJson(res, 200, { success: true, form });
    return true;
  }

  // ── 4. GET /api/forms/submissions & /api/forms/:id/submissions ────────────
  if (method === 'GET' && (pathname === '/api/forms/submissions' || (pathname.startsWith('/api/forms/') && pathname.endsWith('/submissions')))) {
    if (!checkScope(actor, 'forms:read', ['crm:read'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (forms:read required)' });
      return true;
    }
    let formId = queryUrl.searchParams.get('formId');
    if (pathname.startsWith('/api/forms/') && pathname.endsWith('/submissions') && pathname !== '/api/forms/submissions') {
      formId = pathname.replace('/api/forms/', '').replace('/submissions', '').trim();
    }
    if (pgPool) {
      const submissions = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
        formsRepo.listSubmissions(tx, { agencyId, locationId, formId })
      );
      sendJson(res, 200, { submissions });
      return true;
    }
    state.records.formSubmissions = state.records.formSubmissions || [];
    const submissions = state.records.formSubmissions.filter(s =>
      s.agencyId === agencyId &&
      (!locationId || s.locationId === locationId) &&
      (!formId || s.formId === formId)
    );
    sendJson(res, 200, { submissions });
    return true;
  }

  // ── 5. /api/crm/forms CRUD ────────────────────────────────────────────────
  if (pathname === '/api/crm/forms' || pathname.startsWith('/api/crm/forms/')) {
    const formId = pathname === '/api/crm/forms' ? null : pathname.replace('/api/crm/forms/', '').trim();

    if (method === 'GET' && !formId) {
      if (!checkScope(actor, 'forms:read', ['crm:read'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (forms:read required)' });
        return true;
      }
      if (pgPool) {
        const rows = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          formsRepo.listForms(tx, { agencyId, locationId })
        );
        sendJson(res, 200, { data: rows, forms: rows, total: rows.length });
        return true;
      }
      const rows = (state.records?.forms || []).filter(f => f.agencyId === agencyId && (!locationId || f.locationId === locationId));
      sendJson(res, 200, { data: rows, forms: rows, total: rows.length });
      return true;
    }

    if (method === 'POST' && !formId) {
      if (!checkScope(actor, 'forms:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (forms:write required)' });
        return true;
      }
      const body = stripTenantFields(await readBody(req));
      if (!body.name || !String(body.name).trim()) {
        sendJson(res, 400, { error: 'Form name is required' });
        return true;
      }
      let created;
      if (pgPool) {
        created = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          formsRepo.createForm(tx, { ...body, agencyId, locationId })
        );
      } else {
        state.records.forms = state.records.forms || [];
        created = {
          id: randomUUID(),
          agencyId,
          locationId,
          name: String(body.name).trim(),
          description: body.description || '',
          publicSlug: body.publicSlug || body.slug || null,
          status: body.published ? 'published' : (body.status || 'draft'),
          published: Boolean(body.published),
          fields: Array.isArray(body.fields) ? body.fields : [],
          completion: body.completion || {},
          submissions: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.forms.push(created);
        await saveState();
      }
      auditLog?.('form.created', actor, { formId: created.id, name: created.name });
      sendJson(res, 201, created);
      return true;
    }

    if (method === 'GET' && formId) {
      if (!checkScope(actor, 'forms:read', ['crm:read'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (forms:read required)' });
        return true;
      }
      const found = pgPool
        ? await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
            formsRepo.getForm(tx, { agencyId, locationId, id: formId })
          )
        : (state.records?.forms || []).find(f => f.id === formId && f.agencyId === agencyId);
      if (!found) {
        sendJson(res, 404, { error: 'Form not found' });
        return true;
      }
      sendJson(res, 200, found);
      return true;
    }

    if ((method === 'PUT' || method === 'PATCH') && formId) {
      if (!checkScope(actor, 'forms:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (forms:write required)' });
        return true;
      }
      const body = stripTenantFields(await readBody(req));
      let updated;
      if (pgPool) {
        updated = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          formsRepo.updateForm(tx, { agencyId, locationId, id: formId, patch: body })
        );
      } else {
        const form = (state.records?.forms || []).find(f => f.id === formId && f.agencyId === agencyId);
        if (form) {
          Object.assign(form, body, { updatedAt: new Date().toISOString() });
          await saveState();
          updated = form;
        }
      }
      if (!updated) {
        sendJson(res, 404, { error: 'Form not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }

    if (method === 'DELETE' && formId) {
      if (!checkScope(actor, 'forms:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (forms:write required)' });
        return true;
      }
      let deleted = false;
      if (pgPool) {
        deleted = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          formsRepo.deleteForm(tx, { agencyId, locationId, id: formId })
        );
      } else {
        state.records.forms = state.records.forms || [];
        const idx = state.records.forms.findIndex(f => f.id === formId && f.agencyId === agencyId);
        if (idx !== -1) {
          state.records.forms.splice(idx, 1);
          await saveState();
          deleted = true;
        }
      }
      if (!deleted) {
        sendJson(res, 404, { error: 'Form not found' });
        return true;
      }
      sendJson(res, 200, { success: true, id: formId });
      return true;
    }
  }

  return false;
}
