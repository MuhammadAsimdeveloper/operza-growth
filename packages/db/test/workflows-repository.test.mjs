import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createWorkflowsRepository } from '../lib/workflows-repository.mjs';

function createInMemoryStoragePool() {
  const definitions = []; // { id, agency_id, location_id, name, status, trigger_type, trigger_config, nodes, version, created_at, updated_at }
  const executions = [];  // { id, agency_id, location_id, workflow_id, status, trigger_event, current_node_id, resume_node_id, wait_generation, wait_type, state, state_checksum, leased_by, lease_expires_at, attempts, last_error_code, retry_at, finished_at, created_at, updated_at }
  const steps = [];       // { id, agency_id, location_id, execution_id, node_id, attempt, status, details, error_code, started_at, finished_at }
  const approvals = [];   // { id, agency_id, location_id, execution_id, workflow_id, node_id, action_id, action_hash, requested_by, decided_by, status, requested_at, expires_at, decided_at, request_checksum, decision_checksum, created_at, updated_at }

  return {
    definitions,
    executions,
    steps,
    approvals,
    async connect() {
      let currentAgencyId = null;
      let currentLocationId = null;
      let currentUserId = null;
      let inTx = false;

      return {
        async query(sql, params = []) {
          const normSql = sql.replace(/\s+/g, ' ').trim();

          if (normSql === 'BEGIN') {
            inTx = true;
            return { rows: [], rowCount: 0 };
          }
          if (normSql === 'COMMIT' || normSql === 'ROLLBACK') {
            inTx = false;
            currentAgencyId = null;
            currentLocationId = null;
            currentUserId = null;
            return { rows: [], rowCount: 0 };
          }
          if (normSql.includes("set_config('app.agency_id'")) {
            currentAgencyId = params[0];
            currentLocationId = params[1];
            currentUserId = params[2];
            return { rows: [], rowCount: 0 };
          }

          // -------------------------------------------------------------
          // WORKFLOW DEFINITIONS QUERIES
          // -------------------------------------------------------------
          if (normSql.startsWith('INSERT INTO workflow_definitions')) {
            const [
              id, agencyId, locationId, name, status, triggerType,
              triggerConfigStr, nodesStr, version, createdAt, updatedAt
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO workflow_definitions');
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              name,
              status: status || 'draft',
              trigger_type: triggerType || 'manual',
              trigger_config: typeof triggerConfigStr === 'string' ? JSON.parse(triggerConfigStr) : (triggerConfigStr || {}),
              nodes: typeof nodesStr === 'string' ? JSON.parse(nodesStr) : (nodesStr || []),
              version: Number(version) || 1,
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date()
            };
            definitions.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT count(*) as count FROM workflow_definitions') || normSql.startsWith('SELECT count(*)::int as count FROM workflow_definitions')) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [{ count: 0 }], rowCount: 1 };
            }
            const filtered = definitions.filter(d => d.agency_id === agencyId && d.location_id === locationId);
            return { rows: [{ count: filtered.length }], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT * FROM workflow_definitions WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const match = definitions.find(d => d.agency_id === agencyId && d.location_id === locationId && d.id === id);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT * FROM workflow_definitions WHERE agency_id = $1 AND location_id = $2') && !normSql.includes('AND id = $3')) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            let filtered = definitions.filter(d => d.agency_id === agencyId && d.location_id === locationId);
            return { rows: filtered, rowCount: filtered.length };
          }

          if (normSql.startsWith('UPDATE workflow_definitions')) {
            const agencyId = currentAgencyId;
            const locationId = currentLocationId;
            const id = params[params.length - 1];
            const idx = definitions.findIndex(d => d.agency_id === agencyId && d.location_id === locationId && d.id === id);
            if (idx === -1) return { rows: [], rowCount: 0 };

            const target = definitions[idx];
            // Update fields based on params
            if (params[0] !== undefined) target.name = params[0];
            if (params[1] !== undefined) target.status = params[1];
            if (params[2] !== undefined) target.trigger_type = params[2];
            if (params[3] !== undefined) target.trigger_config = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3];
            if (params[4] !== undefined) target.nodes = typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4];
            if (params[5] !== undefined) target.version = Number(params[5]);
            target.updated_at = new Date();
            return { rows: [target], rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM workflow_definitions WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const idx = definitions.findIndex(d => d.agency_id === agencyId && d.location_id === locationId && d.id === id);
            if (idx === -1) return { rows: [], rowCount: 0 };
            const removed = definitions.splice(idx, 1);
            return { rows: removed, rowCount: 1 };
          }

          // -------------------------------------------------------------
          // WORKFLOW EXECUTIONS QUERIES
          // -------------------------------------------------------------
          if (normSql.startsWith('INSERT INTO workflow_executions')) {
            const [
              id, agencyId, locationId, workflowId, status, triggerEventStr,
              currentNodeId, resumeNodeId, waitGeneration, waitType,
              stateStr, attempts, createdAt, updatedAt
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO workflow_executions');
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              workflow_id: workflowId,
              status: status || 'pending',
              trigger_event: typeof triggerEventStr === 'string' ? JSON.parse(triggerEventStr) : (triggerEventStr || {}),
              current_node_id: currentNodeId || null,
              resume_node_id: resumeNodeId || null,
              wait_generation: Number(waitGeneration) || 0,
              wait_type: waitType || null,
              state: typeof stateStr === 'string' ? JSON.parse(stateStr) : (stateStr || {}),
              attempts: Number(attempts) || 0,
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date(),
              finished_at: null
            };
            executions.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT * FROM workflow_executions WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const match = executions.find(e => e.agency_id === agencyId && e.location_id === locationId && e.id === id);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT') && normSql.includes('FROM workflow_executions WHERE agency_id = $1 AND location_id = $2')) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const filtered = executions.filter(e => e.agency_id === agencyId && e.location_id === locationId);
            return { rows: filtered, rowCount: filtered.length };
          }

          // -------------------------------------------------------------
          // WORKFLOW EXECUTION STEPS QUERIES
          // -------------------------------------------------------------
          if (normSql.startsWith('INSERT INTO workflow_execution_steps')) {
            const [
              id, agencyId, locationId, executionId, nodeId, attempt,
              status, detailsStr, errorCode, startedAt, finishedAt
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO workflow_execution_steps');
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              execution_id: executionId,
              node_id: nodeId,
              attempt: Number(attempt) || 1,
              status,
              details: typeof detailsStr === 'string' ? JSON.parse(detailsStr) : (detailsStr || {}),
              error_code: errorCode || null,
              started_at: startedAt ? new Date(startedAt) : new Date(),
              finished_at: finishedAt ? new Date(finishedAt) : null
            };
            steps.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT') && normSql.includes('FROM workflow_execution_steps WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3')) {
            const [agencyId, locationId, executionId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const filtered = steps.filter(s => s.agency_id === agencyId && s.location_id === locationId && s.execution_id === executionId);
            return { rows: filtered, rowCount: filtered.length };
          }

          // -------------------------------------------------------------
          // WORKFLOW APPROVALS QUERIES
          // -------------------------------------------------------------
          if (normSql.startsWith('INSERT INTO workflow_approvals')) {
            const [
              id, agencyId, locationId, executionId, workflowId, nodeId, actionId,
              actionHash, requestedBy, status, requestedAt, expiresAt, requestChecksum
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO workflow_approvals');
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              execution_id: executionId,
              workflow_id: workflowId,
              node_id: nodeId,
              action_id: actionId,
              action_hash: actionHash,
              requested_by: requestedBy || null,
              decided_by: null,
              status: status || 'pending',
              requested_at: requestedAt ? new Date(requestedAt) : new Date(),
              expires_at: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 86400000),
              decided_at: null,
              request_checksum: requestChecksum,
              decision_checksum: null,
              created_at: new Date(),
              updated_at: new Date()
            };
            approvals.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT') && normSql.includes('FROM workflow_approvals') && normSql.includes("status = 'pending'")) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const filtered = approvals.filter(a => a.agency_id === agencyId && a.location_id === locationId && a.status === 'pending');
            return { rows: filtered, rowCount: filtered.length };
          }

          if (normSql.startsWith('SELECT * FROM workflow_approvals WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3 AND status = \'pending\'')) {
            const [agencyId, locationId, executionId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const filtered = approvals.filter(a => a.agency_id === agencyId && a.location_id === locationId && a.execution_id === executionId && a.status === 'pending');
            return { rows: filtered, rowCount: filtered.length };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

test('WorkflowsRepository — Definitions, Executions, Steps, Approvals & TenantTx Boundary', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createWorkflowsRepository();

  const tenantA = {
    agencyId: '11111111-1111-4111-8111-111111111111',
    locationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    actorId: 'user-a'
  };

  const tenantB = {
    agencyId: '22222222-2222-4222-8222-222222222222',
    locationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    actorId: 'user-b'
  };

  // 1. Create a workflow definition under Tenant A
  const createdDef = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.createWorkflow(tx, {
      name: 'Lead Nurture Flow',
      triggerType: 'tag',
      triggerConfig: { tag: 'lead' },
      nodes: [
        { id: 'trigger_1', type: 'trigger', config: { tag: 'lead' } },
        { id: 'email_1', type: 'action_email', config: { template: 'welcome' } }
      ]
    });
  });

  assert.ok(createdDef.id, 'Workflow definition should have an assigned UUID');
  assert.equal(createdDef.name, 'Lead Nurture Flow');
  assert.equal(createdDef.triggerType, 'tag');
  assert.equal(createdDef.nodes.length, 2);
  assert.equal(createdDef.version, 1);
  assert.equal(createdDef.status, 'draft');

  // 2. Tenant A can read the created workflow
  const fetchedDef = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.getWorkflowById(tx, createdDef.id);
  });
  assert.ok(fetchedDef, 'Tenant A should be able to fetch their workflow');
  assert.equal(fetchedDef.id, createdDef.id);

  // 3. Cross-Tenant Isolation: Tenant B cannot read Tenant A workflow
  const tenantBCantSeeDef = await runInTenantTx(pool, tenantB, async (tx) => {
    return repo.getWorkflowById(tx, createdDef.id);
  });
  assert.equal(tenantBCantSeeDef, null, 'Tenant B must not see Tenant A workflow definition');

  // 4. Update workflow definition
  const updatedDef = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.updateWorkflow(tx, createdDef.id, {
      name: 'Lead Nurture Flow v2',
      status: 'published'
    });
  });
  assert.equal(updatedDef.name, 'Lead Nurture Flow v2');
  assert.equal(updatedDef.status, 'published');
  assert.equal(updatedDef.version, 2, 'Version should be incremented upon update');

  // 5. Create Workflow Execution
  const createdExec = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.createExecution(tx, {
      workflowId: createdDef.id,
      status: 'running',
      triggerEvent: { contactId: 'contact-1', event: 'tag_added' },
      currentNodeId: 'email_1',
      state: { step: 1 }
    });
  });
  assert.ok(createdExec.id, 'Execution should have assigned UUID');
  assert.equal(createdExec.workflowId, createdDef.id);
  assert.equal(createdExec.status, 'running');

  // 6. Record Execution Step
  const recordedStep = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.recordExecutionStep(tx, {
      executionId: createdExec.id,
      nodeId: 'email_1',
      attempt: 1,
      status: 'completed',
      details: { sent: true, messageId: 'msg-123' }
    });
  });
  assert.ok(recordedStep.id, 'Step should have assigned UUID');
  assert.equal(recordedStep.status, 'completed');

  // 7. List Execution Steps
  const stepsList = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.listExecutionSteps(tx, createdExec.id);
  });
  assert.equal(stepsList.length, 1);
  assert.equal(stepsList[0].nodeId, 'email_1');

  // 8. Create Approval Gate
  const approval = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.createApproval(tx, {
      executionId: createdExec.id,
      workflowId: createdDef.id,
      nodeId: 'approval_gate_1',
      actionId: 'action_payout',
      actionHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      requestChecksum: 'b'.repeat(64)
    });
  });
  assert.ok(approval.id, 'Approval should have assigned UUID');
  assert.equal(approval.status, 'pending');

  // 9. List Pending Approvals
  const pendingApprovals = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.listPendingApprovals(tx);
  });
  assert.equal(pendingApprovals.length, 1);
  assert.equal(pendingApprovals[0].id, approval.id);

  // 10. Tenant B cannot see Tenant A approvals
  const tenantBApprovals = await runInTenantTx(pool, tenantB, async (tx) => {
    return repo.listPendingApprovals(tx);
  });
  assert.equal(tenantBApprovals.length, 0, 'Tenant B must not see Tenant A approvals');

  // 11. Delete workflow definition
  const deleted = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.deleteWorkflow(tx, createdDef.id);
  });
  assert.equal(deleted, true);

  const fetchedAfterDelete = await runInTenantTx(pool, tenantA, async (tx) => {
    return repo.getWorkflowById(tx, createdDef.id);
  });
  assert.equal(fetchedAfterDelete, null, 'Deleted workflow should not be found');
});
