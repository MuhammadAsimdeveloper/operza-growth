import { randomUUID } from 'node:crypto';
import {
  canTransitionConversation,
  canTransitionCampaign,
  validateTemplate,
  buildRecipientIdempotencyKey,
  ENGAGEMENT_METRIC_DEFINITIONS
} from '../../platform-core/src/engagement-2-0.mjs';

function scope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) throw new Error('Engagement2Repository requires agencyId and locationId');
  return { agencyId: a, locationId: l };
}

export function createEngagement2Repository() {
  return {
    async listTemplates(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM engagement_templates
         WHERE agency_id = $1 AND location_id = $2
         ORDER BY updated_at DESC`,
        [s.agencyId, s.locationId]
      );
      return res.rows;
    },

    async createTemplate(tx, input = {}) {
      const s = scope(tx, input.agencyId, input.locationId);
      const check = validateTemplate({
        channel: input.channel,
        body: input.body,
        approvalStatus: input.approvalStatus || 'draft',
        providerTemplateId: input.providerTemplateId || null
      });
      if (!check.valid) {
        throw Object.assign(new Error(check.error), { code: check.code });
      }
      const id = input.id || randomUUID();
      const res = await tx.query(
        `INSERT INTO engagement_templates (
          agency_id, location_id, id, name, channel, subject, body,
          variables_schema, approval_status, provider_template_id, version, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *`,
        [
          s.agencyId,
          s.locationId,
          id,
          String(input.name || 'Untitled Template').trim(),
          input.channel,
          input.subject || null,
          input.body,
          JSON.stringify(check.variables || []),
          input.approvalStatus || 'draft',
          input.providerTemplateId || null,
          Number(input.version || 1),
          input.createdBy || tx?.actorId || 'system'
        ]
      );
      return res.rows[0];
    },

    async listCampaigns(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM engagement_campaigns
         WHERE agency_id = $1 AND location_id = $2
         ORDER BY updated_at DESC`,
        [s.agencyId, s.locationId]
      );
      return res.rows;
    },

    async createCampaign(tx, input = {}) {
      const s = scope(tx, input.agencyId, input.locationId);
      const id = input.id || randomUUID();
      const res = await tx.query(
        `INSERT INTO engagement_campaigns (
          agency_id, location_id, id, name, objective, channel, status,
          smart_list_id, audience_snapshot, template_id, subject, body,
          timezone, send_window, scheduled_at, total_recipients, eligible_recipients, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        RETURNING *`,
        [
          s.agencyId,
          s.locationId,
          id,
          String(input.name || 'Untitled Campaign').trim(),
          input.objective || 'engagement',
          input.channel || 'email',
          input.smartListId || null,
          JSON.stringify(input.audienceSnapshot || {}),
          input.templateId || null,
          input.subject || null,
          input.body || '',
          input.timezone || 'UTC',
          JSON.stringify(input.sendWindow || { startHour: 8, endHour: 20 }),
          input.scheduledAt || null,
          Number(input.totalRecipients || 0),
          Number(input.eligibleRecipients || 0),
          input.createdBy || tx?.actorId || 'system'
        ]
      );
      return res.rows[0];
    },

    async transitionCampaignStatus(tx, { agencyId, locationId, campaignId, toStatus, actorId = 'system' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const cur = await tx.query(
        `SELECT * FROM engagement_campaigns WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [s.agencyId, s.locationId, campaignId]
      );
      if (cur.rows.length === 0) return null;
      const existing = cur.rows[0];
      if (!canTransitionCampaign(existing.status, toStatus)) {
        throw Object.assign(new Error(`Invalid campaign transition: ${existing.status} -> ${toStatus}`), {
          code: 'INVALID_CAMPAIGN_TRANSITION'
        });
      }
      const res = await tx.query(
        `UPDATE engagement_campaigns
         SET status = $4,
             approved_by = CASE WHEN $4 = 'approved' THEN $5 ELSE approved_by END,
             approved_at = CASE WHEN $4 = 'approved' THEN now() ELSE approved_at END,
             updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [s.agencyId, s.locationId, campaignId, toStatus, actorId]
      );
      return res.rows[0];
    },

    async enqueueCampaignRecipients(tx, { agencyId, locationId, campaignId, channel, recipients = [] } = {}) {
      const s = scope(tx, agencyId, locationId);
      const inserted = [];
      for (const r of recipients) {
        const idempotencyKey = buildRecipientIdempotencyKey({
          agencyId: s.agencyId,
          locationId: s.locationId,
          campaignId,
          contactId: r.contactId
        });
        const res = await tx.query(
          `INSERT INTO engagement_campaign_recipients (
            agency_id, location_id, id, campaign_id, contact_id, channel, destination, delivery_state, idempotency_key
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (agency_id, location_id, campaign_id, contact_id) DO NOTHING
          RETURNING *`,
          [
            s.agencyId,
            s.locationId,
            randomUUID(),
            campaignId,
            r.contactId,
            channel,
            r.destination || null,
            r.suppressed ? 'suppressed' : 'queued',
            idempotencyKey
          ]
        );
        if (res.rows[0]) inserted.push(res.rows[0]);
      }
      return inserted;
    },

    async listSuppressions(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM engagement_suppression_list
         WHERE agency_id = $1 AND location_id = $2
         ORDER BY created_at DESC`,
        [s.agencyId, s.locationId]
      );
      return res.rows;
    },

    async addSuppression(tx, { agencyId, locationId, channel = 'all', identifier, contactId = null, reason = 'opt_out', source = 'manual' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `INSERT INTO engagement_suppression_list (
          agency_id, location_id, id, channel, identifier, contact_id, reason, source
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (agency_id, location_id, channel, identifier) DO UPDATE
          SET reason = EXCLUDED.reason, source = EXCLUDED.source
        RETURNING *`,
        [s.agencyId, s.locationId, randomUUID(), channel, String(identifier).trim().toLowerCase(), contactId, reason, source]
      );
      return res.rows[0];
    },

    async addConversationNote(tx, { agencyId, locationId, conversationId, authorId, authorName, body } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `INSERT INTO engagement_conversation_notes (
          agency_id, location_id, id, conversation_id, author_id, author_name, body
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *`,
        [s.agencyId, s.locationId, randomUUID(), conversationId, authorId || 'system', authorName || 'Agent', body]
      );
      return res.rows[0];
    },

    async updateConversationMeta(tx, { agencyId, locationId, conversationId, status, priority, assignedTo, actorId = 'system' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const cur = await tx.query(
        `SELECT * FROM conversations WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [s.agencyId, s.locationId, conversationId]
      );
      if (cur.rows.length === 0) return null;
      const existing = cur.rows[0];
      if (status && !canTransitionConversation(existing.status, status)) {
        throw Object.assign(new Error(`Invalid conversation transition: ${existing.status} -> ${status}`), {
          code: 'INVALID_CONVERSATION_TRANSITION'
        });
      }
      const nextStatus = status || existing.status;
      const nextPriority = priority || existing.priority || 'normal';
      const nextAssigned = assignedTo !== undefined ? assignedTo : existing.assigned_to;
      const res = await tx.query(
        `UPDATE conversations
         SET status = $4, priority = $5, assigned_to = $6, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
         RETURNING *`,
        [s.agencyId, s.locationId, conversationId, nextStatus, nextPriority, nextAssigned]
      );
      await tx.query(
        `INSERT INTO engagement_conversation_history (
          agency_id, location_id, id, conversation_id, actor_id, event_type, from_value, to_value
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          s.agencyId,
          s.locationId,
          randomUUID(),
          conversationId,
          actorId,
          status ? 'status_change' : 'assignment_or_priority',
          `${existing.status}:${existing.assigned_to || ''}`,
          `${nextStatus}:${nextAssigned || ''}`
        ]
      );
      return res.rows[0];
    },

    async enrollJourney(tx, { agencyId, locationId, workflowId, executionId = null, contactId, journeyKey } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `INSERT INTO engagement_journey_enrollments (
          agency_id, location_id, id, workflow_id, execution_id, contact_id, journey_key, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')
        ON CONFLICT (agency_id, location_id, journey_key, contact_id) DO NOTHING
        RETURNING *`,
        [s.agencyId, s.locationId, randomUUID(), workflowId, executionId, contactId, journeyKey]
      );
      return { enrolled: res.rows.length > 0, record: res.rows[0] || null };
    },

    async getEngagementAnalytics(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const [conv, camp, recips, sup, journeys] = await Promise.all([
        tx.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'resolved')::int AS resolved FROM conversations WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId]),
        tx.query(`SELECT count(*)::int AS total FROM engagement_campaigns WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId]),
        tx.query(`SELECT count(*) FILTER (WHERE delivery_state = 'delivered')::int AS delivered, count(*) FILTER (WHERE delivery_state = 'failed')::int AS failed, count(*) FILTER (WHERE delivery_state = 'suppressed')::int AS suppressed FROM engagement_campaign_recipients WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId]),
        tx.query(`SELECT count(*)::int AS total FROM engagement_suppression_list WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId]),
        tx.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'active')::int AS active FROM engagement_journey_enrollments WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId])
      ]);
      return {
        conversations: conv.rows[0],
        campaigns: camp.rows[0],
        deliveries: recips.rows[0],
        suppressions: sup.rows[0],
        journeys: journeys.rows[0],
        definitions: ENGAGEMENT_METRIC_DEFINITIONS
      };
    }
  };
}
