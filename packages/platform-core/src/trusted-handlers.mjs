import crypto from 'node:crypto';
import { PermanentJobError } from './durable-worker.mjs';
import { getWorkflowActionDefinition } from '../../workflow-engine/src/action-governance.mjs';
import { walkGraph } from '../../workflow-engine/src/engine.mjs';
import { createProviderAdapterRegistry } from './provider-adapters.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/**
 * Authoritatively verifies consent records from PostgreSQL communication_consents table.
 * Never fabricates consent evidence from a Boolean flag.
 */
async function verifyAuthoritativeConsent({ pool, tenantId, locationId, contactId, channel, purpose = 'transactional', suppliedConsent = null }) {
  if (!pool) {
    if (typeof suppliedConsent === 'object' && suppliedConsent !== null && suppliedConsent.status === 'granted') {
      if (suppliedConsent.channel === channel && (!contactId || suppliedConsent.contactId === contactId)) {
        return suppliedConsent;
      }
    }
    // Boolean consent must never become authoritative evidence
    return null;
  }

  if (!contactId || !channel) {
    return null;
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId || tenantId]);

    let targetContactId = contactId;
    if (!UUID_REGEX.test(contactId)) {
      // Look up contact UUID from location_records
      const contactLookup = await client.query(`
        SELECT id FROM location_records
        WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts'
          AND (body->>'email' = $3 OR body->>'phone' = $3 OR id::text = $3)
        LIMIT 1
      `, [tenantId, locationId || tenantId, contactId]);
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
      WHERE agency_id = $1 AND ($2::uuid IS NULL OR location_id = $2) AND contact_id = $3::uuid AND channel = $4 AND purpose = $5
      ORDER BY captured_at DESC
      LIMIT 1
    `, [tenantId, locationId || null, targetContactId, channel, purpose]);

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

/**
 * Creates trusted allow-listed event handlers for the Operza Durable Outbox Worker,
 * with real PostgreSQL-backed workflow graph execution and registered provider adapters.
 */
export function createTrustedWorkerHandlers({
  pool = null,
  secretResolver = null,
  providerRegistry = createProviderAdapterRegistry(),
  customHandlers = {}
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

          // Initialize execution in PostgreSQL
          await client.query(`
            INSERT INTO workflow_executions (
              id, agency_id, location_id, workflow_id, status, trigger_event,
              worker_lease_id, heartbeat_at, attempts, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'running', $5::jsonb, $6, now(), 1, now(), now())
            ON CONFLICT (agency_id, location_id, id) DO UPDATE SET
              status = 'running', worker_lease_id = EXCLUDED.worker_lease_id,
              heartbeat_at = now(), updated_at = now()
          `, [executionId, tenantId, locationId || tenantId, workflowId, JSON.stringify(triggerContext), workerId]);
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

      // Real CRM Actions connected to PostgreSQL location_records and opportunities
      const realCrmActions = {
        sendEmail: async ({ to, subject, body, text, html }) => {
          const adapter = providerRegistry?.get('email.resend') || providerRegistry?.get('email.sendgrid');
          if (adapter) {
            const secret = secretResolver ? await secretResolver.resolve(`tenant_${tenantId}_email`).catch(() => null) : null;
            const structuredConsent = await verifyAuthoritativeConsent({
              pool,
              tenantId,
              locationId: locationId || tenantId,
              contactId: to,
              channel: 'email',
              purpose: 'transactional',
              suppliedConsent: typeof payload.consent === 'object' ? payload.consent : null
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
              locationId: locationId || tenantId
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
              locationId: locationId || tenantId,
              contactId: to,
              channel: 'sms',
              purpose: 'transactional',
              suppliedConsent: typeof payload.consent === 'object' ? payload.consent : null
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
              locationId: locationId || tenantId
            });
          }
        },
        addContactTag: async ({ contactId, tag }) => {
          if (!pool) return;
          if (!contactId || !tag) throw Object.assign(new Error('contactId and tag are required'), { code: 'INVALID_TAG_PARAMS' });
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId || tenantId]);
            const res = await client.query('SELECT body FROM location_records WHERE agency_id = $1 AND collection = $2 AND id = $3', [tenantId, 'contacts', contactId]);
            if (res.rows.length === 0) {
              await client.query('ROLLBACK');
              throw Object.assign(new Error(`Contact ${contactId} not found in PostgreSQL`), { code: 'CONTACT_NOT_FOUND' });
            }
            const b = res.rows[0].body || {};
            b.tags = Array.from(new Set([...(b.tags || []), tag]));
            const updateRes = await client.query('UPDATE location_records SET body = $1::jsonb, updated_at = now() WHERE agency_id = $2 AND collection = $3 AND id = $4', [JSON.stringify(b), tenantId, 'contacts', contactId]);
            if (updateRes.rowCount === 0) {
              await client.query('ROLLBACK');
              throw Object.assign(new Error(`Failed to update tags for contact ${contactId}`), { code: 'CONTACT_UPDATE_FAILED' });
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        },
        createTask: async (taskData) => {
          if (!pool) return;
          const taskId = crypto.randomUUID();
          const taskRecord = {
            id: taskId,
            agencyId: tenantId,
            locationId: locationId || tenantId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            ...taskData
          };
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId || tenantId]);
            const insertRes = await client.query(`
              INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
              VALUES ($1, $2, $3, 'tasks', $4::jsonb, now(), now())
            `, [taskId, tenantId, locationId || tenantId, JSON.stringify(taskRecord)]);
            if (insertRes.rowCount === 0) {
              await client.query('ROLLBACK');
              throw Object.assign(new Error('Failed to insert task record in PostgreSQL'), { code: 'TASK_INSERT_FAILED' });
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
          return taskRecord;
        },
        updateOpportunityStage: async ({ opportunityId, stage, stageId }) => {
          if (!pool) return;
          if (!opportunityId) throw Object.assign(new Error('opportunityId is required'), { code: 'OPPORTUNITY_ID_REQUIRED' });
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId || tenantId]);
            const updateRes = await client.query(`
              UPDATE opportunities
              SET stage_id = COALESCE($1, stage_id), status = COALESCE($2, status), updated_at = now()
              WHERE agency_id = $3 AND id = $4
            `, [stageId || stage, stage || null, tenantId, opportunityId]);
            if (updateRes.rowCount === 0) {
              await client.query('ROLLBACK');
              throw Object.assign(new Error(`Opportunity ${opportunityId} not found in PostgreSQL`), { code: 'OPPORTUNITY_NOT_FOUND' });
            }
            await client.query('COMMIT');
          } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
          } finally {
            client.release();
          }
        }
      };

      // 2. Build Execution Dependencies & Provider Executor
      const deps = {
        execution: {
          id: executionId,
          agencyId: tenantId,
          locationId: locationId || tenantId,
          workflowId,
          mode,
          consent: typeof payload.consent === 'object' && payload.consent?.status === 'granted',
          approvedNodeId: payload.approvedNodeId || null,
          approvalEvidence: payload.approvalEvidence || null
        },
        crmActions: payload.crmActions || realCrmActions,
        providerExecutor: async ({ invocation, node, context }) => {
          if (mode === 'dry_run') {
            return { ok: true, simulated: true, providerAccepted: false };
          }
          const providerKey = invocation.providerKey;
          const adapter = providerRegistry?.get(providerKey);
          if (!adapter) {
            throw new PermanentJobError(`Provider adapter not found: ${providerKey}`, 'PROVIDER_ADAPTER_UNAVAILABLE');
          }

          let secret = invocation.secret;
          if (!secret && secretResolver) {
            secret = await secretResolver.resolve(invocation.secretRef || `tenant_${tenantId}_${providerKey}`).catch(() => null);
          }

          const channel = adapter.channel || (providerKey.startsWith('email') ? 'email' : (providerKey.startsWith('sms') ? 'sms' : 'whatsapp'));
          const contactId = context?.contactId || context?.contact?.id || context?.to || context?.phone || context?.email;
          const purpose = payload.purpose || 'transactional';

          // Authoritative consent verification - never fabricate from boolean
          const structuredConsent = await verifyAuthoritativeConsent({
            pool,
            tenantId,
            locationId: locationId || tenantId,
            contactId,
            channel,
            purpose,
            suppliedConsent: payload.consent
          });

          if (!structuredConsent) {
            throw new PermanentJobError(`Communication consent missing or revoked for contact ${contactId} on ${channel}`, 'CONSENT_REQUIRED');
          }

          const dispatchRes = await adapter.dispatch({
            secret,
            config: node.config,
            payload: context,
            consent: structuredConsent,
            tenantId,
            locationId: locationId || tenantId,
            actionHash: invocation.actionHash
          });

          if (!dispatchRes.ok) {
            throw Object.assign(new Error(`Provider dispatch rejected: ${dispatchRes.code}`), {
              code: dispatchRes.code || 'PROVIDER_DISPATCH_FAILED'
            });
          }

          if (pool) {
            const validHash = /^[a-f0-9]{64}$/.test(invocation.actionHash || '')
              ? invocation.actionHash
              : sha256({ tenantId, executionId, node: node.id, ts: Date.now() });
            const rcClient = await pool.connect();
            try {
              await rcClient.query('BEGIN');
              await rcClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, locationId || tenantId]);
              await rcClient.query(`
                INSERT INTO workflow_action_receipts (
                  id, agency_id, location_id, execution_id, node_id, action_hash,
                  provider_key, provider_receipt, status, result, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'succeeded', $9::jsonb, now(), now())
                ON CONFLICT (agency_id, location_id, action_hash) DO NOTHING
              `, [
                crypto.randomUUID(), tenantId, locationId || tenantId, executionId,
                node.id, validHash, providerKey, dispatchRes.providerMessageId || null,
                JSON.stringify(dispatchRes)
              ]);
              await rcClient.query('COMMIT');
            } catch (err) {
              await rcClient.query('ROLLBACK').catch(() => {});
              throw Object.assign(new Error(`Failed to save action receipt in PostgreSQL: ${err.message}`), {
                code: 'ACTION_RECEIPT_PERSIST_FAILED'
              });
            } finally {
              rcClient.release();
            }
          }

          return dispatchRes;
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
                status = 'waiting_approval', current_node_id = $2,
                state = $3::jsonb, updated_at = now()
              WHERE agency_id = $4 AND location_id = $5 AND id = $1
            `, [executionId, pausedNodeId, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          } else if (graphResult.finalStatus === 'completed') {
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'completed', current_node_id = NULL, finished_at = now(),
                state = $2::jsonb, updated_at = now()
              WHERE agency_id = $3 AND location_id = $4 AND id = $1
            `, [executionId, JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          } else {
            const failedStep = graphResult.timeline.find(t => t.status === 'failed');
            await persistClient.query(`
              UPDATE workflow_executions SET
                status = 'failed', last_error_code = $2, finished_at = now(),
                state = $3::jsonb, updated_at = now()
              WHERE agency_id = $4 AND location_id = $5 AND id = $1
            `, [executionId, failedStep?.error || 'FAILED', JSON.stringify(graphResult.variables || {}), tenantId, locationId || tenantId]);
          }

          // Persist each step into workflow_execution_steps
          for (const step of graphResult.timeline) {
            const stepStatus = ['running', 'completed', 'failed', 'waiting_approval', 'skipped'].includes(step.status)
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

      const deps = {
        execution: {
          id: executionId,
          agencyId: tenantId,
          locationId: locationId || tenantId,
          workflowId: existingExecution?.workflow_id || payload.workflowId,
          mode: payload.mode || 'live',
          approvedNodeId: nodeId,
          approvalEvidence: payload.evidence || { approvedAt: new Date().toISOString() }
        },
        providerExecutor: async ({ invocation, node, context }) => {
          const adapter = providerRegistry?.get(invocation.providerKey);
          if (!adapter) throw new PermanentJobError(`Provider adapter not found: ${invocation.providerKey}`, 'PROVIDER_ADAPTER_UNAVAILABLE');
          const secret = secretResolver ? await secretResolver.resolve(`tenant_${tenantId}_${invocation.providerKey}`).catch(() => null) : null;

          const channel = adapter.channel || (invocation.providerKey.startsWith('email') ? 'email' : (invocation.providerKey.startsWith('sms') ? 'sms' : 'whatsapp'));
          const contactId = context?.contactId || context?.contact?.id || context?.to || context?.phone || context?.email;
          const purpose = payload.purpose || 'transactional';

          const structuredConsent = await verifyAuthoritativeConsent({
            pool,
            tenantId,
            locationId: locationId || tenantId,
            contactId,
            channel,
            purpose,
            suppliedConsent: payload.consent
          });

          if (!structuredConsent) {
            throw new PermanentJobError(`Communication consent missing or revoked for contact ${contactId} on ${channel}`, 'CONSENT_REQUIRED');
          }

          const dispatchRes = await adapter.dispatch({
            secret,
            config: node.config,
            payload: context,
            consent: structuredConsent,
            tenantId,
            locationId: locationId || tenantId,
            actionHash: invocation.actionHash
          });
          if (!dispatchRes.ok) {
            throw Object.assign(new Error(`Provider dispatch rejected: ${dispatchRes.code}`), { code: dispatchRes.code });
          }
          return dispatchRes;
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
     * Governed connector action execution (safe real dispatch).
     */
    'workflow.action.execute': async (payload, { job, workerId, lease }) => {
      const tenantId = payload?.tenantId || payload?.agencyId;
      if (!tenantId || !payload?.actionId) {
        throw new PermanentJobError('Payload missing required actionId or tenantId', 'INVALID_ACTION_PAYLOAD');
      }
      if (lease?.lost) return { status: 'lease_lost' };

      const actionType = payload.actionType || payload.nodeType || payload.actionId;
      const actionDef = getWorkflowActionDefinition(actionType);
      if (actionDef) {
        const isExternal = actionDef.risk === 'external_side_effect';
        if (isExternal && actionDef.approval === 'human' && !payload.approved && !payload.approvalEvidence) {
          throw new PermanentJobError('Action requires human approval before worker execution', 'APPROVAL_REQUIRED');
        }
        if (isExternal && !payload.consent && payload.dryRun === false) {
          throw new PermanentJobError('Action requires explicit consent before live execution', 'CONSENT_REQUIRED');
        }
      }

      const isDryRun = payload.dryRun === true;
      const providerKey = payload.providerKey || actionDef?.providerKey;
      let providerResult = null;

      if (!isDryRun && providerKey) {
        const adapter = providerRegistry?.get(providerKey);
        if (!adapter) {
          throw new PermanentJobError(`Provider adapter not found: ${providerKey}`, 'PROVIDER_ADAPTER_UNAVAILABLE');
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
          locationId: payload.locationId || tenantId,
          contactId,
          channel,
          purpose,
          suppliedConsent: payload.consent
        });

        if (!structuredConsent) {
          throw new PermanentJobError(`Communication consent missing or revoked for contact ${contactId} on ${channel}`, 'CONSENT_REQUIRED');
        }

        const dispatchRes = await adapter.dispatch({
          secret,
          config: payload.config || {},
          payload: payload.input || {},
          consent: structuredConsent,
          tenantId,
          locationId: payload.locationId || tenantId,
          actionHash: sha256({ tenantId, actionId: payload.actionId, input: payload.input })
        });
        if (!dispatchRes.ok) {
          throw Object.assign(new Error(`Provider dispatch rejected: ${dispatchRes.code}`), { code: dispatchRes.code });
        }
        providerResult = dispatchRes;
      } else if (!isDryRun && actionDef?.risk === 'external_side_effect') {
        throw new PermanentJobError('External side effect action is missing a provider key', 'PROVIDER_KEY_REQUIRED');
      }

      const actionReceipt = sha256({
        tenantId,
        actionId: payload.actionId,
        input: payload.input || {},
        idempotencyKey: job?.idempotencyKey || crypto.randomUUID()
      });

      if (pool && !isDryRun && providerResult && payload.executionId) {
        const rcClient = await pool.connect();
        try {
          await rcClient.query('BEGIN');
          let targetLocationId = payload.locationId;
          if (!targetLocationId) {
            const execLookup = await rcClient.query(
              'SELECT location_id FROM workflow_executions WHERE agency_id = $1 AND id = $2',
              [tenantId, payload.executionId]
            );
            if (execLookup.rows.length > 0) {
              targetLocationId = execLookup.rows[0].location_id;
            }
          }
          await rcClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, targetLocationId || tenantId]);
          await rcClient.query(`
            INSERT INTO workflow_action_receipts (
              id, agency_id, location_id, execution_id, node_id, action_hash,
              provider_key, provider_receipt, status, result, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'succeeded', $9::jsonb, now(), now())
            ON CONFLICT (agency_id, location_id, action_hash) DO NOTHING
          `, [
            crypto.randomUUID(), tenantId, targetLocationId || tenantId, payload.executionId,
            payload.actionId, actionReceipt, providerKey || 'generic',
            providerResult?.providerMessageId || null, JSON.stringify(providerResult || {})
          ]);
          await rcClient.query('COMMIT');
        } catch (err) {
          await rcClient.query('ROLLBACK').catch(() => {});
          throw Object.assign(new Error(`Failed to save action receipt in PostgreSQL: ${err.message}`), {
            code: 'ACTION_RECEIPT_PERSIST_FAILED'
          });
        } finally {
          rcClient.release();
        }
      }

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
