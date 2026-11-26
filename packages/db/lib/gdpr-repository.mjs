/**
 * Phase 8 — GDPR Data Subject Export & Deletion Repository (TenantTx)
 * Enforces strict tenant isolation, idempotent deletion/anonymization,
 * legal-hold protection, and retention of legally required financial/audit records.
 */

import { createHash, randomUUID } from 'node:crypto';

export function createGdprRepository() {
  return {
    async exportSubjectData(tx, { subjectEmail = null, contactId = null, requestedBy = 'system' } = {}) {
      if (!subjectEmail && !contactId) {
        throw Object.assign(new TypeError('subjectEmail or contactId is required'), { code: 'INVALID_GDPR_SUBJECT' });
      }
      const normEmail = subjectEmail ? String(subjectEmail).trim().toLowerCase() : null;

      const contactsRes = await tx.query(
        `SELECT id, body, created_at, updated_at FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts'
           AND (
             ($3::text IS NOT NULL AND id::text = $3)
             OR ($4::text IS NOT NULL AND lower(body->>'email') = $4)
           )`,
        [tx.agencyId, tx.locationId, contactId, normEmail]
      );

      const contactIds = contactsRes.rows.map((r) => r.id);
      let appointments = [];
      let tasks = [];
      let conversations = [];
      let invoices = [];

      if (contactIds.length > 0) {
        const apptRes = await tx.query(
          `SELECT id, calendar_id, title, starts_at, ends_at, status FROM appointments
           WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        appointments = apptRes.rows;

        const taskRes = await tx.query(
          `SELECT id, title, status, due_date FROM tasks
           WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        tasks = taskRes.rows;

        const convRes = await tx.query(
          `SELECT id, channel, status, created_at FROM conversations
           WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        conversations = convRes.rows;

        const invRes = await tx.query(
          `SELECT id, invoice_number, amount_cents, currency, status, created_at FROM invoices
           WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        invoices = invRes.rows;
      }

      const exportedAt = new Date().toISOString();
      const exportId = randomUUID();
      const payload = {
        manifest: {
          exportId,
          agencyId: tx.agencyId,
          locationId: tx.locationId,
          requestedBy,
          exportedAt,
          expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
          format: 'application/json'
        },
        subject: { contactId, email: normEmail },
        records: {
          contacts: contactsRes.rows,
          appointments,
          tasks,
          conversations,
          invoices
        }
      };

      const checksum = createHash('sha256').update(JSON.stringify(payload.records)).digest('hex');
      payload.manifest.sha256 = checksum;
      return payload;
    },

    async deleteSubjectData(tx, {
      subjectEmail = null,
      contactId = null,
      legalHold = false
    } = {}) {
      if (legalHold === true) {
        throw Object.assign(new Error('Deletion blocked by active legal hold'), { code: 'GDPR_LEGAL_HOLD_ACTIVE' });
      }
      if (!subjectEmail && !contactId) {
        throw Object.assign(new TypeError('subjectEmail or contactId is required'), { code: 'INVALID_GDPR_SUBJECT' });
      }
      const normEmail = subjectEmail ? String(subjectEmail).trim().toLowerCase() : null;

      const contactsRes = await tx.query(
        `SELECT id FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts'
           AND (
             ($3::text IS NOT NULL AND id::text = $3)
             OR ($4::text IS NOT NULL AND lower(body->>'email') = $4)
           )`,
        [tx.agencyId, tx.locationId, contactId, normEmail]
      );

      const contactIds = contactsRes.rows.map((r) => r.id);
      let deletedContacts = 0;
      let deletedTasks = 0;
      let deletedConversations = 0;
      let cancelledAppointments = 0;
      let anonymizedInvoices = 0;

      if (contactIds.length > 0) {
        const tDel = await tx.query(
          `DELETE FROM tasks WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        deletedTasks = tDel.rowCount || 0;

        const cDel = await tx.query(
          `DELETE FROM conversations WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        deletedConversations = cDel.rowCount || 0;

        const aUpd = await tx.query(
          `UPDATE appointments SET status = 'cancelled', contact_id = NULL, title = '[GDPR Redacted]', updated_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        cancelledAppointments = aUpd.rowCount || 0;

        const invUpd = await tx.query(
          `UPDATE invoices SET contact_id = NULL, contact_name = '[GDPR Redacted]', updated_at = now()
           WHERE agency_id = $1 AND location_id = $2 AND contact_id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        anonymizedInvoices = invUpd.rowCount || 0;

        const lrDel = await tx.query(
          `DELETE FROM location_records
           WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts' AND id = ANY($3::uuid[])`,
          [tx.agencyId, tx.locationId, contactIds]
        );
        deletedContacts = lrDel.rowCount || 0;
      }

      return {
        status: 'completed',
        idempotent: contactIds.length === 0 && anonymizedInvoices === 0,
        deletedContacts,
        deletedTasks,
        deletedConversations,
        cancelledAppointments,
        anonymizedInvoices,
        financialLedgerRetained: true
      };
    }
  };
}
