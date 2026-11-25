/**
 * ============================================================================
 * Operza Scheduling Repository — Domain Boundary
 * ============================================================================
 * Encapsulates all Calendar and Appointment aggregate persistence logic strictly
 * through TenantTx instances, enforcing multi-tenant PostgreSQL Row Level Security (RLS)
 * on dedicated `calendars` and `appointments` tables.
 *
 * Enforces PostgreSQL GiST exclusion constraint (Migration 015) preventing double-booking
 * on overlapping half-open intervals `[starts_at, ends_at)`.
 */

import { randomUUID } from 'node:crypto';

const VALID_CALENDAR_STATUSES = new Set(['active', 'inactive']);
const VALID_APPOINTMENT_STATUSES = new Set(['confirmed', 'cancelled', 'completed', 'no_show']);

const ALLOWED_CALENDAR_SORT_FIELDS = new Set([
  'name',
  'slug',
  'status',
  'duration_min',
  'durationMin',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt'
]);

const ALLOWED_APPOINTMENT_SORT_FIELDS = new Set([
  'title',
  'starts_at',
  'startsAt',
  'ends_at',
  'endsAt',
  'status',
  'created_at',
  'createdAt',
  'updated_at',
  'updatedAt'
]);

/**
 * Normalizes a database row from the `calendars` table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
export function normalizeCalendarRow(row) {
  if (!row) return null;
  const availability = typeof row.availability === 'string'
    ? JSON.parse(row.availability)
    : (row.availability || {});

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    name: row.name,
    slug: row.slug,
    color: row.color || '#4f46e5',
    durationMin: Number(row.duration_min ?? row.durationMin) || 30,
    availability,
    roundRobin: Boolean(row.round_robin ?? row.roundRobin),
    description: row.description || '',
    status: row.status || 'active',
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

/**
 * Normalizes a database row from the `appointments` table into a domain entity.
 *
 * @param {any} row
 * @returns {any}
 */
export function normalizeAppointmentRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    calendarId: row.calendar_id || row.calendarId,
    contactId: row.contact_id || row.contactId || null,
    title: row.title,
    startsAt: row.starts_at?.toISOString?.() || row.starts_at,
    endsAt: row.ends_at?.toISOString?.() || row.ends_at,
    status: row.status || 'confirmed',
    assignedTo: row.assigned_to || row.assignedTo || null,
    notes: row.notes || '',
    externalEventId: row.external_event_id || row.externalEventId || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

/**
 * Generates a URL-safe slug from a string.
 *
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Creates an instance of SchedulingRepository.
 *
 * @returns {any}
 */
