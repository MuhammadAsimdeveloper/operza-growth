/**
 * ============================================================================
 * Operza Workflows Repository — Domain Boundary
 * ============================================================================
 * Encapsulates all Workflow Definition, Execution, Step, and Approval persistence logic
 * strictly through TenantTx instances, enforcing multi-tenant PostgreSQL Row Level Security (RLS)
 * on dedicated relational tables:
 * - workflow_definitions
 * - workflow_executions
 * - workflow_execution_steps
 * - workflow_approvals
 */

import { randomUUID } from 'node:crypto';

const VALID_WORKFLOW_STATUSES = new Set(['draft', 'published', 'paused', 'archived']);
const VALID_TRIGGER_TYPES = new Set([
  'form', 'tag', 'appointment', 'opportunity_stage',
  'invoice', 'payment', 'webhook', 'schedule', 'manual'
]);

const VALID_EXECUTION_STATUSES = new Set([
  'pending', 'running', 'waiting', 'waiting_approval',
  'completed', 'failed', 'canceled', 'dead_letter'
]);

const VALID_STEP_STATUSES = new Set([
  'running', 'completed', 'failed', 'waiting_approval', 'skipped'
]);

const VALID_APPROVAL_STATUSES = new Set([
  'pending', 'approved', 'rejected', 'expired', 'canceled'
]);

/**
 * Normalizes a database row from the `workflow_definitions` table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
export function normalizeWorkflowRow(row) {
  if (!row) return null;
  const nodes = typeof row.nodes === 'string'
    ? JSON.parse(row.nodes)
    : (row.nodes || []);
  const triggerConfig = typeof row.trigger_config === 'string'
    ? JSON.parse(row.trigger_config)
    : (row.trigger_config || {});

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    name: row.name,
    status: row.status || 'draft',
    triggerType: row.trigger_type || row.triggerType || 'manual',
    triggerConfig,
    trigger: triggerConfig?.kind ? triggerConfig : { kind: row.trigger_type || row.triggerType || 'manual', ...triggerConfig },
    nodes,
    version: Number(row.version) || 1,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

/**
 * Normalizes a database row from the `workflow_executions` table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
export function normalizeExecutionRow(row) {
  if (!row) return null;
  const triggerEvent = typeof row.trigger_event === 'string'
    ? JSON.parse(row.trigger_event)
    : (row.trigger_event || {});
  const state = typeof row.state === 'string'
    ? JSON.parse(row.state)
    : (row.state || {});

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    workflowId: row.workflow_id || row.workflowId,
    status: row.status || 'pending',
    triggerEvent,
    triggerContext: triggerEvent,
    currentNodeId: row.current_node_id || row.currentNodeId || null,
    resumeNodeId: row.resume_node_id || row.resumeNodeId || null,
    waitGeneration: Number(row.wait_generation ?? row.waitGeneration) || 0,
    waitType: row.wait_type || row.waitType || null,
    state,
    stateChecksum: row.state_checksum || row.stateChecksum || null,
    leasedBy: row.leased_by || row.leasedBy || null,
    leaseExpiresAt: row.lease_expires_at?.toISOString?.() || row.lease_expires_at || null,
    attempts: Number(row.attempts) || 0,
    lastErrorCode: row.last_error_code || row.lastErrorCode || null,
    retryAt: row.retry_at?.toISOString?.() || row.retry_at || null,
    finishedAt: row.finished_at?.toISOString?.() || row.finished_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

/**
 * Normalizes a database row from the `workflow_execution_steps` table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
export function normalizeStepRow(row) {
  if (!row) return null;
  const details = typeof row.details === 'string'
    ? JSON.parse(row.details)
    : (row.details || {});

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    executionId: row.execution_id || row.executionId,
    nodeId: row.node_id || row.nodeId,
    attempt: Number(row.attempt) || 1,
    status: row.status || 'running',
    details,
    errorCode: row.error_code || row.errorCode || null,
    startedAt: row.started_at?.toISOString?.() || row.started_at,
    finishedAt: row.finished_at?.toISOString?.() || row.finished_at || null
  };
}

/**
 * Normalizes a database row from the `workflow_approvals` table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
export function normalizeApprovalRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    executionId: row.execution_id || row.executionId,
    workflowId: row.workflow_id || row.workflowId,
    nodeId: row.node_id || row.nodeId,
    actionId: row.action_id || row.actionId,
    actionHash: row.action_hash || row.actionHash,
    requestedBy: row.requested_by || row.requestedBy || null,
    decidedBy: row.decided_by || row.decidedBy || null,
    status: row.status || 'pending',
    requestedAt: row.requested_at?.toISOString?.() || row.requested_at,
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at,
    decidedAt: row.decided_at?.toISOString?.() || row.decided_at || null,
    requestChecksum: row.request_checksum || row.requestChecksum,
    decisionChecksum: row.decision_checksum || row.decisionChecksum || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

/**
 * Creates an instance of the Workflows repository.
 *
 * @returns {any}
 */
