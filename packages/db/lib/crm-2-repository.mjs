/**
 * Product Advancement Stage 1 — CRM 2.0 Repository (TenantTx)
 * Implements Customer 360° aggregation, concurrency-safe contact merging
 * with FOR UPDATE locking & audit trail, duplicate detection, Smart Lists,
 * and Custom Field definitions.
 */

import { randomUUID } from 'node:crypto';
import {
  detectDuplicateCandidates,
  evaluateSmartListAst,
  validateSmartListAst
} from '../../platform-core/src/crm/crm-2-0.mjs';

function normalizeContactRow(row) {
  const body = typeof row.body === 'string' ? JSON.parse(row.body) : (row.body || {});
  return {
    ...body,
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function createCrm2Repository() {
  return {
    async findDuplicates(tx) {
      const res = await tx.query(
        `SELECT id, agency_id, location_id, body, created_at, updated_at
         FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts'
         ORDER BY created_at ASC LIMIT 5000`,
        [tx.agencyId, tx.locationId]
      );
      return detectDuplicateCandidates(res.rows.map(normalizeContactRow));
    },

    async mergeContactsSafely(tx, { primaryId, mergeIds = [], mergedBy = 'system' } = {}) {
      if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
        throw Object.assign(new TypeError('primaryId and non-empty mergeIds are required'), { code: 'INVALID_MERGE_INPUT' });
      }
      const uniqueIds = Array.from(new Set([primaryId, ...mergeIds])).sort();
      // Acquire row-level locks in deterministic UUID order to prevent deadlocks / concurrent merge races
      const lockRes = await tx.query(
        `SELECT id, agency_id, location_id, body, created_at, updated_at
         FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = ANY($3::uuid[])
         ORDER BY id ASC
         FOR UPDATE`,
        [tx.agencyId, tx.locationId, uniqueIds]
      );

      const byId = new Map(lockRes.rows.map((r) => [r.id, normalizeContactRow(r)]));
      const primary = byId.get(primaryId);
      if (!primary) {
        throw Object.assign(new Error(`Primary contact ${primaryId} not found`), { code: 'CONTACT_NOT_FOUND' });
      }

      const merged = [];
      const mergedFields = { ...primary };
      const secondaryIds = mergeIds.filter((id) => id && id !== primaryId);

      for (const dupId of secondaryIds) {
        const dup = byId.get(dupId);
        if (!dup) {
          throw Object.assign(new Error(`Secondary contact ${dupId} not found or already merged`), {
            code: 'MERGE_CONFLICT'
          });
        }
        for (const f of ['firstName', 'lastName', 'email', 'phone', 'company', 'source', 'notes', 'ownerId', 'lifecycleStage']) {
          if (!mergedFields[f] && dup[f]) mergedFields[f] = dup[f];
        }
        mergedFields.tags = Array.from(new Set([...(mergedFields.tags || []), ...(dup.tags || [])]));
        mergedFields.customFields = { ...(dup.customFields || {}), ...(mergedFields.customFields || {}) };
        merged.push(dupId);
      }

      // Re-link all relational child records atomically inside TenantTx
      for (const dupId of merged) {
        await tx.query(`UPDATE opportunities SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(`UPDATE appointments SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(`UPDATE tasks SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(`UPDATE conversations SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(`UPDATE invoices SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(`UPDATE reviews SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(`UPDATE form_submissions SET contact_id = $1 WHERE agency_id = $3 AND location_id = $4 AND contact_id = $2`, [primaryId, dupId, tx.agencyId, tx.locationId]);
        await tx.query(
          `UPDATE location_records
           SET body = jsonb_set(body, '{contactId}', to_jsonb($1::text)), updated_at = now()
           WHERE agency_id = $3 AND location_id = $4 AND collection IN ('tasks', 'notes', 'opportunities')
             AND body->>'contactId' = $2`,
          [primaryId, dupId, tx.agencyId, tx.locationId]
        );
        await tx.query(
          `DELETE FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = $3`,
          [tx.agencyId, tx.locationId, dupId]
        );
      }

      const updRes = await tx.query(
        `UPDATE location_records SET body = $4::jsonb, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = $3
         RETURNING *`,
        [tx.agencyId, tx.locationId, primaryId, JSON.stringify(mergedFields)]
      );

      await tx.query(
        `INSERT INTO crm_contact_merge_audit (
          agency_id, location_id, id, primary_contact_id, merged_contact_ids, merged_by, snapshot_diff
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)`,
        [
          tx.agencyId,
          tx.locationId,
          randomUUID(),
          primaryId,
          JSON.stringify(merged),
          mergedBy,
          JSON.stringify({ tags: mergedFields.tags })
        ]
      );

      return {
        success: true,
        primaryId,
        mergedIds: merged,
        contact: normalizeContactRow(updRes.rows[0])
      };
    },

    async getCustomer360Profile(tx, contactId, { timelineLimit = 25, timelineOffset = 0 } = {}) {
      const cRes = await tx.query(
        `SELECT * FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = $3`,
        [tx.agencyId, tx.locationId, contactId]
      );
      if (cRes.rows.length === 0) return null;
      const contact = normalizeContactRow(cRes.rows[0]);

      const opps = await tx.query(`SELECT id, name, status, value, stage_id, created_at FROM opportunities WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY created_at DESC`, [tx.agencyId, tx.locationId, contactId]);
      const tasks = await tx.query(`SELECT id, title, status, priority, due_date, created_at FROM tasks WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY created_at DESC`, [tx.agencyId, tx.locationId, contactId]);
      const appts = await tx.query(`SELECT id, calendar_id, title, starts_at, ends_at, status, created_at FROM appointments WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY starts_at DESC`, [tx.agencyId, tx.locationId, contactId]);
      const convs = await tx.query(`SELECT id, channel, status, last_message_at, created_at FROM conversations WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY created_at DESC`, [tx.agencyId, tx.locationId, contactId]);
      const consents = await tx.query(`SELECT id, channel, status, source, created_at FROM communication_consents WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3`, [tx.agencyId, tx.locationId, contactId]);
      const invoices = await tx.query(`SELECT id, invoice_number, amount_cents, paid_cents, currency, status, created_at FROM invoices WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY created_at DESC`, [tx.agencyId, tx.locationId, contactId]);
      const payments = await tx.query(
        `SELECT p.currency, p.status, COALESCE(SUM(p.amount_cents), 0)::bigint AS total_cents
         FROM payments p
         JOIN orders o ON o.agency_id = p.agency_id AND o.location_id = p.location_id AND o.id = p.order_id
         WHERE p.agency_id = $1 AND p.location_id = $2 AND o.contact_id = $3
         GROUP BY p.currency, p.status`,
        [tx.agencyId, tx.locationId, contactId]
      );
      const reviews = await tx.query(`SELECT id, rating, status, text AS comment, created_at FROM reviews WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY created_at DESC`, [tx.agencyId, tx.locationId, contactId]);
      const forms = await tx.query(`SELECT id, form_id, created_at FROM form_submissions WHERE agency_id = $1 AND location_id = $2 AND contact_id = $3 ORDER BY created_at DESC`, [tx.agencyId, tx.locationId, contactId]);

      const allEvents = [
        { type: 'contact_created', date: contact.createdAt, summary: `Contact created (${contact.source || 'manual'})` },
        ...opps.rows.map((o) => ({ type: 'opportunity', id: o.id, date: o.created_at, summary: `Opportunity: ${o.name} (${o.status})` })),
        ...tasks.rows.map((t) => ({ type: 'task', id: t.id, date: t.created_at, summary: `Task: ${t.title} (${t.status})` })),
        ...appts.rows.map((a) => ({ type: 'appointment', id: a.id, date: a.starts_at, summary: `Appointment: ${a.title} (${a.status})` })),
        ...convs.rows.map((c) => ({ type: 'conversation', id: c.id, date: c.last_message_at || c.created_at, summary: `Conversation via ${c.channel} (${c.status})` })),
        ...invoices.rows.map((i) => ({ type: 'invoice', id: i.id, date: i.created_at, summary: `Invoice #${i.invoice_number} (${i.status})` })),
        ...reviews.rows.map((r) => ({ type: 'review', id: r.id, date: r.created_at, summary: `Review (${r.rating}/5)` })),
        ...forms.rows.map((f) => ({ type: 'form_submission', id: f.id, date: f.created_at, summary: `Form submitted` }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const safeLimit = Math.min(100, Math.max(1, Number(timelineLimit) || 25));
      const safeOffset = Math.max(0, Number(timelineOffset) || 0);

      return {
        contact,
        opportunities: opps.rows,
        tasks: tasks.rows,
        appointments: appts.rows,
        conversations: convs.rows,
        consents: consents.rows,
        invoices: invoices.rows,
        customerValueByCurrency: payments.rows,
        reviews: reviews.rows,
        formSubmissions: forms.rows,
        timeline: {
          total: allEvents.length,
          limit: safeLimit,
          offset: safeOffset,
          items: allEvents.slice(safeOffset, safeOffset + safeLimit)
        }
      };
    },

    async createCustomFieldDef(tx, { fieldKey, label, fieldType, options = [], required = false } = {}) {
      const res = await tx.query(
        `INSERT INTO crm_custom_field_defs (agency_id, location_id, id, field_key, label, field_type, options, required)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING *`,
        [tx.agencyId, tx.locationId, randomUUID(), fieldKey, label, fieldType, JSON.stringify(options), Boolean(required)]
      );
      return res.rows[0];
    },

    async listCustomFieldDefs(tx) {
      const res = await tx.query(
        `SELECT * FROM crm_custom_field_defs WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at ASC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async createSmartList(tx, { name, description = '', filterAst = { op: 'and', rules: [] }, createdBy = 'system' } = {}) {
      validateSmartListAst(filterAst);
      const res = await tx.query(
        `INSERT INTO crm_smart_lists (agency_id, location_id, id, name, description, filter_ast, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         RETURNING *`,
        [tx.agencyId, tx.locationId, randomUUID(), name.trim(), description, JSON.stringify(filterAst), createdBy]
      );
      return res.rows[0];
    },

    async listSmartLists(tx) {
      const res = await tx.query(
        `SELECT * FROM crm_smart_lists WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows;
    },

    async evaluateSmartList(tx, smartListId, { limit = 50, offset = 0 } = {}) {
      const slRes = await tx.query(
        `SELECT * FROM crm_smart_lists WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, smartListId]
      );
      const smartList = slRes.rows[0];
      if (!smartList) return null;

      validateSmartListAst(smartList.filter_ast);
      const contactsRes = await tx.query(
        `SELECT * FROM location_records WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' ORDER BY created_at DESC`,
        [tx.agencyId, tx.locationId]
      );
      const matched = contactsRes.rows
        .map(normalizeContactRow)
        .filter((c) => evaluateSmartListAst(smartList.filter_ast, c));

      return {
        smartList,
        total: matched.length,
        contacts: matched.slice(offset, offset + limit)
      };
    }
  };
}
