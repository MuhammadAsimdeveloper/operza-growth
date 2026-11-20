/**
 * Workflow Execution PostgreSQL Relational Persistence Helpers
 * Enforces transaction-local tenant context, strict composite key scoping,
 * connection leak prevention, and fail-closed error propagation.
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

  const effectiveAgencyId = agencyId || execution.agencyId || flow?.agency_id;
  const effectiveLocationId = locationId || execution.locationId || flow?.location_id;

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
    const res = await client.query(`
      INSERT INTO workflow_executions (
        id, agency_id, location_id, workflow_id, status, trigger_event,
        attempts, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, now(), now())
      ON CONFLICT (agency_id, location_id, id) DO NOTHING
      RETURNING *
    `, [
      execution.id,
      effectiveAgencyId,
      effectiveLocationId,
      flow.id,
      execution.status,
      JSON.stringify(triggerContext || {})
    ]);
    await client.query('COMMIT');
    return res.rows[0] || null;
  } catch (dbErr) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Failed to persist workflow execution to PostgreSQL: ${dbErr.message}`), {
        code: dbErr.code === 'WORKFLOW_EXECUTION_LOCATION_REQUIRED' ? dbErr.code : 'WORKFLOW_EXECUTION_PERSIST_FAILED'
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

  const finalAgencyId = agencyId || execution.agencyId || flow?.agency_id;
  const finalLocationId = execution.locationId || locationId || flow?.location_id;

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
      throw Object.assign(new Error(`Failed to update workflow execution in PostgreSQL: ${pgErr.message}`), {
        code: pgErr.code === 'WORKFLOW_EXECUTION_LOCATION_REQUIRED' ? pgErr.code : 'WORKFLOW_EXECUTION_UPDATE_FAILED'
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
