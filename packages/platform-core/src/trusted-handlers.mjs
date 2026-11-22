import crypto from 'node:crypto';
import { PermanentJobError } from './durable-worker.mjs';
import { getWorkflowActionDefinition, computeActionHash, approvalEvidenceIsValid } from '../../workflow-engine/src/action-governance.mjs';
import { walkGraph } from '../../workflow-engine/src/engine.mjs';
import { createProviderAdapterRegistry, getProviderCapability } from './provider-adapters.mjs';
import { createWorkflowOutboxRepository } from '../../db/lib/outbox-repository.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * Authoritatively verifies consent records from PostgreSQL communication_consents table.
 * Strictly fails closed: never fabricates consent evidence from a Boolean flag
 * or accepts caller-supplied unpersisted objects without database verification.
 */
export async function verifyAuthoritativeConsent({ pool, tenantId, locationId, contactId, channel, purpose = 'transactional', suppliedConsent = null }) {
  if (!pool || !tenantId || !locationId || !contactId || !channel) {
    return null;
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId]);

    let targetContactId = contactId;
    if (!UUID_REGEX.test(contactId)) {
      // Look up contact UUID from location_records
      const contactLookup = await client.query(`
        SELECT id FROM location_records
        WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts'
          AND (body->>'email' = $3 OR body->>'phone' = $3 OR id::text = $3)
        LIMIT 1
      `, [tenantId, locationId, contactId]);
      if (contactLookup.rows.length > 0) {
        targetContactId = contactLookup.rows[0].id;
      } else {
        await client.query('ROLLBACK');
        return null;
      }
    }

    const res = await client.query(`
      SELECT id, agency_id, location_id, contact_id, channel, purpose, status, source, expires_at, captured_at
      FROM communication_consents
      WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3::uuid AND channel = $4 AND purpose = $5
      ORDER BY captured_at DESC
      LIMIT 1
    `, [tenantId, locationId, targetContactId, channel, purpose]);

    await client.query('COMMIT');

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    if (row.status !== 'granted') return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

    return {
      status: 'granted',
      consentId: row.id,
      channel: row.channel,
      purpose: row.purpose,
      contactId: row.contact_id,
      source: row.source,
      grantedAt: row.captured_at?.toISOString?.() || row.captured_at
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function executeAtomicCrmAction({
  pool,
  outboxRepo,
  tenantId,
  locationId,
  executionId,
  workflowId,
  nodeId,
  actionType,
  invocationKey,
  input,
  workerId,
  mode = 'live',
  mutationFn
}) {
  if (mode === 'dry_run') {
    return { simulated: true, dryRun: true, actionType, nodeId };
  }

  if (!pool) {
    return mutationFn(null);
  }

  const locId = locationId || tenantId;
  const actionHash = computeActionHash({
    tenantId,
    locationId: locId,
    workflowId: workflowId || 'unknown_workflow',
    executionId: executionId || 'unknown_execution',
    nodeId: nodeId || actionType,
    actionType,
    invocationKey: invocationKey || 'default',
    input
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
      [tenantId, locId]
    );

    let claimResult = null;
    let claimToken = null;
    if (outboxRepo) {
      claimResult = await outboxRepo.claimActionReceipt({
        client,
        tenantId,
        locationId: locId,
        executionId: executionId || 'unknown_execution',
        nodeId: nodeId || actionType,
        actionHash,
        providerKey: 'internal_crm',
        workerId: workerId || 'system_worker',
        leaseSeconds: 60
      });
      claimToken = claimResult.claimToken;

      if (!claimResult.acquired) {
        if (claimResult.status === 'succeeded') {
          // Idempotent hit: return previously persisted result
          await client.query('COMMIT');
          return claimResult.result;
        }
        if (claimResult.status === 'indeterminate') {
          await client.query('ROLLBACK');
          throw Object.assign(new Error(`Action ${actionType} is in indeterminate state`), {
            code: 'ACTION_INDETERMINATE',
            retryable: false
          });
        }
        if (claimResult.status === 'in_progress') {
          await client.query('ROLLBACK');
          throw Object.assign(new Error(`Action ${actionType} is already in progress by worker ${claimResult.leaseOwner}`), {
            code: 'ACTION_ALREADY_IN_PROGRESS',
            retryable: true
          });
        }
        await client.query('ROLLBACK');
        throw Object.assign(new Error(`Failed to claim action receipt for ${actionType}`), {
          code: 'ACTION_CLAIM_FAILED',
          retryable: true
        });
      }
    }

    // Perform CRM mutation inside transaction
    const mutationResult = await mutationFn(client);

    // Complete receipt inside transaction
    if (outboxRepo) {
      const safeResult = mutationResult && typeof mutationResult === 'object' ? mutationResult : { success: true };
      const providerReceipt = typeof mutationResult?.id === 'string'
        ? mutationResult.id
        : (typeof mutationResult?.taskId === 'string'
          ? mutationResult.taskId
          : (typeof mutationResult?.opportunityId === 'string' ? mutationResult.opportunityId : null));

      await outboxRepo.completeActionReceipt({
        client,
        tenantId,
        locationId: locId,
        actionHash,
        claimToken,
        result: safeResult,
        providerReceipt,
        outcomeDetails: { actionType, nodeId: nodeId || actionType, completedAt: new Date().toISOString() }
      });
    }

    await client.query('COMMIT');
    return mutationResult;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function executeDurableProviderAction({
  pool,
  outboxRepo,
  tenantId,
  locationId,
  executionId,
  node,
  invocation,
  context,
  mode = 'live',
  providerRegistry,
  secretResolver,
  workerId,
  signal
}) {
  if (mode === 'dry_run') {
    return { ok: true, simulated: true, providerAccepted: false };
  }
  const providerKey = invocation.providerKey;
  const adapter = providerRegistry?.get(providerKey);
  if (!adapter) {
    throw new PermanentJobError(`Provider adapter not found: ${providerKey}`, 'PROVIDER_ADAPTER_UNAVAILABLE');
  }

  const locId = locationId || tenantId;
  const actionHash = invocation.actionHash;
  if (!actionHash || !/^[a-f0-9]{64}$/.test(actionHash)) {
    throw new Error('Valid actionHash is required for provider execution');
  }

  // Pre-claim receipt before remote dispatch
  const capability = getProviderCapability(providerKey);
  const hasVerifiedIdempotency = capability?.safeRetryAfterAmbiguous === true;
  let claimToken = null;
  if (outboxRepo && pool) {
    const claim = await outboxRepo.claimActionReceipt({
      tenantId,
      locationId: locId,
      executionId: executionId || 'unknown_execution',
      nodeId: node.id,
      actionHash,
      providerKey,
      workerId: workerId || 'system_worker',
      leaseSeconds: 60,
      hasVerifiedIdempotency
    });
    claimToken = claim.claimToken;

    if (!claim.acquired) {
      if (claim.status === 'succeeded') {
        // Return stored result on duplicate dispatch without re-calling adapter
        return claim.result || { ok: true, idempotencyReused: true, providerReceipt: claim.providerReceipt };
      }
      if (claim.status === 'indeterminate') {
        throw Object.assign(new Error(`Action ${actionHash} for node ${node.id} is in indeterminate state`), {
          code: 'ACTION_INDETERMINATE',
          retryable: false
        });
      }
      if (claim.status === 'in_progress') {
        throw Object.assign(new Error(`Action ${actionHash} for node ${node.id} is already in progress`), {
          code: 'ACTION_ALREADY_IN_PROGRESS',
          retryable: true
        });
      }
      throw Object.assign(new Error(`Failed to claim action receipt for node ${node.id}`), {
        code: 'ACTION_CLAIM_FAILED',
        retryable: true
      });
    }
  }

  // Resolve provider secret if needed
  let secret = invocation.secret;
  if (!secret && secretResolver) {
    secret = await secretResolver.resolve(invocation.secretRef || `tenant_${tenantId}_${providerKey}`).catch(() => null);
  }

  // Verify authoritative consent
  const channel = adapter.channel || (providerKey.startsWith('email') ? 'email' : (providerKey.startsWith('sms') ? 'sms' : (providerKey.startsWith('whatsapp') ? 'whatsapp' : null)));
  let structuredConsent = null;
  if (channel) {
    const contactId = context?.contactId || context?.contact?.id || context?.to || context?.phone || context?.email;
    const purpose = invocation.purpose || context?.purpose || 'transactional';
    structuredConsent = await verifyAuthoritativeConsent({
      pool,
      tenantId,
      locationId: locId,
      contactId,
      channel,
      purpose,
      suppliedConsent: typeof context?.consent === 'object' ? context.consent : null
    });

    if (!structuredConsent) {
      if (outboxRepo && pool) {
        await outboxRepo.failActionReceipt({
          tenantId,
          locationId: locId,
          actionHash,
          claimToken,
          errorCode: 'CONSENT_REQUIRED',
          indeterminate: false,
          outcomeDetails: { channel, contactId }
        }).catch(() => {});
      }
      throw new PermanentJobError(`Communication consent missing or revoked for contact ${contactId} on ${channel}`, 'CONSENT_REQUIRED');
    }
  }

  // Dispatch to remote provider
  let dispatchRes;
  let dispatchErr = null;
  try {
    dispatchRes = await adapter.dispatch({
      secret,
      config: node.config,
      payload: context,
      consent: structuredConsent,
      tenantId,
      locationId: locId,
      actionHash,
      signal
    });
  } catch (err) {
    dispatchErr = err;
  }

  if (dispatchErr) {
    const isTimeout = dispatchErr.name === 'TimeoutError' || dispatchErr.name === 'AbortError' || /timeout|aborted/i.test(dispatchErr.message || '');
    const isIndeterminate = dispatchErr.indeterminate === true || isTimeout;
    const errorCode = isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : (dispatchErr.code || 'PROVIDER_DISPATCH_FAILED');
    if (outboxRepo && pool) {
      await outboxRepo.failActionReceipt({
        tenantId,
        locationId: locId,
        actionHash,
        claimToken,
        errorCode,
        indeterminate: isIndeterminate,
        outcomeDetails: { message: dispatchErr.message }
      }).catch(() => {});
    }
    throw dispatchErr;
  }

  if (!dispatchRes.ok) {
    const isTimeout = dispatchRes.code === 'PROVIDER_TIMEOUT_INDETERMINATE';
    const isIndeterminate = dispatchRes.indeterminate === true || isTimeout;
    if (outboxRepo && pool) {
      await outboxRepo.failActionReceipt({
        tenantId,
        locationId: locId,
        actionHash,
        claimToken,
        errorCode: dispatchRes.code || 'PROVIDER_DISPATCH_REJECTED',
        indeterminate: isIndeterminate,
        outcomeDetails: { code: dispatchRes.code, status: dispatchRes.status || dispatchRes.httpStatus }
      }).catch(() => {});
    }
    throw Object.assign(new Error(`Provider dispatch rejected: ${dispatchRes.code}`), {
      code: dispatchRes.code || 'PROVIDER_DISPATCH_FAILED',
      indeterminate: isIndeterminate
    });
  }

  // Succeeded: complete action receipt
  if (outboxRepo && pool) {
    const safeResult = {
      ok: true,
      provider: dispatchRes.provider || providerKey,
      providerMessageId: dispatchRes.providerMessageId || dispatchRes.sid || dispatchRes.id || null,
      httpStatus: dispatchRes.httpStatus || 200,
      idempotencyKey: actionHash
    };
    await outboxRepo.completeActionReceipt({
      tenantId,
      locationId: locId,
      actionHash,
      claimToken,
      result: safeResult,
      providerReceipt: safeResult.providerMessageId,
      outcomeDetails: { providerKey, nodeId: node.id }
    });
  }

  return dispatchRes;
}

export function createRealCrmActions({
  pool,
  tenantId,
  locationId,
  executionId,
  workflowId,
  actorId,
  workerId,
  mode = 'live',
  outboxRepository,
  providerRegistry,
  secretResolver,
  payload
}) {
  const outboxRepo = outboxRepository || (pool ? createWorkflowOutboxRepository(pool) : null);
  const locId = locationId || tenantId;

  return {
    sendEmail: async ({ to, subject, body, text, html }) => {
      const adapter = providerRegistry?.get('email.resend') || providerRegistry?.get('email.sendgrid');
      if (adapter) {
        const secret = secretResolver ? await secretResolver.resolve(`tenant_${tenantId}_email`).catch(() => null) : null;
        const structuredConsent = await verifyAuthoritativeConsent({
          pool,
          tenantId,
          locationId: locId,
          contactId: to,
          channel: 'email',
          purpose: 'transactional',
          suppliedConsent: typeof payload?.consent === 'object' ? payload.consent : null
        });
        if (!structuredConsent) {
          throw new PermanentJobError(`Communication consent missing or revoked for ${to} on email`, 'CONSENT_REQUIRED');
        }
        return adapter.dispatch({
          secret,
          config: { senderEmail: 'notifications@operza.io', senderName: 'Operza Automation' },
          payload: { to, subject, text: text || body, html },
          consent: structuredConsent,
          tenantId,
          locationId: locId
        });
      }
    },
    sendSms: async ({ to, message, body }) => {
      const adapter = providerRegistry?.get('sms.twilio');
      if (adapter) {
        const secret = secretResolver ? await secretResolver.resolve(`tenant_${tenantId}_sms`).catch(() => null) : null;
        const structuredConsent = await verifyAuthoritativeConsent({
          pool,
          tenantId,
          locationId: locId,
          contactId: to,
          channel: 'sms',
          purpose: 'transactional',
          suppliedConsent: typeof payload?.consent === 'object' ? payload.consent : null
        });
        if (!structuredConsent) {
          throw new PermanentJobError(`Communication consent missing or revoked for ${to} on sms`, 'CONSENT_REQUIRED');
        }
        return adapter.dispatch({
          secret,
          config: { accountId: 'AC00000000000000000000000000000000', fromNumber: '+15005550006' },
          payload: { to, body: message || body },
          consent: structuredConsent,
          tenantId,
          locationId: locId
        });
      }
    },
    addContactTag: async ({ contactId, tag, nodeId }) => {
      if (!contactId || !tag) throw Object.assign(new Error('contactId and tag are required'), { code: 'INVALID_TAG_PARAMS' });
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'add_tag',
        actionType: 'add_tag',
        input: { contactId, tag },
        workerId,
        mode,
        mutationFn: async (client) => {
          if (!client) return { tagAdded: tag, contactId };
          const res = await client.query(
            'SELECT body FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4 FOR UPDATE',
            [tenantId, locId, 'contacts', contactId]
          );
          if (res.rows.length === 0) {
            throw Object.assign(new Error(`Contact ${contactId} not found in PostgreSQL`), { code: 'CONTACT_NOT_FOUND' });
          }
          const b = res.rows[0].body || {};
          b.tags = Array.from(new Set([...(b.tags || []), tag]));
          const updateRes = await client.query(
            'UPDATE location_records SET body = $1::jsonb, updated_at = now() WHERE agency_id = $2 AND location_id = $3 AND collection = $4 AND id = $5',
            [JSON.stringify(b), tenantId, locId, 'contacts', contactId]
          );
          if (updateRes.rowCount === 0) {
            throw Object.assign(new Error(`Failed to update tags for contact ${contactId}`), { code: 'CONTACT_UPDATE_FAILED' });
          }
          return { tagAdded: tag, contactId };
        }
      });
    },
    createTask: async (taskData) => {
      const { nodeId, ...taskPayload } = taskData || {};
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'create_task',
        actionType: 'create_task',
        input: taskPayload,
        workerId,
        mode,
        mutationFn: async (client) => {
          const taskId = crypto.randomUUID();
          const taskRecord = {
            id: taskId,
            agencyId: tenantId,
            locationId: locId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            ...taskPayload
          };
          if (!client) return taskRecord;
          const insertRes = await client.query(`
            INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
            VALUES ($1, $2, $3, 'tasks', $4::jsonb, now(), now())
          `, [taskId, tenantId, locId, JSON.stringify(taskRecord)]);
          if (insertRes.rowCount === 0) {
            throw Object.assign(new Error('Failed to insert task record in PostgreSQL'), { code: 'TASK_INSERT_FAILED' });
          }
          return taskRecord;
        }
      });
    },
    updateOpportunityStage: async ({ opportunityId, stage, stageId, nodeId }) => {
      if (!opportunityId) throw Object.assign(new Error('opportunityId is required'), { code: 'OPPORTUNITY_ID_REQUIRED' });
      const stageInput = { opportunityId, stage: stage || null };
      if (stageId !== undefined) stageInput.stageId = stageId;
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'update_stage',
        actionType: 'update_stage',
        input: stageInput,
        workerId,
        mode,
        mutationFn: async (client) => {
          if (!client) return { opportunityId, stageUpdated: stage || stageId };
          const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const validStageId = UUID_REGEX.test(stageId) ? stageId : (UUID_REGEX.test(stage) ? stage : null);
          const updateRes = await client.query(`
            UPDATE opportunities
            SET stage_id = COALESCE($1::uuid, stage_id), status = COALESCE($2, status), updated_at = now()
            WHERE agency_id = $3 AND location_id = $4 AND id = $5
            RETURNING id
          `, [validStageId, stage || null, tenantId, locId, opportunityId]);
          if (updateRes.rowCount === 0) {
            // Also check location_records collection 'opportunities'
            const locUpdate = await client.query(`
              SELECT body FROM location_records
              WHERE agency_id = $1 AND location_id = $2 AND collection = 'opportunities' AND id = $3
              FOR UPDATE
            `, [tenantId, locId, opportunityId]);
            if (locUpdate.rows.length === 0) {
              throw Object.assign(new Error(`Opportunity ${opportunityId} not found in PostgreSQL`), { code: 'OPPORTUNITY_NOT_FOUND' });
            }
            const b = locUpdate.rows[0].body || {};
            b.stage = stage || b.stage;
            b.stageId = stageId || b.stageId;
            b.status = stage || b.status;
            await client.query(`
              UPDATE location_records SET body = $1::jsonb, updated_at = now()
              WHERE agency_id = $2 AND location_id = $3 AND collection = 'opportunities' AND id = $4
            `, [JSON.stringify(b), tenantId, locId, opportunityId]);
          }
          return { opportunityId, stageUpdated: stage || stageId };
        }
      });
    },
    updateContact: async ({ contactId, fields, nodeId }) => {
      if (!contactId) throw Object.assign(new Error('contactId is required'), { code: 'CONTACT_ID_REQUIRED' });
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'update_contact',
        actionType: 'update_contact',
        input: { contactId, fields: fields || {} },
        workerId,
        mode,
        mutationFn: async (client) => {
          if (!client) return { contactUpdated: contactId, fields };
          const res = await client.query(
            'SELECT body FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4 FOR UPDATE',
            [tenantId, locId, 'contacts', contactId]
          );
          if (res.rows.length === 0) {
            throw Object.assign(new Error(`Contact ${contactId} not found in PostgreSQL`), { code: 'CONTACT_NOT_FOUND' });
          }
          const b = res.rows[0].body || {};
          Object.assign(b, fields || {});
          const updateRes = await client.query(
            'UPDATE location_records SET body = $1::jsonb, updated_at = now() WHERE agency_id = $2 AND location_id = $3 AND collection = $4 AND id = $5',
            [JSON.stringify(b), tenantId, locId, 'contacts', contactId]
          );
          if (updateRes.rowCount === 0) {
            throw Object.assign(new Error(`Failed to update contact ${contactId}`), { code: 'CONTACT_UPDATE_FAILED' });
          }
          return { contactUpdated: contactId, fields };
        }
      });
    },
    createOpportunity: async ({ contactId, name, value, stage, pipelineId, nodeId }) => {
      const oppPayload = { contactId, name: name || 'New Opportunity', value: Number(value) || 0, stage: stage || 'new', pipelineId: pipelineId || null };
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'create_opportunity',
        actionType: 'create_opportunity',
        input: oppPayload,
        workerId,
        mode,
        mutationFn: async (client) => {
          const oppId = crypto.randomUUID();
          const oppRecord = {
            id: oppId,
            agencyId: tenantId,
            locationId: locId,
            ...oppPayload,
            status: 'open',
            createdAt: new Date().toISOString()
          };
          if (!client) return oppRecord;
          const insertRes = await client.query(`
            INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
            VALUES ($1, $2, $3, 'opportunities', $4::jsonb, now(), now())
          `, [oppId, tenantId, locId, JSON.stringify(oppRecord)]);
          if (insertRes.rowCount === 0) {
            throw Object.assign(new Error('Failed to insert opportunity in PostgreSQL'), { code: 'OPPORTUNITY_INSERT_FAILED' });
          }
          return oppRecord;
        }
      });
    },
    assignContact: async ({ contactId, assignee, nodeId }) => {
      if (!contactId || !assignee) throw Object.assign(new Error('contactId and assignee are required'), { code: 'INVALID_ASSIGN_PARAMS' });
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'assign_to',
        actionType: 'assign_to',
        input: { contactId, assignee },
        workerId,
        mode,
        mutationFn: async (client) => {
          if (!client) return { assignedTo: assignee, contactId };
          const res = await client.query(
            'SELECT body FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4 FOR UPDATE',
            [tenantId, locId, 'contacts', contactId]
          );
          if (res.rows.length === 0) {
            throw Object.assign(new Error(`Contact ${contactId} not found in PostgreSQL`), { code: 'CONTACT_NOT_FOUND' });
          }
          const b = res.rows[0].body || {};
          b.assignedTo = assignee;
          b.ownerId = assignee;
          const updateRes = await client.query(
            'UPDATE location_records SET body = $1::jsonb, updated_at = now() WHERE agency_id = $2 AND location_id = $3 AND collection = $4 AND id = $5',
            [JSON.stringify(b), tenantId, locId, 'contacts', contactId]
          );
          if (updateRes.rowCount === 0) {
            throw Object.assign(new Error(`Failed to assign contact ${contactId}`), { code: 'CONTACT_ASSIGN_FAILED' });
          }
          return { assignedTo: assignee, contactId };
        }
      });
    },
    updateLeadScore: async ({ contactId, points, nodeId }) => {
      if (!contactId) throw Object.assign(new Error('contactId is required'), { code: 'CONTACT_ID_REQUIRED' });
      const pts = Number(points) || 10;
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'lead_score',
        actionType: 'lead_score',
        input: { contactId, points: pts },
        workerId,
        mode,
        mutationFn: async (client) => {
          if (!client) return { contactId, pointsAdded: pts };
          const res = await client.query(
            'SELECT body FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = $3 AND id = $4 FOR UPDATE',
            [tenantId, locId, 'contacts', contactId]
          );
          if (res.rows.length === 0) {
            throw Object.assign(new Error(`Contact ${contactId} not found in PostgreSQL`), { code: 'CONTACT_NOT_FOUND' });
          }
          const b = res.rows[0].body || {};
          b.leadScore = (Number(b.leadScore) || 0) + pts;
          const updateRes = await client.query(
            'UPDATE location_records SET body = $1::jsonb, updated_at = now() WHERE agency_id = $2 AND location_id = $3 AND collection = $4 AND id = $5',
            [JSON.stringify(b), tenantId, locId, 'contacts', contactId]
          );
          if (updateRes.rowCount === 0) {
            throw Object.assign(new Error(`Failed to update lead score for contact ${contactId}`), { code: 'LEAD_SCORE_UPDATE_FAILED' });
          }
          return { contactId, pointsAdded: pts, currentScore: b.leadScore };
        }
      });
    },
    sendInternalNotification: async ({ title, message, channel, nodeId }) => {
      const notifPayload = { title: title || 'Notification', message: message || '', channel: channel || 'in_app' };
      return executeAtomicCrmAction({
        pool,
        outboxRepo,
        tenantId,
        locationId: locId,
        executionId,
        workflowId,
        nodeId: nodeId || 'internal_notification',
        actionType: 'internal_notification',
        input: notifPayload,
        workerId,
        mode,
        mutationFn: async (client) => {
          const notifId = crypto.randomUUID();
          const notifRecord = {
            id: notifId,
            agencyId: tenantId,
            locationId: locId,
            ...notifPayload,
            read: false,
            createdAt: new Date().toISOString()
          };
          if (!client) return notifRecord;
          const insertRes = await client.query(`
            INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
            VALUES ($1, $2, $3, 'notifications', $4::jsonb, now(), now())
          `, [notifId, tenantId, locId, JSON.stringify(notifRecord)]);
          if (insertRes.rowCount === 0) {
            throw Object.assign(new Error('Failed to insert internal notification in PostgreSQL'), { code: 'NOTIFICATION_INSERT_FAILED' });
          }
          return notifRecord;
        }
      });
    }
  };
}

