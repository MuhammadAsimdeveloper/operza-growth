import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFormsRepository,
  createTasksRepository,
  createReviewsRepository
} from '../lib/database.mjs';

const AGENCY_A = '11111111-1111-4111-8111-111111111111';
const LOCATION_A = '22222222-2222-4222-8222-222222222222';
const CONTACT_1 = '55555555-5555-4555-8555-555555555555';

function makeMockTx(store = { forms: [], submissions: [], tasks: [], reviews: [], reviewRequests: [] }) {
  return {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    actorId: 'user-1',
    async query(sql, params = []) {
      const n = sql.replace(/\s+/g, ' ').trim();
      if (n.startsWith('INSERT INTO forms')) {
        const [id, agencyId, locationId, name, description, publicSlug, status, published, fields, completion] = params;
        const row = {
          id, agency_id: agencyId, location_id: locationId, name, description,
          public_slug: publicSlug, status, published,
          fields: typeof fields === 'string' ? JSON.parse(fields) : fields,
          completion: typeof completion === 'string' ? JSON.parse(completion) : completion,
          submissions_count: 0,
          created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.forms.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (n.startsWith('SELECT * FROM forms WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
        const [a, l, id] = params;
        const rows = store.forms.filter(f => f.agency_id === a && f.location_id === l && f.id === id);
        return { rows, rowCount: rows.length };
      }
      if (n.startsWith('INSERT INTO form_submissions')) {
        const [id, agencyId, locationId, formId, contactId, idempotencyKey, answers, metadata] = params;
        if (idempotencyKey && store.submissions.some(s => s.agency_id === agencyId && s.form_id === formId && s.idempotency_key === idempotencyKey)) {
          return { rows: [], rowCount: 0 };
        }
        const row = {
          id, agency_id: agencyId, location_id: locationId, form_id: formId, contact_id: contactId,
          idempotency_key: idempotencyKey,
          answers: typeof answers === 'string' ? JSON.parse(answers) : answers,
          metadata: typeof metadata === 'string' ? JSON.parse(metadata) : metadata,
          submitted_at: '2026-11-25T10:01:00.000Z', created_at: '2026-11-25T10:01:00.000Z'
        };
        store.submissions.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (n.startsWith('SELECT * FROM form_submissions WHERE agency_id = $1 AND location_id = $2 AND form_id = $3 AND idempotency_key = $4')) {
        const [a, l, fid, key] = params;
        const rows = store.submissions.filter(s => s.agency_id === a && s.location_id === l && s.form_id === fid && s.idempotency_key === key);
        return { rows, rowCount: rows.length };
      }
      if (n.startsWith('UPDATE forms SET submissions_count = submissions_count + 1')) {
        const [a, l, id] = params;
        const f = store.forms.find(x => x.agency_id === a && x.location_id === l && x.id === id);
        if (f) f.submissions_count += 1;
        return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
      }
      if (n.startsWith('INSERT INTO tasks')) {
        const [id, agencyId, locationId, title, notes, contactId, opportunityId, assignedTo, priority, status, dueDate] = params;
        const row = {
          id, agency_id: agencyId, location_id: locationId, title, notes,
          contact_id: contactId, opportunity_id: opportunityId, assigned_to: assignedTo,
          priority, status, due_date: dueDate, completed_at: null,
          created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.tasks.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (n.startsWith('SELECT * FROM tasks WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
        const [a, l, id] = params;
        const rows = store.tasks.filter(t => t.agency_id === a && t.location_id === l && t.id === id);
        return { rows, rowCount: rows.length };
      }
      if (n.startsWith('UPDATE tasks SET')) {
        const [a, l, id, title, notes, assignedTo, priority, status, dueDate, completedAt] = params;
        const t = store.tasks.find(x => x.agency_id === a && x.location_id === l && x.id === id);
        if (!t) return { rows: [], rowCount: 0 };
        t.title = title; t.notes = notes; t.assigned_to = assignedTo;
        t.priority = priority; t.status = status; t.due_date = dueDate; t.completed_at = completedAt;
        return { rows: [t], rowCount: 1 };
      }
      if (n.startsWith('INSERT INTO reviews')) {
        const [id, agencyId, locationId, contactId, contactName, email, rating, text, source, status] = params;
        const row = {
          id, agency_id: agencyId, location_id: locationId, contact_id: contactId,
          contact_name: contactName, email, rating, text, source, status,
          reply: null, replied_at: null, received_at: '2026-11-25T10:00:00.000Z',
          created_at: '2026-11-25T10:00:00.000Z', updated_at: '2026-11-25T10:00:00.000Z'
        };
        store.reviews.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (n.startsWith('SELECT * FROM reviews WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
        const [a, l, id] = params;
        const rows = store.reviews.filter(r => r.agency_id === a && r.location_id === l && r.id === id);
        return { rows, rowCount: rows.length };
      }
      if (n.startsWith('UPDATE reviews SET')) {
        const [a, l, id, status, reply, repliedAt] = params;
        const r = store.reviews.find(x => x.agency_id === a && x.location_id === l && x.id === id);
        if (!r) return { rows: [], rowCount: 0 };
        r.status = status; r.reply = reply; r.replied_at = repliedAt;
        return { rows: [r], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

test('FormsRepository: creates form and records idempotent submission', async () => {
  const store = { forms: [], submissions: [], tasks: [], reviews: [], reviewRequests: [] };
  const tx = makeMockTx(store);
  const formsRepo = createFormsRepository();

  const form = await formsRepo.createForm(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    name: 'Lead Capture',
    publicSlug: 'lead-capture',
    published: true,
    status: 'published',
    fields: [{ id: 'email', label: 'Email', type: 'email', required: true }]
  });
  assert.equal(form.status, 'published');

  const sub1 = await formsRepo.recordSubmission(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    formId: form.id,
    contactId: CONTACT_1,
    idempotencyKey: 'sub-key-1',
    answers: { email: 'lead@example.com' }
  });
  assert.equal(sub1.deduplicated, false);

  const sub2 = await formsRepo.recordSubmission(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    formId: form.id,
    contactId: CONTACT_1,
    idempotencyKey: 'sub-key-1',
    answers: { email: 'lead@example.com' }
  });
  assert.equal(sub2.deduplicated, true);
  assert.equal(store.submissions.length, 1);
});

test('TasksRepository: creates task, completes and reopens with valid transitions', async () => {
  const store = { forms: [], submissions: [], tasks: [], reviews: [], reviewRequests: [] };
  const tx = makeMockTx(store);
  const tasksRepo = createTasksRepository();

  const task = await tasksRepo.createTask(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    title: 'Follow up lead',
    contactId: CONTACT_1,
    priority: 'high'
  });
  assert.equal(task.status, 'pending');

  const completed = await tasksRepo.updateTask(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    id: task.id,
    patch: { status: 'completed' }
  });
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completedAt);

  const reopened = await tasksRepo.updateTask(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    id: task.id,
    patch: { status: 'pending' }
  });
  assert.equal(reopened.status, 'pending');
  assert.equal(reopened.completedAt, null);
});

test('ReviewsRepository: creates review with clamped rating and moderates status/reply', async () => {
  const store = { forms: [], submissions: [], tasks: [], reviews: [], reviewRequests: [] };
  const tx = makeMockTx(store);
  const reviewsRepo = createReviewsRepository();

  const rev = await reviewsRepo.createReview(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    contactName: 'Happy Client',
    rating: 5,
    text: 'Great work!'
  });
  assert.equal(rev.rating, 5);
  assert.equal(rev.status, 'new');

  const moderated = await reviewsRepo.updateReview(tx, {
    agencyId: AGENCY_A,
    locationId: LOCATION_A,
    id: rev.id,
    patch: { status: 'published', reply: 'Thank you!' }
  });
  assert.equal(moderated.status, 'published');
  assert.equal(moderated.reply, 'Thank you!');
});