export function createSchedulingRepository() {
  return {
    // ═════════════════════════════════════════════════════════════════════════
    // CALENDARS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Creates a new calendar within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async createCalendar(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_CALENDAR_PAYLOAD: Payload must be an object');
      }

      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!name || name.length > 120) {
        throw new Error('INVALID_CALENDAR_NAME: Name must be between 1 and 120 characters');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const slug = (typeof data.slug === 'string' && data.slug.trim())
        ? slugify(data.slug)
        : (slugify(name) || `cal-${assignedId.slice(0, 8)}`);

      const color = (typeof data.color === 'string' && data.color.trim()) ? data.color.trim() : '#4f46e5';
      const durationMin = Number(data.durationMin ?? data.duration_min) || 30;
      const availability = data.availability && typeof data.availability === 'object' ? data.availability : {};
      const roundRobin = Boolean(data.roundRobin ?? data.round_robin);
      const description = typeof data.description === 'string' ? data.description.trim() : null;

      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'active';
      if (!VALID_CALENDAR_STATUSES.has(status)) {
        status = 'active';
      }

      const now = new Date();

      const sql = `
        INSERT INTO calendars (
          id, agency_id, location_id, name, slug, color, duration_min,
          availability, round_robin, description, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13
        ) RETURNING *
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        name,
        slug,
        color,
        durationMin,
        JSON.stringify(availability),
        roundRobin,
        description,
        status,
        now,
        now
      ];

      const res = await tx.query(sql, params);
      return normalizeCalendarRow(res.rows[0]);
    },

    /**
     * Retrieves a calendar by ID within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async getCalendarById(tx, id) {
      if (!id) return null;
      const sql = `
        SELECT * FROM calendars
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
        LIMIT 1
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      if (res.rows.length === 0) return null;
      return normalizeCalendarRow(res.rows[0]);
    },

    /**
     * Retrieves a calendar by slug within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} slug
     * @returns {Promise<any|null>}
     */
    async getCalendarBySlug(tx, slug) {
      if (!slug) return null;
      const sql = `
        SELECT * FROM calendars
        WHERE agency_id = $1 AND location_id = $2 AND (id::text = $3 OR slug = $3)
        LIMIT 1
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, slug]);
      if (res.rows.length === 0) return null;
      return normalizeCalendarRow(res.rows[0]);
    },

    /**
     * Lists calendars with filtering and pagination.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} options
     * @returns {Promise<{ calendars: any[], total: number }>}
     */
    async listCalendars(tx, options = {}) {
      const page = Math.max(1, parseInt(options.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
      const offset = (page - 1) * limit;

      const conditions = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let pIdx = 3;

      if (options.status && VALID_CALENDAR_STATUSES.has(options.status.toLowerCase())) {
        conditions.push(`status = $${pIdx}`);
        params.push(options.status.toLowerCase());
        pIdx++;
      }

      if (options.search && typeof options.search === 'string' && options.search.trim()) {
        conditions.push(`(name ILIKE $${pIdx} OR slug ILIKE $${pIdx})`);
        params.push(`%${options.search.trim()}%`);
        pIdx++;
      }

      const whereClause = conditions.join(' AND ');

      // Total count
      const countSql = `SELECT count(*)::int as count FROM calendars WHERE ${whereClause}`;
      const countRes = await tx.query(countSql, params);
      const total = countRes.rows[0]?.count || 0;

      // Sorting
      let sortBy = 'created_at';
      if (options.sortBy && ALLOWED_CALENDAR_SORT_FIELDS.has(options.sortBy)) {
        sortBy = options.sortBy.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      }
      const sortOrder = String(options.sortOrder || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      const selectSql = `
        SELECT * FROM calendars
        WHERE ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `;
      params.push(limit, offset);

      const res = await tx.query(selectSql, params);
      const calendars = res.rows.map(normalizeCalendarRow);

      return { calendars, total };
    },

    /**
     * Updates an existing calendar.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {any} patch
     * @returns {Promise<any|null>}
     */
    async updateCalendar(tx, id, patch) {
      if (!id || !patch || typeof patch !== 'object') return null;

      const setClauses = [];
      const params = [];
      let pIdx = 1;

      if (typeof patch.name === 'string') {
        const name = patch.name.trim();
        if (!name || name.length > 120) throw new Error('INVALID_CALENDAR_NAME: Name must be between 1 and 120 characters');
        setClauses.push(`name = $${pIdx++}`);
        params.push(name);
      }

      if (typeof patch.slug === 'string' && patch.slug.trim()) {
        setClauses.push(`slug = $${pIdx++}`);
        params.push(slugify(patch.slug));
      }

      if (typeof patch.color === 'string') {
        setClauses.push(`color = $${pIdx++}`);
        params.push(patch.color.trim());
      }

      if (patch.durationMin !== undefined || patch.duration_min !== undefined) {
        const duration = Number(patch.durationMin ?? patch.duration_min) || 30;
        setClauses.push(`duration_min = $${pIdx++}`);
        params.push(duration);
      }

      if (patch.availability !== undefined) {
        setClauses.push(`availability = $${pIdx++}`);
        params.push(typeof patch.availability === 'string' ? patch.availability : JSON.stringify(patch.availability || {}));
      }

      if (patch.roundRobin !== undefined || patch.round_robin !== undefined) {
        setClauses.push(`round_robin = $${pIdx++}`);
        params.push(Boolean(patch.roundRobin ?? patch.round_robin));
      }

      if (patch.description !== undefined) {
        setClauses.push(`description = $${pIdx++}`);
        params.push(patch.description ? String(patch.description).trim() : null);
      }

      if (patch.status !== undefined) {
        const status = String(patch.status).trim().toLowerCase();
        if (VALID_CALENDAR_STATUSES.has(status)) {
          setClauses.push(`status = $${pIdx++}`);
          params.push(status);
        }
      }

      if (setClauses.length === 0) {
        return this.getCalendarById(tx, id);
      }

      setClauses.push(`updated_at = now()`);

      params.push(tx.agencyId, tx.locationId, id);
      const sql = `
        UPDATE calendars
        SET ${setClauses.join(', ')}
        WHERE agency_id = $${pIdx++} AND location_id = $${pIdx++} AND id = $${pIdx++}
        RETURNING *
      `;

      const res = await tx.query(sql, params);
      if (res.rows.length === 0) return null;
      return normalizeCalendarRow(res.rows[0]);
    },

    /**
     * Deletes a calendar.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteCalendar(tx, id) {
      if (!id) return false;
      const sql = `
        DELETE FROM calendars
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      return (res.rowCount || 0) > 0;
    },

    // ═════════════════════════════════════════════════════════════════════════
    // APPOINTMENTS
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Creates a new appointment within the tenant transaction.
     * Enforces half-open interval time validity and GiST concurrency exclusion.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} data
     * @returns {Promise<any>}
     */
    async createAppointment(tx, data) {
      if (!data || typeof data !== 'object') {
        throw new Error('INVALID_APPOINTMENT_PAYLOAD: Payload must be an object');
      }

      const title = typeof data.title === 'string' ? data.title.trim() : '';
      if (!title || title.length > 200) {
        throw new Error('INVALID_APPOINTMENT_TITLE: Title must be between 1 and 200 characters');
      }

      const calendarId = (typeof data.calendarId === 'string' && data.calendarId.trim())
        ? data.calendarId.trim()
        : (typeof data.calendar_id === 'string' && data.calendar_id.trim() ? data.calendar_id.trim() : null);

      if (!calendarId) {
        throw new Error('INVALID_CALENDAR_ID: calendarId is required');
      }

      const startsAt = data.startsAt || data.starts_at;
      const endsAt = data.endsAt || data.ends_at;

      if (!startsAt || !endsAt) {
        throw new Error('INVALID_TIME_RANGE: startsAt and endsAt are required');
      }

      const startTime = new Date(startsAt).getTime();
      const endTime = new Date(endsAt).getTime();
      if (isNaN(startTime) || isNaN(endTime) || endTime <= startTime) {
        throw new Error('INVALID_TIME_RANGE: endsAt must be strictly greater than startsAt');
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const contactId = (typeof data.contactId === 'string' && data.contactId.trim())
        ? data.contactId.trim()
        : (typeof data.contact_id === 'string' && data.contact_id.trim() ? data.contact_id.trim() : null);

      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'confirmed';
      if (!VALID_APPOINTMENT_STATUSES.has(status)) {
        status = 'confirmed';
      }

      const assignedTo = (typeof data.assignedTo === 'string' && data.assignedTo.trim())
        ? data.assignedTo.trim()
        : (typeof data.assigned_to === 'string' && data.assigned_to.trim() ? data.assigned_to.trim() : null);

      const notes = typeof data.notes === 'string' ? data.notes.trim() : null;
      const externalEventId = typeof data.externalEventId === 'string'
        ? data.externalEventId.trim()
        : (typeof data.external_event_id === 'string' ? data.external_event_id.trim() : null);

      const now = new Date();

      const sql = `
        INSERT INTO appointments (
          id, agency_id, location_id, calendar_id, contact_id,
          title, starts_at, ends_at, status, assigned_to, notes,
          external_event_id, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, $13, $14
        ) RETURNING *
      `;

      const params = [
        assignedId,
        tx.agencyId,
        tx.locationId,
        calendarId,
        contactId,
        title,
        new Date(startsAt).toISOString(),
        new Date(endsAt).toISOString(),
        status,
        assignedTo,
        notes,
        externalEventId,
        now,
        now
      ];

      try {
        const res = await tx.query(sql, params);
        return normalizeAppointmentRow(res.rows[0]);
      } catch (err) {
        if (err.code === '23P01' || err.message?.includes('exclude_overlapping_active_appointments')) {
          const conflictErr = new Error('Cannot book: the selected time slot conflicts with an existing appointment.');
          conflictErr.code = '23P01';
          conflictErr.status = 409;
          throw conflictErr;
        }
        throw err;
      }
    },

    /**
     * Retrieves an appointment by ID within the tenant transaction.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async getAppointmentById(tx, id) {
      if (!id) return null;
      const sql = `
        SELECT * FROM appointments
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
        LIMIT 1
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      if (res.rows.length === 0) return null;
      return normalizeAppointmentRow(res.rows[0]);
    },

    /**
     * Lists appointments with optional filtering and pagination.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {any} options
     * @returns {Promise<{ appointments: any[], total: number }>}
     */
    async listAppointments(tx, options = {}) {
      const page = Math.max(1, parseInt(options.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 50));
      const offset = (page - 1) * limit;

      const conditions = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let pIdx = 3;

      if (options.calendarId || options.calendar_id) {
        conditions.push(`calendar_id = $${pIdx++}`);
        params.push(options.calendarId || options.calendar_id);
      }

      if (options.contactId || options.contact_id) {
        conditions.push(`contact_id = $${pIdx++}`);
        params.push(options.contactId || options.contact_id);
      }

      if (options.status && VALID_APPOINTMENT_STATUSES.has(options.status.toLowerCase())) {
        conditions.push(`status = $${pIdx++}`);
        params.push(options.status.toLowerCase());
      }

      if (options.startsAfter || options.from) {
        conditions.push(`starts_at >= $${pIdx++}`);
        params.push(new Date(options.startsAfter || options.from).toISOString());
      }

      if (options.endsBefore || options.to) {
        conditions.push(`ends_at <= $${pIdx++}`);
        params.push(new Date(options.endsBefore || options.to).toISOString());
      }

      if (options.search && typeof options.search === 'string' && options.search.trim()) {
        conditions.push(`(title ILIKE $${pIdx} OR notes ILIKE $${pIdx})`);
        params.push(`%${options.search.trim()}%`);
        pIdx++;
      }

      const whereClause = conditions.join(' AND ');

      // Total count
      const countSql = `SELECT count(*)::int as count FROM appointments WHERE ${whereClause}`;
      const countRes = await tx.query(countSql, params);
      const total = countRes.rows[0]?.count || 0;

      // Sorting
      let sortBy = 'starts_at';
      if (options.sortBy && ALLOWED_APPOINTMENT_SORT_FIELDS.has(options.sortBy)) {
        sortBy = options.sortBy.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      }
      const sortOrder = String(options.sortOrder || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

      const selectSql = `
        SELECT * FROM appointments
        WHERE ${whereClause}
        ORDER BY ${sortBy} ${sortOrder}
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `;
      params.push(limit, offset);

      const res = await tx.query(selectSql, params);
      const appointments = res.rows.map(normalizeAppointmentRow);

      return { appointments, total };
    },

    /**
     * Updates an existing appointment.
     * Handles time changes with GiST conflict detection.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {any} patch
     * @returns {Promise<any|null>}
     */
    async updateAppointment(tx, id, patch) {
      if (!id || !patch || typeof patch !== 'object') return null;

      const setClauses = [];
      const params = [];
      let pIdx = 1;

      if (typeof patch.title === 'string') {
        const title = patch.title.trim();
        if (!title || title.length > 200) throw new Error('INVALID_APPOINTMENT_TITLE: Title must be between 1 and 200 characters');
        setClauses.push(`title = $${pIdx++}`);
        params.push(title);
      }

      if (patch.startsAt !== undefined || patch.starts_at !== undefined) {
        setClauses.push(`starts_at = $${pIdx++}`);
        params.push(new Date(patch.startsAt || patch.starts_at).toISOString());
      }

      if (patch.endsAt !== undefined || patch.ends_at !== undefined) {
        setClauses.push(`ends_at = $${pIdx++}`);
        params.push(new Date(patch.endsAt || patch.ends_at).toISOString());
      }

      if (patch.status !== undefined) {
        const status = String(patch.status).trim().toLowerCase();
        if (VALID_APPOINTMENT_STATUSES.has(status)) {
          setClauses.push(`status = $${pIdx++}`);
          params.push(status);
        }
      }

      if (patch.notes !== undefined) {
        setClauses.push(`notes = $${pIdx++}`);
        params.push(patch.notes ? String(patch.notes).trim() : null);
      }

      if (patch.assignedTo !== undefined || patch.assigned_to !== undefined) {
        const assignedTo = patch.assignedTo || patch.assigned_to;
        setClauses.push(`assigned_to = $${pIdx++}`);
        params.push(assignedTo ? String(assignedTo).trim() : null);
      }

      if (patch.externalEventId !== undefined || patch.external_event_id !== undefined) {
        const externalEventId = patch.externalEventId || patch.external_event_id;
        setClauses.push(`external_event_id = $${pIdx++}`);
        params.push(externalEventId ? String(externalEventId).trim() : null);
      }

      if (setClauses.length === 0) {
        return this.getAppointmentById(tx, id);
      }

      setClauses.push(`updated_at = now()`);

      params.push(tx.agencyId, tx.locationId, id);
      const sql = `
        UPDATE appointments
        SET ${setClauses.join(', ')}
        WHERE agency_id = $${pIdx++} AND location_id = $${pIdx++} AND id = $${pIdx++}
        RETURNING *
      `;

      try {
        const res = await tx.query(sql, params);
        if (res.rows.length === 0) return null;
        return normalizeAppointmentRow(res.rows[0]);
      } catch (err) {
        if (err.code === '23P01' || err.message?.includes('exclude_overlapping_active_appointments')) {
          const conflictErr = new Error('Cannot reschedule: the selected time slot conflicts with an existing appointment.');
          conflictErr.code = '23P01';
          conflictErr.status = 409;
          throw conflictErr;
        }
        throw err;
      }
    },

    /**
     * Reschedules an appointment to a new time slot.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @param {{ startsAt: string, endsAt: string }} times
     * @returns {Promise<any|null>}
     */
    async rescheduleAppointment(tx, id, { startsAt, endsAt }) {
      return this.updateAppointment(tx, id, { startsAt, endsAt });
    },

    /**
     * Cancels an appointment. Instantly releases GiST exclusion lock.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<any|null>}
     */
    async cancelAppointment(tx, id) {
      return this.updateAppointment(tx, id, { status: 'cancelled' });
    },

    /**
     * Deletes an appointment.
     *
     * @param {import('./tenant-tx.mjs').TenantTx} tx
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteAppointment(tx, id) {
      if (!id) return false;
      const sql = `
        DELETE FROM appointments
        WHERE agency_id = $1 AND location_id = $2 AND id = $3
      `;
      const res = await tx.query(sql, [tx.agencyId, tx.locationId, id]);
      return (res.rowCount || 0) > 0;
    }
  };
}
