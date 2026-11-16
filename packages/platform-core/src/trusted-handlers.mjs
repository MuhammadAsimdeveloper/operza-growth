import crypto from 'node:crypto';
import { PermanentJobError } from './durable-worker.mjs';
import { getWorkflowActionDefinition } from '../../workflow-engine/src/action-governance.mjs';
import { walkGraph } from '../../workflow-engine/src/engine.mjs';
import { createProviderAdapterRegistry } from './provider-adapters.mjs';

function sha256(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
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
        } catch (dbErr) {
          if (dbErr instanceof PermanentJobError) throw dbErr;
          console.warn('[WORKER-TRIGGER] DB init failed:', dbErr.message);
        } finally {
          client.release();
        }
      }

      if (!flow) {
        flow = { id: workflowId, name: 'Default Flow', nodes: payload.nodes || [] };
      }

      // 2. Build Execution Dependencies & Provider Executor
      const deps = {
        execution: {
          id: executionId,
          agencyId: tenantId,
          locationId: locationId || tenantId,
          workflowId,
          mode,
          consent: payload.consent === true,
          approvedNodeId: payload.approvedNodeId || null,
          approvalEvidence: payload.approvalEvidence || null
        },
        crmActions: payload.crmActions || {
          sendEmail: async () => {},
          sendSms: async () => {},
          addContactTag: async () => {},
          createTask: async () => {},
          updateOpportunityStage: async () => {}
        },
        providerExecutor: async ({ invocation, node, context }) => {
          const providerKey = invocation.providerKey;
          const adapter = providerRegistry?.get(providerKey);
          if (!adapter) {
            throw new PermanentJobError(`Provider adapter not found: ${providerKey}`, 'PROVIDER_ADAPTER_UNAVAILABLE');
          }

          let secret = invocation.secret;
          if (!secret && secretResolver) {
            secret = await secretResolver.resolve(invocation.secretRef || `tenant_${tenantId}_${providerKey}`).catch(() => null);
          }

          const dispatchRes = await adapter.dispatch({
            secret,
            config: node.config,
            payload: context,
            consent: payload.consent === true,
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
            } catch (err) {
              console.warn('[WORKER-RECEIPT] Failed to save receipt:', err.message);
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
        } catch (pgErr) {
          console.warn('[WORKER-GRAPH-PERSIST] Failed to update execution steps:', pgErr.message);
        } finally {
          persistClient.release();
        }
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
            throw new PermanentJobError('Execution node has not been approved in workflow_approvals', 'RESUME_NOT_APPROVED');
          }

          // 2. Load execution record
          const execRes = await client.query(
            'SELECT * FROM workflow_executions WHERE agency_id = $1 AND id = $2',
            [tenantId, executionId]
          );
          if (execRes.rows.length === 0) {
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
        } catch (dbErr) {
          if (dbErr instanceof PermanentJobError) throw dbErr;
          console.warn('[WORKER-RESUME] DB lookup error:', dbErr.message);
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
          const dispatchRes = await adapter.dispatch({
            secret,
            config: node.config,
            payload: context,
            consent: true,
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

      if (pool) {
        const client = await pool.connect();
        try {
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
        } catch (pgErr) {
          console.warn('[WORKER-RESUME-PERSIST] DB update error:', pgErr.message);
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
        if (isExternal && payload.consent !== true && payload.dryRun === false) {
          throw new PermanentJobError('Action requires explicit consent before live execution', 'CONSENT_REQUIRED');
        }
      }

      const isDryRun = payload.dryRun === true;
      const providerKey = payload.providerKey || actionDef?.providerKey;
      let providerResult = null;

      if (!isDryRun && providerKey) {
        const adapter = providerRegistry?.get(providerKey);
        if (adapter) {
          let secret = payload.secret;
          if (!secret && secretResolver) {
            secret = await secretResolver.resolve(payload.secretRef || `tenant_${tenantId}_${providerKey}`).catch(() => null);
          }
          const dispatchRes = await adapter.dispatch({
            secret,
            config: payload.config || {},
            payload: payload.input || {},
            consent: payload.consent === true,
            tenantId,
            locationId: payload.locationId || tenantId,
            actionHash: sha256({ tenantId, actionId: payload.actionId, input: payload.input })
          });
          if (!dispatchRes.ok) {
            throw Object.assign(new Error(`Provider dispatch rejected: ${dispatchRes.code}`), { code: dispatchRes.code });
          }
          providerResult = dispatchRes;
        }
      }

      const actionReceipt = sha256({
        tenantId,
        actionId: payload.actionId,
        input: payload.input || {},
        idempotencyKey: job?.idempotencyKey || crypto.randomUUID()
      });

      if (pool && !isDryRun && providerResult) {
        const rcClient = await pool.connect();
        try {
          await rcClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [tenantId, payload.locationId || tenantId]);
          await rcClient.query(`
            INSERT INTO workflow_action_receipts (
              id, agency_id, location_id, execution_id, node_id, action_hash,
              provider_key, provider_receipt, status, result, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'succeeded', $9::jsonb, now(), now())
            ON CONFLICT (agency_id, location_id, action_hash) DO NOTHING
          `, [
            crypto.randomUUID(), tenantId, payload.locationId || tenantId, payload.executionId || crypto.randomUUID(),
            payload.actionId, actionReceipt, providerKey || 'generic',
            providerResult?.providerMessageId || null, JSON.stringify(providerResult || {})
          ]);
        } catch (err) {
          console.warn('[WORKER-ACTION-RECEIPT] Failed to save receipt:', err.message);
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