/**
 * Creates trusted allow-listed event handlers for the Operza Durable Outbox Worker,
 * with real PostgreSQL-backed workflow graph execution and registered provider adapters.
 */
export function createTrustedWorkerHandlers({
  pool = null,
  secretResolver = null,
  providerRegistry = createProviderAdapterRegistry(),
  customHandlers = {},
  outboxRepository = null
} = {}) {
  const handlers = {
    /**
     * Executes a workflow graph persistently in the PostgreSQL-backed worker.
     */
    'workflow.trigger.enqueued': async (payload, { job, workerId, lease }) => {
      const tenantId = payload?.tenantId || payload?.agencyId;
      const locationId = payload?.locationId;
      const workflowId = payload?.workflowId;

      if (!tenantId || !workflowId) {
        throw new PermanentJobError('Payload missing required tenantId or workflowId', 'INVALID_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      const rawExecId = payload.executionId || payload.data?.executionId || (job?.executionId) || crypto.randomUUID();
      const executionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawExecId)
        ? rawExecId
        : crypto.randomUUID();
      const triggerContext = payload.triggerContext || payload.context || payload.data || {};
      const mode = payload.mode || 'live';

      let flow = payload.flow || payload.workflowSnapshot || null;

      // 1. Load authoritative workflow definition from PostgreSQL if pool is available
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );

          // Check if execution already exists in DB (e.g. pre-initialized by API)
          const existingExecRes = await client.query(`
            SELECT id, workflow_version, workflow_snapshot, status
            FROM workflow_executions
            WHERE agency_id = $1 AND location_id = $2 AND id = $3
            FOR UPDATE
          `, [tenantId, locationId || tenantId, executionId]);

          if (existingExecRes.rows.length > 0 && existingExecRes.rows[0].workflow_snapshot) {
            const existingSnapshot = typeof existingExecRes.rows[0].workflow_snapshot === 'string'
              ? JSON.parse(existingExecRes.rows[0].workflow_snapshot)
              : existingExecRes.rows[0].workflow_snapshot;
            flow = existingSnapshot;
          }

          if (!flow) {
            const defRes = await client.query(
              'SELECT id, agency_id, location_id, name, status, trigger_type, trigger_config, nodes, version FROM workflow_definitions WHERE agency_id = $1 AND id = $2',
              [tenantId, workflowId]
            );
            if (defRes.rows.length > 0) {
              const row = defRes.rows[0];
              flow = {
                id: row.id,
                name: row.name,
                status: row.status,
                triggerType: row.trigger_type,
                triggerConfig: row.trigger_config,
                nodes: typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes,
                version: row.version
              };
            }
          }

          if (!flow) {
            await client.query('ROLLBACK').catch(() => {});
            throw new PermanentJobError(`Workflow definition ${workflowId} not found in database`, 'WORKFLOW_NOT_FOUND');
          }

          const flowVersion = Number.isInteger(flow.version) && flow.version > 0 ? flow.version : 1;
          const cleanSnapshot = {
            id: flow.id,
            name: flow.name || 'Untitled Workflow',
            version: flowVersion,
            triggerType: flow.triggerType || flow.trigger_type || 'manual',
            triggerConfig: flow.triggerConfig || flow.trigger_config || {},
            nodes: Array.isArray(flow.nodes) ? flow.nodes.map(n => {
              const cleanNode = { ...n };
              if (cleanNode.config) {
                cleanNode.config = { ...cleanNode.config };
                delete cleanNode.config.apiKey;
                delete cleanNode.config.secret;
                delete cleanNode.config.token;
                delete cleanNode.config.password;
              }
              return cleanNode;
            }) : []
          };

          // Initialize execution in PostgreSQL with pinned version and snapshot
          await client.query(`
            INSERT INTO workflow_executions (
              id, agency_id, location_id, workflow_id, status, trigger_event,
              workflow_version, workflow_snapshot,
              worker_lease_id, heartbeat_at, attempts, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'running', $5::jsonb, $6, $7::jsonb, $8, now(), 1, now(), now())
            ON CONFLICT (agency_id, location_id, id) DO UPDATE SET
              status = 'running', worker_lease_id = EXCLUDED.worker_lease_id,
              heartbeat_at = now(), updated_at = now(),
              workflow_version = COALESCE(workflow_executions.workflow_version, EXCLUDED.workflow_version),
              workflow_snapshot = COALESCE(workflow_executions.workflow_snapshot, EXCLUDED.workflow_snapshot)
          `, [executionId, tenantId, locationId || tenantId, workflowId, JSON.stringify(triggerContext), flowVersion, JSON.stringify(cleanSnapshot), workerId]);
          await client.query('COMMIT');
        } catch (dbErr) {
          await client.query('ROLLBACK').catch(() => {});
          if (dbErr instanceof PermanentJobError) throw dbErr;
          throw Object.assign(new Error(`Failed to initialize workflow execution in PostgreSQL: ${dbErr.message}`), {
            code: 'WORKFLOW_DB_INIT_FAILED'
          });
        } finally {
          client.release();
        }
      }

      if (!flow) {
        flow = { id: workflowId, name: 'Default Flow', nodes: payload.nodes || [] };
      }

      const effectiveOutboxRepo = outboxRepository || (pool ? createWorkflowOutboxRepository(pool) : null);
      const effectiveActorId = payload.actorId || payload.data?.actorId || payload.context?.actorId || 'system_worker';

      // Real CRM Actions connected to PostgreSQL location_records and opportunities
      const realCrmActions = createRealCrmActions({
        pool,
        tenantId,
        locationId: locationId || tenantId,
        executionId,
        workflowId,
        actorId: effectiveActorId,
        workerId,
        mode,
        outboxRepository: effectiveOutboxRepo,
        payload,
        providerRegistry,
        secretResolver
      });

      // 2. Build Execution Dependencies & Provider Executor
      const deps = {
        execution: {
          id: executionId,
          agencyId: tenantId,
          locationId: locationId || tenantId,
          workflowId,
          actorId: effectiveActorId,
          mode,
          consent: typeof payload.consent === 'object' && payload.consent?.status === 'granted',
          approvedNodeId: payload.approvedNodeId || null,
          approvalEvidence: payload.approvalEvidence || null
        },
        crmActions: payload.crmActions || realCrmActions,
        providerExecutor: async ({ invocation, node, context, signal }) => {
          return executeDurableProviderAction({
            pool,
            outboxRepo: effectiveOutboxRepo,
            tenantId,
            locationId: locationId || tenantId,
            executionId,
            node,
            invocation,
            context,
            mode,
            providerRegistry,
            secretResolver,
            workerId,
            signal
          });
        }
      };

      // 3. Walk the Workflow Graph Deterministically
      const graphResult = await walkGraph(flow.nodes || [], triggerContext, null, deps);

      // 4. Update Execution State in PostgreSQL
      if (pool) {
        const persistClient = await pool.connect();
        try {
          await persistClient.query('BEGIN');
          await persistClient.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );

          if (graphResult.finalStatus === 'waiting_approval') {
            const pausedStep = graphResult.timeline.find(t => t.status === 'waiting_approval');
            const pausedNodeId = pausedStep?.nodeId || 'unknown_node';
            const actionHash = sha256({ tenantId, executionId, nodeId: pausedNodeId });
            const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

            // Record pending approval
            await persistClient.query(`
              INSERT INTO workflow_approvals (
                id, agency_id, location_id, execution_id, workflow_id, node_id,
                action_id, action_hash, status, requested_at, expires_at, request_checksum
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now(), $9, $10)
              ON CONFLICT (agency_id, location_id, execution_id, node_id) WHERE status = 'pending' DO NOTHING
            `, [
              crypto.randomUUID(), tenantId, locationId || tenantId, executionId,
              workflowId, pausedNodeId, pausedNodeId, actionHash, expiresAt, actionHash
            ]);

            // Update execution to waiting_approval
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'waiting_approval', current_node_id = $2, wait_type = 'approval',
                state = $3::jsonb, updated_at = now()
              WHERE agency_id = $4 AND location_id = $5 AND id = $1
            `, [executionId, pausedNodeId, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          } else if (graphResult.finalStatus === 'waiting') {
            const waitingStep = graphResult.waitingStep || graphResult.timeline.find(t => t.status === 'waiting');
            const waitingNodeId = waitingStep?.nodeId || 'unknown_node';
            const retryAt = waitingStep?.retryAt || waitingStep?.result?.retryAt || new Date(Date.now() + 60000).toISOString();
            const resumeNodeId = graphResult.resumeNodeId || waitingStep?.resumeNodeId || null;
            const waitGeneration = 1;

            // Atomically update execution to waiting
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'waiting',
                current_node_id = $2,
                resume_node_id = $3,
                retry_at = $4::timestamptz,
                wait_generation = $5,
                wait_type = 'timed',
                state = $6::jsonb,
                updated_at = now()
              WHERE agency_id = $7 AND location_id = $8 AND id = $1
            `, [executionId, waitingNodeId, resumeNodeId, retryAt, waitGeneration, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);

            // Enqueue workflow.wait.resume into workflow_outbox within the SAME transaction
            const idemKey = `idem_${sha256([tenantId, locationId || tenantId, 'workflow_wait_resume', `${executionId}_${waitingNodeId}_gen_${waitGeneration}`])}`;
            const outboxPayload = {
              tenantId,
              locationId: locationId || tenantId,
              workflowId,
              executionId,
              waitNodeId: waitingNodeId,
              resumeNodeId,
              resumeGeneration: waitGeneration,
              correlationId: payload.correlationId || `corr_${crypto.randomUUID()}`,
              enqueuedAt: new Date().toISOString()
            };

            await persistClient.query(`
              INSERT INTO workflow_outbox (
                id, agency_id, location_id, execution_id, event_type, payload,
                idempotency_key, priority, max_attempts, available_at
              ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, $7::timestamptz)
              ON CONFLICT (agency_id, location_id, idempotency_key) DO NOTHING
            `, [crypto.randomUUID(), tenantId, locationId || tenantId, executionId, JSON.stringify(outboxPayload), idemKey, retryAt]);
          } else if (graphResult.finalStatus === 'waiting_webhook') {
            const webhookStep = graphResult.waitingStep || graphResult.timeline.find(t => t.status === 'waiting_webhook');
            const webhookNodeId = webhookStep?.nodeId || 'unknown_node';
            const resumeNodeId = graphResult.resumeNodeId || webhookStep?.resumeNodeId || null;
            const resumeToken = webhookStep?.resumeToken || webhookStep?.result?.resumeToken || null;
            const expiresAt = webhookStep?.expiresAt || webhookStep?.result?.expiresAt || null;

            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'waiting_webhook',
                current_node_id = $2,
                resume_node_id = $3,
                wait_type = 'webhook',
                resume_token = $4,
                retry_at = $5::timestamptz,
                state = $6::jsonb,
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                updated_at = now()
              WHERE agency_id = $7 AND location_id = $8 AND id = $1
            `, [executionId, webhookNodeId, resumeNodeId, resumeToken, expiresAt, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          } else if (graphResult.finalStatus === 'completed') {
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'completed', current_node_id = NULL, resume_node_id = NULL, wait_type = NULL, retry_at = NULL,
                resume_token = NULL, resume_lease_owner = NULL, resume_lease_until = NULL, resume_started_at = NULL,
                finished_at = now(), state = $2::jsonb, updated_at = now()
              WHERE agency_id = $3 AND location_id = $4 AND id = $1
            `, [executionId, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          } else if (graphResult.finalStatus === 'failed') {
            const failedStep = graphResult.timeline.find(t => t.status === 'failed');
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'failed', last_error_code = $2, finished_at = now(),
                resume_lease_owner = NULL, resume_lease_until = NULL, resume_started_at = NULL,
                state = $3::jsonb, updated_at = now()
              WHERE agency_id = $4 AND location_id = $5 AND id = $1
            `, [executionId, failedStep?.error || 'FAILED', JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          } else {
            // Unknown outcome — fail closed!
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'failed', last_error_code = 'UNKNOWN_WORKFLOW_OUTCOME', finished_at = now(),
                resume_lease_owner = NULL, resume_lease_until = NULL, resume_started_at = NULL,
                state = $2::jsonb, updated_at = now()
              WHERE agency_id = $3 AND location_id = $4 AND id = $1
            `, [executionId, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          }

          // Persist each step into workflow_execution_steps
          for (const step of graphResult.timeline) {
            const stepStatus = ['running', 'completed', 'failed', 'waiting', 'waiting_approval', 'waiting_webhook', 'skipped'].includes(step.status)
              ? step.status
              : (step.status === 'simulated' ? 'completed' : 'completed');
            await persistClient.query(`
              INSERT INTO workflow_execution_steps (
                id, agency_id, location_id, execution_id, node_id, attempt,
                status, details, error_code, started_at, finished_at
              ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7::jsonb, $8, $9, $10)
              ON CONFLICT (agency_id, location_id, id) DO NOTHING
            `, [
              crypto.randomUUID(), tenantId, locationId || tenantId, executionId,
              step.nodeId, stepStatus, JSON.stringify(step.result || {}),
              step.error || null, step.startedAt, step.finishedAt
            ]);
          }
          await persistClient.query('COMMIT');
        } catch (pgErr) {
          await persistClient.query('ROLLBACK').catch(() => {});
          throw Object.assign(new Error(`Failed to update execution steps in PostgreSQL: ${pgErr.message}`), {
            code: 'WORKFLOW_STEP_PERSIST_FAILED'
          });
        } finally {
          persistClient.release();
        }
      }

      if (!pool && outboxRepository && graphResult.finalStatus === 'waiting') {
        const waitingStep = graphResult.waitingStep || graphResult.timeline.find(t => t.status === 'waiting');
        const waitingNodeId = waitingStep?.nodeId || 'unknown_node';
        const retryAt = waitingStep?.retryAt || waitingStep?.result?.retryAt || new Date(Date.now() + 60000).toISOString();
        const resumeNodeId = graphResult.resumeNodeId || waitingStep?.resumeNodeId || null;
        const waitGeneration = 1;
        const idemKey = `idem_${sha256([tenantId, locationId || tenantId, 'workflow_wait_resume', `${executionId}_${waitingNodeId}_gen_${waitGeneration}`])}`;
        await outboxRepository.enqueue({
          tenantId,
          locationId: locationId || tenantId,
          executionId,
          eventType: 'workflow.wait.resume',
          idempotencyKey: idemKey,
          availableAt: retryAt,
          payload: {
            tenantId,
            locationId: locationId || tenantId,
            workflowId,
            executionId,
            waitNodeId: waitingNodeId,
            resumeNodeId,
            resumeGeneration: waitGeneration,
            correlationId: payload.correlationId || `corr_${crypto.randomUUID()}`,
            enqueuedAt: new Date().toISOString()
          }
        });
      }

      if (graphResult.finalStatus === 'failed') {
        const failedStep = graphResult.timeline.find(t => t.status === 'failed');
        throw Object.assign(new Error(`Workflow execution failed: ${failedStep?.error || 'WORKFLOW_FAILED'}`), {
          code: failedStep?.error || 'WORKFLOW_EXECUTION_FAILED',
          retryable: false
        });
      }

      return {
        status: graphResult.finalStatus,
        executionId,
        stepsExecuted: graphResult.timeline.length,
        timeline: graphResult.timeline,
        workerId,
        processedAt: new Date().toISOString()
      };
    },

    /**
     * Resumes an approval-paused workflow execution from its exact pinned node.
     */
    'workflow.step.resume': async (payload, { job, workerId, lease }) => {
      const tenantId = payload?.tenantId || payload?.agencyId;
      const locationId = payload?.locationId;
      const executionId = payload?.executionId;
      const nodeId = payload?.nodeId;

      if (!tenantId || !executionId || !nodeId) {
        throw new PermanentJobError('Payload missing required resume references', 'INVALID_RESUME_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      let flow = payload.flow || payload.workflowSnapshot || null;
      let existingExecution = null;

      if (pool) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );

          // 1. Verify that approval was actually granted
          const appRes = await client.query(
            'SELECT status, decided_at, decided_by FROM workflow_approvals WHERE agency_id = $1 AND execution_id = $2 AND node_id = $3',
            [tenantId, executionId, nodeId]
          );
          if (appRes.rows.length === 0 || appRes.rows[0].status !== 'approved') {
            await client.query('ROLLBACK').catch(() => {});
            throw new PermanentJobError('Execution node has not been approved in workflow_approvals', 'RESUME_NOT_APPROVED');
          }

          // 2. Load execution record
          const execRes = await client.query(
            'SELECT * FROM workflow_executions WHERE agency_id = $1 AND id = $2',
            [tenantId, executionId]
          );
          if (execRes.rows.length === 0) {
            await client.query('ROLLBACK').catch(() => {});
            throw new PermanentJobError(`Execution ${executionId} not found`, 'EXECUTION_NOT_FOUND');
          }
          existingExecution = execRes.rows[0];

          // 3. Load workflow definition if not passed
          if (!flow && existingExecution.workflow_id) {
            const defRes = await client.query(
              'SELECT nodes, name FROM workflow_definitions WHERE agency_id = $1 AND id = $2',
              [tenantId, existingExecution.workflow_id]
            );
            if (defRes.rows.length > 0) {
              flow = {
                id: existingExecution.workflow_id,
                name: defRes.rows[0].name,
                nodes: typeof defRes.rows[0].nodes === 'string' ? JSON.parse(defRes.rows[0].nodes) : defRes.rows[0].nodes
              };
            }
          }
          await client.query('COMMIT');
        } catch (dbErr) {
          await client.query('ROLLBACK').catch(() => {});
          if (dbErr instanceof PermanentJobError) throw dbErr;
          throw Object.assign(new Error(`Failed to lookup workflow resume data in PostgreSQL: ${dbErr.message}`), {
            code: 'WORKFLOW_RESUME_LOOKUP_FAILED'
          });
        } finally {
          client.release();
        }
      }

      const allNodes = flow?.nodes || payload.nodes || [];
      const nodeIndex = allNodes.findIndex(n => n.id === nodeId);
      const remainingNodes = nodeIndex >= 0 ? allNodes.slice(nodeIndex) : allNodes;

      const restoredVariables = existingExecution?.state || payload.state || {};
      const triggerContext = existingExecution?.trigger_event || payload.triggerContext || {};

      const effectiveOutboxRepo = outboxRepository || (pool ? createWorkflowOutboxRepository(pool) : null);
      const effectiveActorId = payload.actorId || payload.data?.actorId || existingExecution?.trigger_event?.actorId || 'system_worker';
      const mode = payload.mode || 'live';

      const realCrmActions = createRealCrmActions({
        pool,
        tenantId,
        locationId: locationId || tenantId,
        executionId,
        workflowId: existingExecution?.workflow_id || payload.workflowId,
        actorId: effectiveActorId,
        workerId,
        mode,
        outboxRepository: effectiveOutboxRepo,
        payload,
        providerRegistry,
        secretResolver
      });

      const deps = {
        execution: {
          id: executionId,
          agencyId: tenantId,
          locationId: locationId || tenantId,
          workflowId: existingExecution?.workflow_id || payload.workflowId,
          actorId: effectiveActorId,
          mode,
          approvedNodeId: nodeId,
          approvalEvidence: payload.evidence || { approvedAt: new Date().toISOString() }
        },
        crmActions: payload.crmActions || realCrmActions,
        providerExecutor: async ({ invocation, node, context, signal }) => {
          return executeDurableProviderAction({
            pool,
            outboxRepo: effectiveOutboxRepo,
            tenantId,
            locationId: locationId || tenantId,
            executionId,
            node,
            invocation,
            context,
            mode,
            providerRegistry,
            secretResolver,
            workerId,
            signal
          });
        }
      };

      // Continue graph walk starting from the approved node
      const resumeResult = await walkGraph(remainingNodes, { ...triggerContext, ...restoredVariables }, null, deps);

      if (resumeResult.finalStatus === 'failed') {
        const failedStep = resumeResult.timeline.find(t => t.status === 'failed');
        throw Object.assign(new Error(`Workflow resume failed: ${failedStep?.error || 'WORKFLOW_RESUME_FAILED'}`), {
          code: failedStep?.error || 'WORKFLOW_RESUME_FAILED',
          retryable: false
        });
      }

      if (pool) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );

          const finalStatus = resumeResult.finalStatus === 'completed' ? 'completed' : (resumeResult.finalStatus === 'failed' ? 'failed' : 'waiting_approval');
          await client.query(`
            UPDATE workflow_executions SET
              status = $2, finished_at = CASE WHEN $2 IN ('completed', 'failed') THEN now() ELSE finished_at END,
              state = $3::jsonb, updated_at = now()
            WHERE agency_id = $4 AND id = $1
          `, [executionId, finalStatus, JSON.stringify(resumeResult.variables || {}), tenantId]);

          for (const step of resumeResult.timeline) {
            const stepStatus = ['running', 'completed', 'failed', 'waiting_approval', 'skipped'].includes(step.status)
              ? step.status
              : (step.status === 'simulated' ? 'completed' : 'completed');
            await client.query(`
              INSERT INTO workflow_execution_steps (
                id, agency_id, location_id, execution_id, node_id, attempt,
                status, details, error_code, started_at, finished_at
              ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7::jsonb, $8, $9, $10)
              ON CONFLICT (agency_id, location_id, id) DO NOTHING
            `, [
              crypto.randomUUID(), tenantId, locationId || tenantId, executionId,
              step.nodeId, stepStatus, JSON.stringify(step.result || {}),
              step.error || null, step.startedAt, step.finishedAt
            ]);
          }
          await client.query('COMMIT');
        } catch (pgErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw Object.assign(new Error(`Failed to persist workflow resume steps in PostgreSQL: ${pgErr.message}`), {
            code: 'WORKFLOW_RESUME_PERSIST_FAILED'
          });
        } finally {
          client.release();
        }
      }

      return {
        status: 'resumed',
        executionId,
        nodeId,
        finalStatus: resumeResult.finalStatus,
        stepsExecuted: resumeResult.timeline.length,
        workerId,
        resumedAt: new Date().toISOString()
      };
    },

    /**
     * Resumes a wait/delay-paused workflow execution from the node immediately following the wait node.
     * Enforces lease-based execution ownership, atomic continuation state transitions,
     * pinned snapshot preservation, and expired-lease recovery.
     */
    'workflow.wait.resume': async (payload, { job, workerId, lease }) => {
      const tenantId = payload?.tenantId || payload?.agencyId;
      const locationId = payload?.locationId;
      const executionId = payload?.executionId;
      const waitNodeId = payload?.waitNodeId;
      const resumeGeneration = Number(payload?.resumeGeneration) || 0;
      const requestType = payload?.requestType || 'scheduled';
      let resumeNodeId = payload?.resumeNodeId;

      if (!tenantId || !executionId) {
        throw new PermanentJobError('Payload missing required wait resume references', 'INVALID_WAIT_RESUME_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      const effectiveWorkerId = workerId || `worker_${crypto.randomUUID()}`;
      const claimToken = `${effectiveWorkerId}_${crypto.randomUUID()}`;
      let flow = null;
      let existingExecution = null;
      let currentRecoveryEpoch = null;

      if (pool) {
        // -----------------------------------------------------------------
        // STAGE 1: Claim Resume Lease & Validate Authoritative DB State
        // -----------------------------------------------------------------
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );

          // 1. Lock and load execution record
          const execRes = await client.query(`
            SELECT id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
                   wait_generation, wait_type, retry_at, workflow_version, workflow_snapshot, state,
                   trigger_event, attempts, resume_lease_owner, resume_lease_until, recovery_epoch,
                   (clock_timestamp() < resume_lease_until) AS is_lease_active,
                   (clock_timestamp() >= retry_at) AS is_due
            FROM workflow_executions
            WHERE agency_id = $1 AND location_id = $2 AND id = $3
            FOR UPDATE
          `, [tenantId, locationId || tenantId, executionId]);

          if (execRes.rows.length === 0) {
            await client.query('ROLLBACK').catch(() => {});
            throw new PermanentJobError(`Execution ${executionId} not found`, 'EXECUTION_NOT_FOUND');
          }

          existingExecution = execRes.rows[0];

          // 2. Reject terminal or canceled executions
          if (['completed', 'failed', 'canceled', 'dead_letter'].includes(existingExecution.status)) {
            await client.query('ROLLBACK').catch(() => {});
            console.warn(`[WORKFLOW-RESUME] Stale continuation for terminal execution ${executionId} (${existingExecution.status})`);
            return {
              status: 'ignored_stale_state',
              executionId,
              currentStatus: existingExecution.status,
              message: `Execution is already terminal (${existingExecution.status})`
            };
          }

          // 3. Strict generation validation
          if (Number(existingExecution.wait_generation) !== resumeGeneration) {
            await client.query('ROLLBACK').catch(() => {});
            console.warn(`[WORKFLOW-RESUME] Stale generation for execution ${executionId} (expected: ${existingExecution.wait_generation}, received: ${resumeGeneration})`);
            return {
              status: 'ignored_stale_generation',
              executionId,
              expectedGeneration: existingExecution.wait_generation,
              receivedGeneration: resumeGeneration,
              message: `Wait generation mismatch (expected: ${existingExecution.wait_generation}, received: ${resumeGeneration})`
            };
          }

          // 4. Status & Lease verification
          let isRecovery = false;
          if (existingExecution.status === 'resuming') {
            if (existingExecution.is_lease_active) {
              await client.query('ROLLBACK').catch(() => {});
              console.warn(`[WORKFLOW-RESUME] Active lease conflict for execution ${executionId} held by ${existingExecution.resume_lease_owner}`);
              throw Object.assign(new Error(`Execution ${executionId} is currently resuming under active lease`), {
                code: 'RESUME_LEASE_ACTIVE_CONFLICT',
                retryable: true
              });
            }
            isRecovery = true;
            console.info(`[WORKFLOW-RESUME] Recovering expired resume lease for execution ${executionId} (previous owner: ${existingExecution.resume_lease_owner})`);
          } else if (existingExecution.status !== 'waiting') {
            await client.query('ROLLBACK').catch(() => {});
            console.warn(`[WORKFLOW-RESUME] Ignored resume for execution ${executionId} in non-waiting status "${existingExecution.status}"`);
            return {
              status: 'ignored_stale_state',
              executionId,
              currentStatus: existingExecution.status,
              message: `Execution is not in waiting state (current: ${existingExecution.status})`
            };
          }

          // 5. Workflow ID mismatch validation
          if (payload.workflowId && existingExecution.workflow_id && payload.workflowId !== existingExecution.workflow_id) {
            await client.query('ROLLBACK').catch(() => {});
            console.warn(`[WORKFLOW-RESUME] Mismatched workflow ID for execution ${executionId} (expected: ${existingExecution.workflow_id}, received: ${payload.workflowId})`);
            return {
              status: 'ignored_mismatched_workflow',
              executionId,
              expectedWorkflowId: existingExecution.workflow_id,
              receivedWorkflowId: payload.workflowId,
              message: `Workflow ID mismatch (expected: ${existingExecution.workflow_id}, received: ${payload.workflowId})`
            };
          }

          // 6. Node mismatch validation
          if (waitNodeId && existingExecution.current_node_id && waitNodeId !== existingExecution.current_node_id) {
            await client.query('ROLLBACK').catch(() => {});
            console.warn(`[WORKFLOW-RESUME] Mismatched wait node for execution ${executionId} (expected: ${existingExecution.current_node_id}, received: ${waitNodeId})`);
            return {
              status: 'ignored_mismatched_node',
              executionId,
              expectedNode: existingExecution.current_node_id,
              receivedNode: waitNodeId
            };
          }

          // 7. Resume node mismatch validation
          if (payload.resumeNodeId && existingExecution.resume_node_id && payload.resumeNodeId !== existingExecution.resume_node_id) {
            await client.query('ROLLBACK').catch(() => {});
            console.warn(`[WORKFLOW-RESUME] Mismatched resume node for execution ${executionId} (expected: ${existingExecution.resume_node_id}, received: ${payload.resumeNodeId})`);
            return {
              status: 'ignored_mismatched_resume_node',
              executionId,
              expectedResumeNode: existingExecution.resume_node_id,
              receivedResumeNode: payload.resumeNodeId,
              message: `Resume node mismatch (expected: ${existingExecution.resume_node_id}, received: ${payload.resumeNodeId})`
            };
          }

          // 8. Scheduled due time check (database time is authoritative)
          if (requestType !== 'manual' && requestType !== 'webhook' && !isRecovery) {
            if (existingExecution.retry_at && !existingExecution.is_due) {
              await client.query('ROLLBACK').catch(() => {});
              throw Object.assign(new Error(`Continuation for ${executionId} claimed before due time ${existingExecution.retry_at}`), {
                code: 'CONTINUATION_NOT_DUE',
                retryable: true
              });
            }
          }

          // 9. Load pinned immutable workflow snapshot
          if (existingExecution.workflow_snapshot) {
            try {
              flow = typeof existingExecution.workflow_snapshot === 'string'
                ? JSON.parse(existingExecution.workflow_snapshot)
                : existingExecution.workflow_snapshot;
            } catch (jsonErr) {
              flow = null;
            }
          }

          if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) {
            console.error(`[WORKFLOW-RESUME] Execution ${executionId} has missing or invalid pinned workflow snapshot`);
            await client.query(`
              UPDATE workflow_executions SET
                status = 'failed',
                last_error_code = 'INVALID_WORKFLOW_SNAPSHOT',
                finished_at = now(),
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                updated_at = now()
              WHERE agency_id = $1 AND location_id = $2 AND id = $3
            `, [tenantId, locationId || tenantId, executionId]);
            await client.query('COMMIT');
            throw new PermanentJobError(`Execution ${executionId} lacks valid pinned workflow snapshot`, 'INVALID_WORKFLOW_SNAPSHOT');
          }

          // Verify that snapshot version agrees with stored workflow_version
          if (existingExecution.workflow_version != null && flow.version != null && Number(existingExecution.workflow_version) !== Number(flow.version)) {
            console.error(`[WORKFLOW-RESUME] Execution ${executionId} workflow snapshot version (${flow.version}) conflicts with stored workflow_version (${existingExecution.workflow_version})`);
            await client.query(`
              UPDATE workflow_executions SET
                status = 'failed',
                last_error_code = 'INCONSISTENT_WORKFLOW_SNAPSHOT_VERSION',
                finished_at = now(),
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                updated_at = now()
              WHERE agency_id = $1 AND location_id = $2 AND id = $3
            `, [tenantId, locationId || tenantId, executionId]);
            await client.query('COMMIT');
            throw new PermanentJobError(`Execution ${executionId} has inconsistent snapshot version`, 'INCONSISTENT_WORKFLOW_SNAPSHOT_VERSION');
          }

          // 10. Claim resume lease (configurable duration, default 60s)
          const leaseDurationSeconds = Math.max(1, Number(payload?.leaseDurationSeconds) || Number(process.env.OPERZA_WORKFLOW_RESUME_LEASE_SECONDS) || 60);
          const claimRes = await client.query(`
            UPDATE workflow_executions SET
              status = 'resuming',
              resume_lease_owner = $1,
              resume_lease_until = clock_timestamp() + ($5 || ' seconds')::interval,
              resume_started_at = clock_timestamp(),
              recovery_epoch = CASE WHEN $6 = true THEN COALESCE(recovery_epoch, 0) + 1 ELSE COALESCE(recovery_epoch, 0) END,
              updated_at = clock_timestamp()
            WHERE agency_id = $2 AND location_id = $3 AND id = $4
              AND (status = 'waiting' OR status = 'resuming')
            RETURNING recovery_epoch
          `, [claimToken, tenantId, locationId || tenantId, executionId, String(leaseDurationSeconds), isRecovery]);

          if (claimRes.rowCount !== 1) {
            await client.query('ROLLBACK').catch(() => {});
            return {
              status: 'lease_lost',
              executionId,
              message: 'Failed to claim resume lease atomically (0 rows affected)'
            };
          }

          currentRecoveryEpoch = Number(claimRes.rows[0].recovery_epoch);

          // Authoritative resume position strictly from database execution record
          resumeNodeId = existingExecution.resume_node_id || null;

          await client.query('COMMIT');
          console.info(`[WORKFLOW-RESUME] Claimed lease for execution ${executionId} (token: ${claimToken}, recovery: ${isRecovery}, epoch: ${currentRecoveryEpoch}, duration: ${leaseDurationSeconds}s)`);
        } catch (dbErr) {
          await client.query('ROLLBACK').catch(() => {});
          if (dbErr instanceof PermanentJobError) throw dbErr;
          if (dbErr.code === 'RESUME_LEASE_ACTIVE_CONFLICT' || dbErr.code === 'CONTINUATION_NOT_DUE') {
            throw dbErr;
          }
          throw Object.assign(new Error(`Failed to claim resume lease in PostgreSQL: ${dbErr.message}`), {
            code: 'WORKFLOW_WAIT_LOOKUP_FAILED',
            retryable: true
          });
        } finally {
          client.release();
        }
      }

      // Memory fallback flow
      if (!flow) {
        flow = payload.flow || payload.workflowSnapshot || { id: payload.workflowId, nodes: payload.nodes || [] };
      }
      const allNodes = flow?.nodes || [];

      // If in PostgreSQL mode (pool exists), existingExecution.resume_node_id is strictly authoritative.
      // If persisted resume_node_id is explicitly NULL, do NOT reconstruct another resume node from waitNode.next!
      if (!pool && !resumeNodeId) {
        const waitNode = allNodes.find(n => n.id === waitNodeId);
        if (waitNode?.next) {
          resumeNodeId = Array.isArray(waitNode.next) ? waitNode.next[0] : waitNode.next;
        }
      }

      if (!resumeNodeId) {
        if (pool) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId || tenantId]);
            const completeRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'completed',
                current_node_id = NULL,
                resume_node_id = NULL,
                wait_type = NULL,
                retry_at = NULL,
                resume_token = NULL,
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                finished_at = clock_timestamp(),
                updated_at = clock_timestamp()
              WHERE agency_id = $1 AND location_id = $2 AND id = $3
                AND status = 'resuming'
                AND resume_lease_owner = $4
                AND ($5::int IS NULL OR recovery_epoch = $5::int)
                AND clock_timestamp() < resume_lease_until
              RETURNING id
            `, [tenantId, locationId || tenantId, executionId, claimToken, currentRecoveryEpoch]);

            if (completeRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              console.warn(`[WORKFLOW-RESUME] No-resume completion update affected ${completeRes.rowCount} rows for execution ${executionId}. Lease lost.`);
              return {
                status: 'lease_lost',
                executionId,
                message: 'Lease expired or ownership lost before completing execution with no resume node'
              };
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        }
        return {
          status: 'completed',
          executionId,
          message: 'No subsequent nodes after wait node; workflow completed'
        };
      }

      // -----------------------------------------------------------------
      // STAGE 2: Execute Graph Walk Outside DB Transaction with Heartbeat
      // -----------------------------------------------------------------
      const leaseDurationSeconds = Math.max(1, Number(payload?.leaseDurationSeconds) || Number(process.env.OPERZA_WORKFLOW_RESUME_LEASE_SECONDS) || 60);
      const heartbeatIntervalMs = Math.max(50, Number(payload?.heartbeatIntervalMs) || Number(process.env.OPERZA_WORKFLOW_RESUME_HEARTBEAT_MS) || Math.min(leaseDurationSeconds * 250, 15000));
      const abortController = new AbortController();
      let executionLeaseLost = false;
      let heartbeatTimer = null;
      let inFlightHeartbeat = null;
      let isStoppingHeartbeat = false;

      const performHeartbeatRenewal = async () => {
        if (executionLeaseLost || isStoppingHeartbeat || abortController.signal.aborted) {
          return;
        }
        let renewClient = null;
        try {
          renewClient = await pool.connect();
          await renewClient.query('BEGIN');
          await renewClient.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );
          const renewRes = await renewClient.query(`
            UPDATE workflow_executions SET
              resume_lease_until = clock_timestamp() + ($1 || ' seconds')::interval,
              updated_at = clock_timestamp()
            WHERE agency_id = $2 AND location_id = $3 AND id = $4
              AND status = 'resuming'
              AND resume_lease_owner = $5
              AND ($6::int IS NULL OR recovery_epoch = $6::int)
              AND clock_timestamp() < resume_lease_until
            RETURNING id
          `, [String(leaseDurationSeconds), tenantId, locationId || tenantId, executionId, claimToken, currentRecoveryEpoch]);

          if (renewRes.rowCount !== 1) {
            console.warn(`[WORKFLOW-RESUME] Heartbeat renewal affected ${renewRes.rowCount} rows for execution ${executionId}. Lease lost.`);
            await renewClient.query('ROLLBACK').catch(() => {});
            executionLeaseLost = true;
            abortController.abort();
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            return;
          }

          await renewClient.query('COMMIT');
        } catch (hbErr) {
          console.error(`[WORKFLOW-RESUME] Heartbeat error for execution ${executionId}:`, hbErr.message);
          if (renewClient) {
            await renewClient.query('ROLLBACK').catch(() => {});
          }
          executionLeaseLost = true;
          abortController.abort();
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        } finally {
          if (renewClient) {
            renewClient.release();
          }
        }
      };

      if (pool) {
        heartbeatTimer = setInterval(() => {
          if (executionLeaseLost || isStoppingHeartbeat || abortController.signal.aborted) {
            if (heartbeatTimer) {
              clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
            return;
          }
          if (!inFlightHeartbeat) {
            inFlightHeartbeat = performHeartbeatRenewal().finally(() => {
              inFlightHeartbeat = null;
            });
          }
        }, heartbeatIntervalMs);
        heartbeatTimer?.unref?.();
      }

      const restoredVariables = {
        ...(existingExecution?.state || payload.state || {}),
        ...(payload.callbackData ? { callbackData: payload.callbackData } : {})
      };
      const triggerContext = existingExecution?.trigger_event || payload.triggerContext || {};
      const effectiveOutboxRepo = outboxRepository || (pool ? createWorkflowOutboxRepository(pool) : null);
      const effectiveActorId = existingExecution?.trigger_event?.actorId || payload.actorId || 'system_worker';
      const resumeMode = payload.mode || 'live';

      const realCrmActions = createRealCrmActions({
        pool,
        tenantId,
        locationId: locationId || tenantId,
        executionId,
        workflowId: existingExecution?.workflow_id || payload.workflowId,
        actorId: effectiveActorId,
        workerId: effectiveWorkerId,
        mode: resumeMode,
        outboxRepository: effectiveOutboxRepo,
        payload,
        providerRegistry,
        secretResolver
      });

      const deps = {
        signal: abortController.signal,
        execution: {
          id: executionId,
          agencyId: tenantId,
          locationId: locationId || tenantId,
          workflowId: existingExecution?.workflow_id || payload.workflowId,
          actorId: effectiveActorId,
          mode: resumeMode,
          workflowVersion: existingExecution?.workflow_version || flow?.version || 1
        },
        initialVariables: restoredVariables,
        resumeNodeId,
        crmActions: payload.crmActions || realCrmActions,
        aiHandler: payload.aiHandler || (async () => ({ text: 'ok' })),
        providerExecutor: async ({ invocation, node, context, signal }) => {
          if (executionLeaseLost || abortController.signal.aborted || signal?.aborted) {
            throw Object.assign(new Error(`Execution ${executionId} aborted: resume lease lost`), {
              code: 'RESUME_LEASE_LOST',
              retryable: true
            });
          }
          return executeDurableProviderAction({
            pool,
            outboxRepo: effectiveOutboxRepo,
            tenantId,
            locationId: locationId || tenantId,
            executionId,
            node,
            invocation,
            context,
            mode: resumeMode,
            providerRegistry,
            secretResolver,
            workerId: effectiveWorkerId,
            signal: abortController.signal
          });
        }
      };

      let resumeResult;
      try {
        resumeResult = await walkGraph(allNodes, { ...triggerContext, ...restoredVariables }, null, deps);
      } catch (graphErr) {
        if (executionLeaseLost || graphErr?.code === 'RESUME_LEASE_LOST' || abortController.signal.aborted) {
          console.warn(`[WORKFLOW-RESUME] Graph walk aborted due to lease loss for ${executionId}`);
          return {
            status: 'lease_lost',
            executionId,
            message: 'Worker lost resume lease during graph walk'
          };
        }
        console.error(`[WORKFLOW-RESUME] Graph walk error on resume for ${executionId}:`, graphErr.message);
        resumeResult = {
          finalStatus: 'failed',
          variables: restoredVariables,
          timeline: [{ nodeId: resumeNodeId || waitNodeId, status: 'failed', error: graphErr.message }]
        };
      } finally {
        isStoppingHeartbeat = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (inFlightHeartbeat) {
          await inFlightHeartbeat.catch(() => {});
          inFlightHeartbeat = null;
        }
      }

      if (executionLeaseLost || abortController.signal.aborted) {
        return {
          status: 'lease_lost',
          executionId,
          message: 'Worker lost resume lease before persisting outcome'
        };
      }

      // -----------------------------------------------------------------
      // STAGE 3: Verify Lease Ownership & Persist Outcome Atomically
      // -----------------------------------------------------------------
      if (pool) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
            [tenantId, locationId || tenantId]
          );

          // Verify that this worker still owns the resume lease
          const leaseVerify = await client.query(`
            SELECT id, status, wait_generation, resume_lease_owner, recovery_epoch,
                   (clock_timestamp() < resume_lease_until) AS is_lease_valid
            FROM workflow_executions
            WHERE agency_id = $1 AND location_id = $2 AND id = $3
            FOR UPDATE
          `, [tenantId, locationId || tenantId, executionId]);

          if (leaseVerify.rows.length === 0) {
            await client.query('ROLLBACK').catch(() => {});
            return { status: 'lease_lost', executionId, message: 'Execution vanished before outcome persisted' };
          }

          const currentExec = leaseVerify.rows[0];
          const isOwner = currentExec.resume_lease_owner === claimToken;
          const isLeaseValid = currentExec.is_lease_valid;
          const isStatusResuming = currentExec.status === 'resuming';
          const isGenMatch = Number(currentExec.wait_generation) === resumeGeneration;
          const isEpochMatch = currentRecoveryEpoch == null || Number(currentExec.recovery_epoch) === currentRecoveryEpoch;

          if (!isOwner || !isLeaseValid || !isStatusResuming || !isGenMatch || !isEpochMatch) {
            await client.query('ROLLBACK').catch(() => {});
            console.error(`[WORKFLOW-RESUME] Lease lost for execution ${executionId} (owner: ${isOwner}, valid: ${isLeaseValid}, status: ${currentExec.status}, gen: ${currentExec.wait_generation}, epoch: ${isEpochMatch})`);
            return {
              status: 'lease_lost',
              executionId,
              message: 'Worker lost resume lease or lease expired before outcome was persisted'
            };
          }

          if (resumeResult.finalStatus === 'waiting') {
            // Chained wait: increment wait_generation and enqueue next continuation
            const nextWaitStep = resumeResult.waitingStep || resumeResult.timeline.find(t => t.status === 'waiting');
            const nextWaitNodeId = nextWaitStep?.nodeId || 'unknown_node';
            const nextRetryAt = nextWaitStep?.retryAt || nextWaitStep?.result?.retryAt || new Date(Date.now() + 60000).toISOString();
            const nextResumeNodeId = resumeResult.resumeNodeId || nextWaitStep?.resumeNodeId || null;
            const nextGeneration = resumeGeneration + 1;

            const updRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'waiting',
                current_node_id = $2,
                resume_node_id = $3,
                retry_at = $4::timestamptz,
                wait_generation = $5,
                wait_type = 'timed',
                state = $6::jsonb,
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                updated_at = clock_timestamp()
              WHERE agency_id = $7 AND location_id = $8 AND id = $1
                AND status = 'resuming'
                AND resume_lease_owner = $9
                AND ($10::int IS NULL OR recovery_epoch = $10::int)
                AND clock_timestamp() < resume_lease_until
            `, [executionId, nextWaitNodeId, nextResumeNodeId, nextRetryAt, nextGeneration, JSON.stringify(resumeResult.variables || {}), tenantId, locationId || tenantId, claimToken, currentRecoveryEpoch]);

            if (updRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
            }

            const nextIdemKey = `idem_${sha256([tenantId, locationId || tenantId, 'workflow_wait_resume', `${executionId}_${nextWaitNodeId}_gen_${nextGeneration}`])}`;
            const outboxId = crypto.randomUUID();
            const outboxPayload = {
              tenantId,
              locationId: locationId || tenantId,
              workflowId: existingExecution?.workflow_id || payload.workflowId,
              executionId,
              waitNodeId: nextWaitNodeId,
              resumeNodeId: nextResumeNodeId,
              resumeGeneration: nextGeneration,
              requestType: 'scheduled',
              correlationId: payload.correlationId || `corr_${crypto.randomUUID()}`,
              enqueuedAt: new Date().toISOString()
            };

            await client.query(`
              INSERT INTO workflow_outbox (
                id, agency_id, location_id, execution_id, event_type, payload,
                idempotency_key, priority, max_attempts, available_at
              ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, $7::timestamptz)
              ON CONFLICT (agency_id, location_id, idempotency_key) DO NOTHING
            `, [outboxId, tenantId, locationId || tenantId, executionId, JSON.stringify(outboxPayload), nextIdemKey, nextRetryAt]);

          } else if (resumeResult.finalStatus === 'waiting_approval') {
            const pausedStep = resumeResult.timeline.find(t => t.status === 'waiting_approval');
            const pausedNodeId = pausedStep?.nodeId || 'unknown_node';
            const actionHash = sha256({ tenantId, executionId, nodeId: pausedNodeId });
            const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

            await client.query(`
              INSERT INTO workflow_approvals (
                id, agency_id, location_id, execution_id, workflow_id, node_id,
                action_id, action_hash, status, requested_at, expires_at, request_checksum
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now(), $9, $10)
              ON CONFLICT (agency_id, location_id, execution_id, node_id) WHERE status = 'pending' DO NOTHING
            `, [
              crypto.randomUUID(), tenantId, locationId || tenantId, executionId,
              existingExecution?.workflow_id || payload.workflowId, pausedNodeId, pausedNodeId, actionHash, expiresAt, actionHash
            ]);

            const updRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'waiting_approval',
                current_node_id = $2,
                wait_type = 'approval',
                state = $3::jsonb,
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                updated_at = clock_timestamp()
              WHERE agency_id = $4 AND location_id = $5 AND id = $1
                AND status = 'resuming'
                AND resume_lease_owner = $6
                AND ($7::int IS NULL OR recovery_epoch = $7::int)
                AND clock_timestamp() < resume_lease_until
            `, [executionId, pausedNodeId, JSON.stringify(resumeResult.variables || {}), tenantId, locationId || tenantId, claimToken, currentRecoveryEpoch]);

            if (updRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
            }

          } else if (resumeResult.finalStatus === 'waiting_webhook') {
            const webhookStep = resumeResult.waitingStep || resumeResult.timeline.find(t => t.status === 'waiting_webhook');
            const webhookNodeId = webhookStep?.nodeId || 'unknown_node';
            const nextResumeNodeId = resumeResult.resumeNodeId || webhookStep?.resumeNodeId || null;
            const resumeToken = webhookStep?.resumeToken || webhookStep?.result?.resumeToken || null;
            const expiresAt = webhookStep?.expiresAt || webhookStep?.result?.expiresAt || null;

            const updRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'waiting_webhook',
                current_node_id = $2,
                resume_node_id = $3,
                wait_type = 'webhook',
                resume_token = $4,
                retry_at = $5::timestamptz,
                state = $6::jsonb,
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                updated_at = clock_timestamp()
              WHERE agency_id = $7 AND location_id = $8 AND id = $1
                AND status = 'resuming'
                AND resume_lease_owner = $9
                AND ($10::int IS NULL OR recovery_epoch = $10::int)
                AND clock_timestamp() < resume_lease_until
            `, [executionId, webhookNodeId, nextResumeNodeId, resumeToken, expiresAt, JSON.stringify(resumeResult.variables || {}), tenantId, locationId || tenantId, claimToken, currentRecoveryEpoch]);

            if (updRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
            }

          } else if (resumeResult.finalStatus === 'completed') {
            const updRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'completed',
                current_node_id = NULL,
                resume_node_id = NULL,
                wait_type = NULL,
                retry_at = NULL,
                resume_token = NULL,
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                finished_at = clock_timestamp(),
                state = $2::jsonb,
                updated_at = clock_timestamp()
              WHERE agency_id = $3 AND location_id = $4 AND id = $1
                AND status = 'resuming'
                AND resume_lease_owner = $5
                AND ($6::int IS NULL OR recovery_epoch = $6::int)
                AND clock_timestamp() < resume_lease_until
            `, [executionId, JSON.stringify(resumeResult.variables || {}), tenantId, locationId || tenantId, claimToken, currentRecoveryEpoch]);

            if (updRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
            }

          } else if (resumeResult.finalStatus === 'failed') {
            const failedStep = resumeResult.timeline.find(t => t.status === 'failed');
            const updRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'failed',
                last_error_code = $2,
                finished_at = clock_timestamp(),
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                state = $3::jsonb,
                updated_at = clock_timestamp()
              WHERE agency_id = $4 AND location_id = $5 AND id = $1
                AND status = 'resuming'
                AND resume_lease_owner = $6
                AND ($7::int IS NULL OR recovery_epoch = $7::int)
                AND clock_timestamp() < resume_lease_until
            `, [executionId, failedStep?.error || 'FAILED', JSON.stringify(resumeResult.variables || {}), tenantId, locationId || tenantId, claimToken, currentRecoveryEpoch]);

            if (updRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
            }

          } else {
            // Unknown status — fail closed!
            const updRes = await client.query(`
              UPDATE workflow_executions SET
                status = 'failed',
                last_error_code = 'UNKNOWN_WORKFLOW_OUTCOME',
                finished_at = clock_timestamp(),
                resume_lease_owner = NULL,
                resume_lease_until = NULL,
                resume_started_at = NULL,
                state = $2::jsonb,
                updated_at = clock_timestamp()
              WHERE agency_id = $3 AND location_id = $4 AND id = $1
                AND status = 'resuming'
                AND resume_lease_owner = $5
                AND ($6::int IS NULL OR recovery_epoch = $6::int)
                AND clock_timestamp() < resume_lease_until
            `, [executionId, JSON.stringify(resumeResult.variables || {}), tenantId, locationId || tenantId, claimToken, currentRecoveryEpoch]);

            if (updRes.rowCount !== 1) {
              await client.query('ROLLBACK').catch(() => {});
              return { status: 'lease_lost', executionId, message: 'Concurrent worker stole execution lease during persistence' };
            }
          }

          // Persist executed steps
          for (const step of resumeResult.timeline) {
            const stepStatus = ['running', 'completed', 'failed', 'waiting', 'waiting_approval', 'waiting_webhook', 'skipped'].includes(step.status)
              ? step.status
              : (step.status === 'simulated' ? 'completed' : 'completed');
            await client.query(`
              INSERT INTO workflow_execution_steps (
                id, agency_id, location_id, execution_id, node_id, attempt,
                status, details, error_code, started_at, finished_at
              ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7::jsonb, $8, $9, $10)
              ON CONFLICT (agency_id, location_id, id) DO NOTHING
            `, [
              crypto.randomUUID(), tenantId, locationId || tenantId, executionId,
              step.nodeId, stepStatus, JSON.stringify(step.result || {}),
              step.error || null, step.startedAt, step.finishedAt
            ]);
          }

          await client.query('COMMIT');
        } catch (pgErr) {
          await client.query('ROLLBACK').catch(() => {});
          throw Object.assign(new Error(`Failed to persist wait resume in PostgreSQL: ${pgErr.message}`), {
            code: 'WORKFLOW_WAIT_PERSIST_FAILED',
            retryable: true
          });
        } finally {
          client.release();
        }
      }

      if (!pool && outboxRepository && resumeResult.finalStatus === 'waiting') {
        const nextWaitStep = resumeResult.waitingStep || resumeResult.timeline.find(t => t.status === 'waiting');
        const nextWaitNodeId = nextWaitStep?.nodeId || 'unknown_node';
        const nextRetryAt = nextWaitStep?.retryAt || nextWaitStep?.result?.retryAt || new Date(Date.now() + 60000).toISOString();
        const nextResumeNodeId = resumeResult.resumeNodeId || nextWaitStep?.resumeNodeId || null;
        const nextGen = resumeGeneration + 1;
        const idemKey = `idem_${sha256([tenantId, locationId || tenantId, 'workflow_wait_resume', `${executionId}_${nextWaitNodeId}_gen_${nextGen}`])}`;
        await outboxRepository.enqueue({
          tenantId,
          locationId: locationId || tenantId,
          executionId,
          eventType: 'workflow.wait.resume',
          idempotencyKey: idemKey,
          availableAt: nextRetryAt,
          payload: {
            tenantId,
            locationId: locationId || tenantId,
            workflowId: existingExecution?.workflow_id || payload.workflowId,
            executionId,
            waitNodeId: nextWaitNodeId,
            resumeNodeId: nextResumeNodeId,
            resumeGeneration: nextGen,
            correlationId: payload.correlationId || `corr_${crypto.randomUUID()}`,
            enqueuedAt: new Date().toISOString()
          }
        });
      }

      if (resumeResult.finalStatus === 'failed') {
        const failedStep = resumeResult.timeline.find(t => t.status === 'failed');
        throw Object.assign(new Error(`Workflow execution failed on resume: ${failedStep?.error || 'WORKFLOW_FAILED'}`), {
          code: failedStep?.error || 'WORKFLOW_EXECUTION_FAILED',
          retryable: false
        });
      }

      return {
        status: resumeResult.finalStatus,
        executionId,
        resumeNodeId,
        stepsExecuted: resumeResult.timeline.length,
        timeline: resumeResult.timeline,
        workerId,
        resumedAt: new Date().toISOString()
      };
    },

    /**
     * Governed connector action execution (safe real dispatch).
     */
    'workflow.action.execute': async (payload, { job, workerId, lease, signal } = {}) => {
      const tenantId = payload?.tenantId || payload?.agencyId;
      if (!tenantId || !payload?.actionId) {
        throw new PermanentJobError('Payload missing required actionId or tenantId', 'INVALID_ACTION_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      const actionType = payload.actionType || payload.nodeType || payload.actionId;
      const actionDef = getWorkflowActionDefinition(actionType);
      if (!actionDef) {
        throw new PermanentJobError(`Action not registered: ${actionType}`, 'ACTION_NOT_REGISTERED');
      }

      // Validate trusted actor identity
      const actorId = payload.actorId || payload.requestedByActorId || payload.approvalEvidence?.approvedBy || payload.approvalEvidence?.approvedByActorId || job?.actor_id || job?.created_by || (payload.dryRun ? 'system_dry_run' : null);
      if (payload.actorId !== undefined && (typeof payload.actorId !== 'string' || !payload.actorId.trim())) {
        throw new PermanentJobError('Action execution requires trusted actor identity', 'ACTOR_IDENTITY_REQUIRED');
      }
      if (!actorId || typeof actorId !== 'string' || !actorId.trim()) {
        throw new PermanentJobError('Action execution requires trusted actor identity', 'ACTOR_IDENTITY_REQUIRED');
      }

      const isExternal = actionDef.risk === 'external_side_effect';
      if (isExternal && actionDef.approval === 'human') {
        const evidence = payload.approvalEvidence;
        if (!evidence || typeof evidence !== 'object') {
          throw new PermanentJobError('Action requires valid human approval evidence before worker execution', 'APPROVAL_REQUIRED');
        }
      }

      const targetLocationId = payload.locationId || tenantId;
      const actionHash = computeActionHash({
        tenantId,
        locationId: targetLocationId,
        workflowId: payload.workflowId || 'unknown_workflow',
        executionId: payload.executionId || 'unknown_execution',
        nodeId: payload.actionId,
        actionType,
        invocationKey: payload.invocationKey || 'default',
        input: payload.input || {}
      });

      if (isExternal && actionDef.approval === 'human') {
        const evidence = payload.approvalEvidence;
        if (evidence.status && evidence.status !== 'approved') {
          throw new PermanentJobError(`Approval evidence has non-approved status: ${evidence.status}`, 'APPROVAL_REJECTED');
        }
        if (evidence.checksum) {
          const { checksum, ...body } = evidence;
          const expectedChecksum = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
          if (checksum !== expectedChecksum) {
            throw new PermanentJobError('Approval evidence checksum mismatch or tampered', 'APPROVAL_TAMPERED');
          }
        }
        if (evidence.expiresAt) {
          const expiryMs = Date.parse(evidence.expiresAt);
          if (Number.isFinite(expiryMs) && expiryMs <= Date.now()) {
            throw new PermanentJobError('Approval evidence has expired', 'APPROVAL_EXPIRED');
          }
        }
        if (evidence.nodeId && evidence.nodeId !== payload.actionId) {
          throw new PermanentJobError('Approval evidence is for a different node', 'APPROVAL_NODE_MISMATCH');
        }
        if (evidence.actionHash && evidence.actionHash !== actionHash) {
          throw new PermanentJobError('Approval evidence is for a different action hash', 'APPROVAL_HASH_MISMATCH');
        }
        const requestedBy = evidence.requestedByActorId || evidence.requestedBy || payload.requestedByActorId || payload.actorId;
        const approvedBy = evidence.approvedByActorId || evidence.approvedBy;
        if (!approvedBy || (typeof approvedBy === 'string' && !approvedBy.trim())) {
          throw new PermanentJobError('Approval evidence missing approving actor', 'APPROVAL_APPROVER_MISSING');
        }
        if (requestedBy && approvedBy && requestedBy === approvedBy) {
          throw new PermanentJobError('Self-approval is prohibited; requester cannot approve action', 'SELF_APPROVAL_PROHIBITED');
        }
      }

      if (isExternal && !payload.consent && payload.dryRun === false) {
        throw new PermanentJobError('Action requires explicit consent before live execution', 'CONSENT_REQUIRED');
      }

      const isDryRun = payload.dryRun === true;
      const providerKey = payload.providerKey || actionDef?.providerKey;
      let providerResult = null;
      const effectiveOutboxRepo = outboxRepository || (pool ? createWorkflowOutboxRepository(pool) : null);

      if (!isDryRun && providerKey) {
        const adapter = providerRegistry?.get(providerKey);
        if (!adapter) {
          throw new PermanentJobError(`Provider adapter not found: ${providerKey}`, 'PROVIDER_ADAPTER_UNAVAILABLE');
        }

        // Zapier target verification
        if (adapter.providerKey === 'zapier' || providerKey.includes('zapier')) {
          if (typeof adapter.verify === 'function') {
            const verifyRes = await adapter.verify({ config: payload.config || payload.input || {} });
            if (!verifyRes.verified) {
              throw new PermanentJobError(`Zapier target verification failed: ${verifyRes.code || 'INVALID_ZAPIER_URL'}`, verifyRes.code || 'INVALID_ZAPIER_URL');
            }
          }
        }

        const capability = getProviderCapability(providerKey);
        const hasVerifiedIdempotency = capability?.safeRetryAfterAmbiguous === true;

        // Pre-claim receipt before remote dispatch
        let claimToken = null;
        if (effectiveOutboxRepo && pool && payload.executionId) {
          const claim = await effectiveOutboxRepo.claimActionReceipt({
            tenantId,
            locationId: targetLocationId,
            executionId: payload.executionId,
            nodeId: payload.actionId,
            actionHash,
            providerKey,
            workerId: workerId || 'system_worker',
            leaseSeconds: 60,
            hasVerifiedIdempotency
          });
          claimToken = claim.claimToken;

          if (!claim.acquired) {
            if (claim.status === 'succeeded') {
              return {
                status: 'completed',
                actionId: payload.actionId,
                actionReceipt: actionHash,
                providerResult: claim.result,
                sideEffectsDisabled: false,
                idempotencyReused: true,
                workerId,
                executedAt: new Date().toISOString()
              };
            }
            if (claim.status === 'indeterminate') {
              throw Object.assign(new Error(`Action ${actionHash} for ${payload.actionId} is in indeterminate state`), {
                code: 'ACTION_INDETERMINATE',
                retryable: false
              });
            }
            if (claim.status === 'in_progress') {
              throw Object.assign(new Error(`Action ${actionHash} for ${payload.actionId} is already in progress`), {
                code: 'ACTION_ALREADY_IN_PROGRESS',
                retryable: true
              });
            }
            throw Object.assign(new Error(`Failed to claim action receipt for ${payload.actionId}`), {
              code: 'ACTION_CLAIM_FAILED',
              retryable: true
            });
          }
        }

        let secret = payload.secret;
        if (!secret && secretResolver) {
          secret = await secretResolver.resolve(payload.secretRef || `tenant_${tenantId}_${providerKey}`).catch(() => null);
        }

        const channel = adapter.channel || (providerKey.includes('email') ? 'email' : ((providerKey.includes('sms') || providerKey.includes('twilio')) ? 'sms' : 'whatsapp'));
        const contactId = payload.input?.contactId || payload.input?.to || payload.input?.phone || payload.input?.email;
        const purpose = payload.purpose || 'transactional';

        const structuredConsent = await verifyAuthoritativeConsent({
          pool,
          tenantId,
          locationId: targetLocationId,
          contactId,
          channel,
          purpose,
          suppliedConsent: payload.consent
        });

        if (!structuredConsent) {
          if (effectiveOutboxRepo && pool && payload.executionId) {
            await effectiveOutboxRepo.failActionReceipt({
              tenantId,
              locationId: targetLocationId,
              actionHash,
              claimToken,
              errorCode: 'CONSENT_REQUIRED',
              indeterminate: false,
              outcomeDetails: { channel, contactId }
            }).catch(() => {});
          }
          throw new PermanentJobError(`Communication consent missing or revoked for contact ${contactId} on ${channel}`, 'CONSENT_REQUIRED');
        }

        let dispatchRes;
        let dispatchErr = null;
        try {
          dispatchRes = await adapter.dispatch({
            secret,
            config: payload.config || {},
            payload: payload.input || {},
            consent: structuredConsent,
            tenantId,
            locationId: targetLocationId,
            actionHash,
            signal
          });
        } catch (err) {
          dispatchErr = err;
        }

        if (dispatchErr) {
          const isTimeout = dispatchErr.name === 'TimeoutError' || dispatchErr.name === 'AbortError' || /timeout|aborted/i.test(dispatchErr.message || '');
          const isIndeterminate = dispatchErr.indeterminate === true || isTimeout;
          const errorCode = isTimeout ? 'PROVIDER_TIMEOUT_INDETERMINATE' : (dispatchErr.code || 'PROVIDER_DISPATCH_FAILED');
          if (effectiveOutboxRepo && pool && payload.executionId) {
            await effectiveOutboxRepo.failActionReceipt({
              tenantId,
              locationId: targetLocationId,
              actionHash,
              claimToken,
              errorCode,
              indeterminate: isIndeterminate,
              outcomeDetails: { message: dispatchErr.message }
            }).catch(() => {});
          }
          throw dispatchErr;
        }

        if (!dispatchRes.ok) {
          const isTimeout = dispatchRes.code === 'PROVIDER_TIMEOUT_INDETERMINATE';
          const isIndeterminate = dispatchRes.indeterminate === true || isTimeout;
          if (effectiveOutboxRepo && pool && payload.executionId) {
            await effectiveOutboxRepo.failActionReceipt({
              tenantId,
              locationId: targetLocationId,
              actionHash,
              claimToken,
              errorCode: dispatchRes.code || 'PROVIDER_DISPATCH_REJECTED',
              indeterminate: isIndeterminate,
              outcomeDetails: { code: dispatchRes.code, status: dispatchRes.status || dispatchRes.httpStatus }
            }).catch(() => {});
          }
          throw Object.assign(new Error(`Provider dispatch rejected: ${dispatchRes.code}`), { code: dispatchRes.code, indeterminate: isIndeterminate });
        }
        providerResult = dispatchRes;

        // Mark receipt succeeded
        if (effectiveOutboxRepo && pool && payload.executionId) {
          const safeResult = {
            ok: true,
            provider: dispatchRes.provider || providerKey,
            providerMessageId: dispatchRes.providerMessageId || dispatchRes.sid || dispatchRes.id || null,
            httpStatus: dispatchRes.httpStatus || 200,
            idempotencyKey: actionHash
          };
          await effectiveOutboxRepo.completeActionReceipt({
            tenantId,
            locationId: targetLocationId,
            actionHash,
            claimToken,
            result: safeResult,
            providerReceipt: safeResult.providerMessageId,
            outcomeDetails: { providerKey, actionId: payload.actionId }
          });
        }
      } else if (!isDryRun && actionDef?.risk === 'external_side_effect') {
        throw new PermanentJobError('External side effect action is missing a provider key', 'PROVIDER_KEY_REQUIRED');
      }

      const actionReceipt = actionHash;

      return {
        status: isDryRun ? 'simulated' : 'completed',
        actionId: payload.actionId,
        actionReceipt,
        providerResult,
        sideEffectsDisabled: isDryRun,
        workerId,
        executedAt: new Date().toISOString()
      };
    },

    /**
     * CRM Lead Qualification event handler.
     */
    'crm.lead.qualified': async (payload, { job, workerId, lease }) => {
      if (!payload?.tenantId || !payload?.contactId) {
        throw new PermanentJobError('Payload missing contactId or tenantId', 'INVALID_LEAD_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      return {
        status: 'qualified',
        contactId: payload.contactId,
        score: payload.score ?? 85,
        workerId,
        qualifiedAt: new Date().toISOString()
      };
    },

    /**
     * Audit event recording handler.
     */
    'audit.event.record': async (payload, { job, workerId, lease }) => {
      if (!payload?.tenantId || !payload?.action) {
        throw new PermanentJobError('Payload missing required audit action or tenantId', 'INVALID_AUDIT_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      return {
        status: 'recorded',
        eventId: `audit_${crypto.randomUUID()}`,
        workerId,
        recordedAt: new Date().toISOString()
      };
    },

    ...customHandlers
  };

  return handlers;
}

export const handlers = createTrustedWorkerHandlers();
export const trustedWorkerHandlers = handlers;
export default { handlers, createTrustedWorkerHandlers };
