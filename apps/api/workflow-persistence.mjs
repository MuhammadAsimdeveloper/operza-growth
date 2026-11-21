/**
 * Workflow Execution PostgreSQL Relational Persistence Helpers
 * Enforces transaction-local tenant context, strict composite key scoping,
 * connection leak prevention, authoritative location context, and fail-closed error propagation.
 */

export async function persistInitialWorkflowExecution({
  pgPool,
  agencyId,
  locationId,
  execution,
  flow,
  triggerContext = {},
  isStagingOrProd = false,
  platformDbEnabled = false
}) {
  if (!pgPool) return null;

  // Verify consistency between explicit arguments and execution object
  if (agencyId && execution?.agencyId && String(agencyId) !== String(execution.agencyId)) {
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Tenant agency mismatch: explicit agencyId (${agencyId}) does not match execution.agencyId (${execution.agencyId})`), {
        code: 'TENANT_CONTEXT_MISMATCH'
      });
    }
    console.warn(`[WORKFLOW-EXEC-PERSIST] Tenant agency mismatch: ${agencyId} vs ${execution.agencyId}`);
    return null;
  }

  if (locationId && execution?.locationId && String(locationId) !== String(execution.locationId)) {
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Tenant location mismatch: explicit locationId (${locationId}) does not match execution.locationId (${execution.locationId})`), {
        code: 'TENANT_CONTEXT_MISMATCH'
      });
    }
    console.warn(`[WORKFLOW-EXEC-PERSIST] Tenant location mismatch: ${locationId} vs ${execution.locationId}`);
    return null;
  }

  // Authoritative ordering: explicit parameter takes precedence over execution, then flow
  const effectiveAgencyId = agencyId || execution?.agencyId || flow?.agency_id;
  const effectiveLocationId = locationId || execution?.locationId || flow?.location_id;

  let client;
  try {
    if (!effectiveAgencyId || !effectiveLocationId) {
      if (isStagingOrProd || platformDbEnabled) {
        throw Object.assign(new Error('Workflow execution persistence requires both agencyId and locationId'), {
          code: 'WORKFLOW_EXECUTION_LOCATION_REQUIRED'
        });
      }
    }

    client = await pgPool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
      String(effectiveAgencyId),
      String(effectiveLocationId)
    ]);
    const workflowVersion = Number.isInteger(flow?.version) && flow.version > 0 ? flow.version : (execution?.workflowVersion || 1);
    const workflowSnapshot = flow ? JSON.stringify(flow) : (execution?.workflowSnapshot ? JSON.stringify(execution.workflowSnapshot) : null);

    const res = await client.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, trigger_event,
        workflow_version, workflow_snapshot, wait_generation,
        attempts, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, 0, 0, now(), now())
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
      RETURNING *
    `, [
      execution.id,
      effectiveAgencyId,
      effectiveLocationId,
      flow.id,
      execution.status,
      JSON.stringify(triggerContext || {}),
      workflowVersion,
      workflowSnapshot
    ]);
    await client.query('COMMIT');
    return res.rows[0] || null;
  } catch (dbErr) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (isStagingOrProd || platformDbEnabled) {
      const code = (dbErr.code === 'WORKFLOW_EXECUTION_LOCATION_REQUIRED' || dbErr.code === 'TENANT_CONTEXT_MISMATCH')
        ? dbErr.code
        : 'WORKFLOW_EXECUTION_PERSIST_FAILED';
      throw Object.assign(new Error(`Failed to persist workflow execution to PostgreSQL: ${dbErr.message}`), {
        code
      });
    }
    console.warn('[WORKFLOW-EXEC-PERSIST] DB insert warning:', dbErr.message);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function persistCompletedWorkflowExecution({
  pgPool,
  agencyId,
  locationId,
  execution,
  flow,
  isStagingOrProd = false,
  platformDbEnabled = false
}) {
  if (!pgPool) return null;

  // Verify consistency between explicit arguments and execution object
  if (agencyId && execution?.agencyId && String(agencyId) !== String(execution.agencyId)) {
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Tenant agency mismatch: explicit agencyId (${agencyId}) does not match execution.agencyId (${execution.agencyId})`), {
        code: 'TENANT_CONTEXT_MISMATCH'
      });
    }
    console.warn(`[WORKFLOW-EXEC-PERSIST] Tenant agency mismatch: ${agencyId} vs ${execution.agencyId}`);
    return null;
  }

  if (locationId && execution?.locationId && String(locationId) !== String(execution.locationId)) {
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Tenant location mismatch: explicit locationId (${locationId}) does not match execution.locationId (${execution.locationId})`), {
        code: 'TENANT_CONTEXT_MISMATCH'
      });
    }
    console.warn(`[WORKFLOW-EXEC-PERSIST] Tenant location mismatch: ${locationId} vs ${execution.locationId}`);
    return null;
  }

  // Authoritative ordering: explicit parameter takes precedence over execution, then flow
  const finalAgencyId = agencyId || execution?.agencyId || flow?.agency_id;
  const finalLocationId = locationId || execution?.locationId || flow?.location_id;

  let client;
  try {
    if (!finalAgencyId || !finalLocationId) {
      if (isStagingOrProd || platformDbEnabled) {
        throw Object.assign(new Error('Workflow execution update requires both agencyId and locationId'), {
          code: 'WORKFLOW_EXECUTION_LOCATION_REQUIRED'
        });
      }
    }

    client = await pgPool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
      String(finalAgencyId),
      String(finalLocationId)
    ]);
    const res = await client.query(`
      UPDATE workflow_executions SET
        status = $2,
        finished_at = CASE WHEN $2 IN ('completed', 'failed', 'canceled') THEN now() ELSE finished_at END,
        last_error_code = $3,
        state = $4::jsonb,
        updated_at = now()
      WHERE agency_id = $5 AND location_id = $6 AND id = $1
      RETURNING *
    `, [
      execution.id,
      execution.status,
      execution.lastErrorCode || null,
      JSON.stringify(execution.steps || []),
      finalAgencyId,
      finalLocationId
    ]);
    await client.query('COMMIT');
    return res.rows[0] || null;
  } catch (pgErr) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (isStagingOrProd || platformDbEnabled) {
      const code = (pgErr.code === 'WORKFLOW_EXECUTION_LOCATION_REQUIRED' || pgErr.code === 'TENANT_CONTEXT_MISMATCH')
        ? pgErr.code
        : 'WORKFLOW_EXECUTION_UPDATE_FAILED';
      throw Object.assign(new Error(`Failed to update workflow execution in PostgreSQL: ${pgErr.message}`), {
        code
      });
    }
    console.warn('[WORKFLOW-EXEC-PERSIST] DB update warning:', pgErr.message);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function persistWaitingWorkflowExecution({
  pgPool,
  agencyId,
  locationId,
  executionId,
  waitNodeId,
  resumeNodeId,
  retryAt,
  waitGeneration = 1,
  waitType = 'timed',
  variables = {},
  isStagingOrProd = false,
  platformDbEnabled = false
}) {
  if (!pgPool) return null;
  if (!agencyId || !locationId || !executionId) {
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error('persistWaitingWorkflowExecution requires agencyId, locationId, and executionId'), {
        code: 'WORKFLOW_EXECUTION_LOCATION_REQUIRED'
      });
    }
    return null;
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
      String(agencyId),
      String(locationId)
    ]);
    const res = await client.query(`
      UPDATE workflow_executions SET
        status = 'waiting',
        current_node_id = $2,
        resume_node_id = $3,
        retry_at = $4::timestamptz,
        wait_generation = $5,
        wait_type = $6,
        state = $7::jsonb,
        updated_at = now()
      WHERE agency_id = $8 AND location_id = $9 AND id = $1
      RETURNING *
    `, [
      executionId,
      waitNodeId,
      resumeNodeId || null,
      retryAt ? new Date(retryAt).toISOString() : null,
      Number(waitGeneration) || 1,
      waitType,
      JSON.stringify(variables || {}),
      agencyId,
      locationId
    ]);
    await client.query('COMMIT');
    return res.rows[0] || null;
  } catch (pgErr) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Failed to update waiting workflow execution in PostgreSQL: ${pgErr.message}`), {
        code: 'WORKFLOW_WAITING_PERSIST_FAILED'
      });
    }
    console.warn('[WORKFLOW-WAITING-PERSIST] DB update warning:', pgErr.message);
    return null;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export async function loadAuthoritativeWorkflowExecution({
  pgPool,
  agencyId,
  locationId,
  executionId
}) {
  if (!pgPool || !agencyId || !locationId || !executionId) return null;

  let client;
  try {
    client = await pgPool.connect();
    await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
      String(agencyId),
      String(locationId)
    ]);
    const res = await client.query(`
      SELECT id, agency_id, location_id, workflow_id, status, trigger_event,
             current_node_id, resume_node_id, wait_generation, wait_type, retry_at,
             workflow_version, workflow_snapshot, state, attempts, last_error_code,
             finished_at, created_at, updated_at
      FROM workflow_executions
      WHERE agency_id = $1 AND location_id = $2 AND id = $3
    `, [agencyId, locationId, executionId]);
    return res.rows[0] || null;
  } finally {
    if (client) {
      client.release();
    }
  }
}