export function createWorkflowsRepository() {
  return {
    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW DEFINITIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Creates a workflow definition.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async createWorkflow(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_WORKFLOW_PAYLOAD: Payload must be an object');
      }

      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (name.length < 2 || name.length > 150) {
        throw new Error('INVALID_WORKFLOW_NAME: Name must be between 2 and 150 characters');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'draft';
      if (!VALID_WORKFLOW_STATUSES.has(status)) {
        status = 'draft';
      }

      let triggerType = typeof data.triggerType === 'string' ? data.triggerType.trim().toLowerCase() : (data.trigger_type || 'manual');
      if (!VALID_TRIGGER_TYPES.has(triggerType)) {
        triggerType = 'manual';
      }

      const triggerConfig = data.triggerConfig && typeof data.triggerConfig === 'object' ? data.triggerConfig : {};
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const version = Number.isInteger(data.version) && data.version > 0 ? data.version : 1;

      const now = new Date();

      const sql = `
        INSERT INTO workflow_definitions (
          id, agency_id, location_id, name, status, trigger_type,
          trigger_config, nodes, version, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11
        ) RETURNING *
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        name,
        status,
        triggerType,
        JSON.stringify(triggerConfig),
        JSON.stringify(nodes),
        version,
        now,
        now
      ];

      const res = await tx.query(sql, params);
      return normalizeWorkflowRow(res.rows[0]);
    },

    /**
     * Retrieves a workflow definition by ID within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async getWorkflowById(tx, id) {
      if (!id) return null;
      const sql = `
        SELECT * FROM workflow_definitions
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      if (res.rows.length === 0) return null;
      return normalizeWorkflowRow(res.rows[0]);
    },

    /**
     * Lists workflow definitions for the current tenant location.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} [options]
     * @returns {Promise<any[]>}
     */
    async listWorkflows(tx, options = {}) {
      const { status } = options;
      let sql = `
        SELECT * FROM workflow_definitions
        WHERE agency_id = $1 AND location_id = $2
      `;
      const params = [tx.agencyId, tx.locationId];

      if (status && VALID_WORKFLOW_STATUSES.has(status)) {
        params.push(status);
        sql += ` AND status = $${params.length}`;
      }

      sql += ` ORDER BY created_at DESC`;

      const res = await tx.query(sql, params);
      return res.rows.map(normalizeWorkflowRow);
    },

    /**
     * Updates a workflow definition.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {any} data
     * @returns {Promise<any|null>}
     */
    async updateWorkflow(tx, id, data) {
      if (!id || !data) return null;

      const current = await this.getWorkflowById(tx, id);
      if (!current) return null;

      const name = typeof data.name === 'string' ? data.name.trim() : current.name;
      const status = typeof data.status === 'string' && VALID_WORKFLOW_STATUSES.has(data.status.trim().toLowerCase())
        ? data.status.trim().toLowerCase()
        : current.status;
      const triggerType = typeof data.triggerType === 'string' && VALID_TRIGGER_TYPES.has(data.triggerType.trim().toLowerCase())
        ? data.triggerType.trim().toLowerCase()
        : current.triggerType;
      const triggerConfig = data.triggerConfig && typeof data.triggerConfig === 'object' ? data.triggerConfig : current.triggerConfig;
      const nodes = Array.isArray(data.nodes) ? data.nodes : current.nodes;
      const expectedVersion = data.expectedVersion !== undefined
        ? Number(data.expectedVersion)
        : (data.version !== undefined ? Number(data.version) : null);

      if (expectedVersion !== null && expectedVersion !== current.version) {
        throw Object.assign(
          new Error(`Workflow version conflict: expected version ${expectedVersion}, current version is ${current.version}`),
          { code: 'VERSION_CONFLICT', expectedVersion, currentVersion: current.version }
        );
      }

      const nextVersion = current.version + 1;

      const sql = `
        UPDATE workflow_definitions
        SET name = $1, status = $2, trigger_type = $3, trigger_config = $4,
            nodes = $5, version = $6, updated_at = now()
        WHERE agency_id = $7 AND location_id = $8 AND id = $9 AND version = $10
        RETURNING *
      `;

      const params = [
        name,
        status,
        triggerType,
        JSON.stringify(triggerConfig),
        JSON.stringify(nodes),
        nextVersion,
        tx.agencyId,
        tx.locationId,
        id,
        current.version
      ];

      const res = await tx.query(sql, params);
      if (res.rows.length === 0) {
        throw Object.assign(
          new Error('Workflow version conflict: concurrent modification detected'),
          { code: 'VERSION_CONFLICT', expectedVersion: current.version }
        );
      }
      return normalizeWorkflowRow(res.rows[0]);
    },

    /**
     * Deletes a workflow definition.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteWorkflow(tx, id) {
      if (!id) return false;
      const sql = `
        DELETE FROM workflow_definitions
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      return (res.rowCount || 0) > 0;
    },

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW EXECUTIONS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Creates an initial workflow execution.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async createExecution(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_EXECUTION_PAYLOAD: Payload must be an object');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const workflowId = data.workflowId || data.workflow_id;
      if (!workflowId) {
        throw new Error('WORKFLOW_ID_REQUIRED: workflowId is required for execution');
      }

      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'pending';
      if (!VALID_EXECUTION_STATUSES.has(status)) {
        status = 'pending';
      }

      const triggerEvent = data.triggerEvent || data.triggerContext || {};
      const currentNodeId = data.currentNodeId || data.current_node_id || null;
      const resumeNodeId = data.resumeNodeId || data.resume_node_id || null;
      const waitGeneration = Number(data.waitGeneration ?? data.wait_generation) || 0;
      const waitType = data.waitType || data.wait_type || null;
      const state = data.state || {};
      const attempts = Number(data.attempts) || 0;
      const now = new Date();

      const sql = `
        INSERT INTO workflow_executions (
          id, agency_id, location_id, workflow_id, status, trigger_event,
          current_node_id, resume_node_id, wait_generation, wait_type,
          state, attempts, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14
        ) RETURNING *
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        workflowId,
        status,
        JSON.stringify(triggerEvent),
        currentNodeId,
        resumeNodeId,
        waitGeneration,
        waitType,
        JSON.stringify(state),
        attempts,
        now,
        now
      ];

      const res = await tx.query(sql, params);
      return normalizeExecutionRow(res.rows[0]);
    },

    /**
     * Retrieves an execution by ID.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async getExecutionById(tx, id) {
      if (!id) return null;
      const sql = `
        SELECT * FROM workflow_executions
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      if (res.rows.length === 0) return null;
      return normalizeExecutionRow(res.rows[0]);
    },

    /**
     * Lists workflow executions for the tenant.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} [options]
     * @returns {Promise<any[]>}
     */
    async listExecutions(tx, options = {}) {
      const sql = `
        SELECT * FROM workflow_executions
        WHERE agency_id = $1 AND location_id = $2
        ORDER BY created_at DESC
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId]);
      return res.rows.map(normalizeExecutionRow);
    },

    /**
     * Records a step execution inside workflow_execution_steps.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async recordExecutionStep(tx, data) {
      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const executionId = data.executionId || data.execution_id;
      const nodeId = data.nodeId || data.node_id;
      const attempt = Number(data.attempt) || 1;
      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'running';
      if (!VALID_STEP_STATUSES.has(status)) {
        status = 'running';
      }

      const details = data.details || {};
      const errorCode = data.errorCode || data.error_code || null;
      const startedAt = data.startedAt ? new Date(data.startedAt) : new Date();
      const finishedAt = data.finishedAt ? new Date(data.finishedAt) : (['completed', 'failed', 'skipped'].includes(status) ? new Date() : null);

      const sql = `
        INSERT INTO workflow_execution_steps (
          id, agency_id, location_id, execution_id, node_id, attempt,
          status, details, error_code, started_at, finished_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11
        ) RETURNING *
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        executionId,
        nodeId,
        attempt,
        status,
        JSON.stringify(details),
        errorCode,
        startedAt,
        finishedAt
      ];

      const res = await tx.query(sql, params);
      return normalizeStepRow(res.rows[0]);
    },

    /**
     * Lists execution steps for an execution.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} executionId
     * @returns {Promise<any[]>}
     */
    async listExecutionSteps(tx, executionId) {
      if (!executionId) return [];
      const sql = `
        SELECT * FROM workflow_execution_steps
        WHERE agency_id = $1 AND location_id = $2 AND execution_id = $3
        ORDER BY started_at ASC
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, executionId]);
      return res.rows.map(normalizeStepRow);
    },

    // ═════════════════════════════════════════════════════════════════════════
    // WORKFLOW APPROVALS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Creates an approval gate.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async createApproval(tx, data) {
      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const executionId = data.executionId || data.execution_id;
      const workflowId = data.workflowId || data.workflow_id;
      const nodeId = data.nodeId || data.node_id;
      const actionId = data.actionId || data.action_id;
      const actionHash = data.actionHash || data.action_hash;
      const requestedBy = data.requestedBy || data.requested_by || null;
      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'pending';
      if (!VALID_APPROVAL_STATUSES.has(status)) {
        status = 'pending';
      }

      const requestedAt = data.requestedAt ? new Date(data.requestedAt) : new Date();
      const expiresAt = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 86400000);
      const requestChecksum = data.requestChecksum || data.request_checksum || '0'.repeat(64);

      const sql = `
        INSERT INTO workflow_approvals (
          id, agency_id, location_id, execution_id, workflow_id, node_id, action_id,
          action_hash, requested_by, status, requested_at, expires_at, request_checksum
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13
        ) RETURNING *
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        executionId,
        workflowId,
        nodeId,
        actionId,
        actionHash,
        requestedBy,
        status,
        requestedAt,
        expiresAt,
        requestChecksum
      ];

      const res = await tx.query(sql, params);
      return normalizeApprovalRow(res.rows[0]);
    },

    /**
     * Lists pending approvals for the location.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @returns {Promise<any[]>}
     */
    async listPendingApprovals(tx) {
      const sql = `
        SELECT * FROM workflow_approvals
        WHERE agency_id = $1 AND location_id = $2 AND status = 'pending'
        ORDER BY requested_at DESC
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId]);
      return res.rows.map(normalizeApprovalRow);
    },

    /**
     * Records a decision on an approval gate.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {any} decisionData
     * @returns {Promise<any|null>}
     */
    async decideApproval(tx, id, { status, decisionChecksum, decidedBy }) {
      if (!id || !['approved', 'rejected', 'canceled'].includes(status)) return null;

      const sql = `
        UPDATE workflow_approvals
        SET status = $1, decision_checksum = $2, decided_by = $3, decided_at = now(), updated_at = now()
        WHERE agency_id = $4 AND location_id = $5 AND id = $6
        RETURNING *
      `;

      const params = [
        status,
        decisionChecksum || null,
        decidedBy || null,
        tx.agencyId,
        tx.locationId,
        id
      ];

      const res = await tx.query(sql, params);
      if (res.rows.length === 0) return null;
      return normalizeApprovalRow(res.rows[0]);
    }
  };
}
