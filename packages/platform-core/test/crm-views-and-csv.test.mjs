import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAndValidateCsvImport,
  exportContactsToCsv,
  parseCsvRows
} from '../src/csv-transfer.mjs';
import {
  createSmartListView,
  matchesSmartListView,
  filterSmartListRecords,
  generateSmartListSql
} from '../src/crm-views-store.mjs';

test('parseAndValidateCsvImport: parses CSV, sanitizes formula injection, and maps contact fields', () => {
  const csv = [
    'First Name,Last Name,Email,Phone,Company,Lead Score,Tags',
    'Alice,Smith,alice@example.com,+15550101,Acme Corp,85,vip;enterprise',
    '=CMD|"/C calc"!A0,Hacker,malicious@evil.com,+15550102,Bad LLC,10,danger',
    'Bob,Jones,bob@example.com,+15550103,Apex Systems,50,prospect'
  ].join('\r\n');

  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  const plan = parseAndValidateCsvImport({
    text: csv,
    agencyId,
    locationId,
    existingContacts: []
  });

  assert.equal(plan.rowCount, 3);
  assert.equal(plan.validRows, 3);
  assert.equal(plan.duplicateCount, 0);

  // Check formula injection was neutralized
  const maliciousRow = plan.validRecords[1];
  assert.ok(!maliciousRow.firstName.startsWith('='));
  assert.equal(maliciousRow.firstName, 'CMD|"/C calc"!A0');

  // Check field mapping
  const alice = plan.validRecords[0];
  assert.equal(alice.firstName, 'Alice');
  assert.equal(alice.lastName, 'Smith');
  assert.equal(alice.email, 'alice@example.com');
  assert.equal(alice.phone, '+15550101');
  assert.equal(alice.leadScore, 85);
  assert.deepEqual(alice.tags, ['vip', 'enterprise']);
});

test('parseAndValidateCsvImport: detects batch and existing CRM duplicates', () => {
  const existingContacts = [
    { email: 'existing@corp.com', phone: '+15559999' }
  ];

  const csv = [
    'First Name,Last Name,Email,Phone',
    'John,Doe,existing@corp.com,+15550111', // Existing CRM duplicate by email
    'Jane,Doe,unique@corp.com,+15550222',  // Valid unique
    'Duplicate,Person,unique@corp.com,+15550333' // Batch duplicate by email
  ].join('\n');

  const plan = parseAndValidateCsvImport({
    text: csv,
    agencyId: 'agency_1',
    locationId: 'loc_1',
    existingContacts
  });

  assert.equal(plan.rowCount, 3);
  assert.equal(plan.validRows, 1);
  assert.equal(plan.duplicateCount, 2);
  assert.equal(plan.validRecords[0].email, 'unique@corp.com');
});

test('exportContactsToCsv: exports contacts with formula injection escaping', () => {
  const contacts = [
    { firstName: 'Alice', lastName: 'Smith', email: 'alice@example.com', tags: ['vip', 'sales'] },
    { firstName: '+123456789', lastName: '@Formula', email: '=SUM(A1:A10)', tags: ['test'] }
  ];

  const csv = exportContactsToCsv({ contacts, fields: ['firstName', 'lastName', 'email', 'tags'] });
  assert.match(csv, /firstName,lastName,email,tags/);
  assert.match(csv, /Alice,Smith,alice@example\.com,"vip;sales"/);
  // Escaped with single quote to neutralize spreadsheet execution
  assert.match(csv, /'\+123456789,'@Formula,'=SUM\(A1:A10\),test/);
});

test('createSmartListView & matchesSmartListView: evaluates complex conditions with and/or logic', () => {
  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  const view = createSmartListView({
    agencyId,
    locationId,
    name: 'High Value Leads',
    logic: 'and',
    conditions: [
      { field: 'leadScore', op: 'gte', value: 70 },
      { field: 'tags', op: 'contains', value: 'vip' }
    ]
  });

  const matchingContact = {
    agencyId,
    locationId,
    firstName: 'Elon',
    leadScore: 90,
    tags: ['vip', 'founder']
  };

  const nonMatchingContact = {
    agencyId,
    locationId,
    firstName: 'Rookie',
    leadScore: 40,
    tags: ['vip']
  };

  assert.equal(matchesSmartListView({ view, record: matchingContact, agencyId, locationId }), true);
  assert.equal(matchesSmartListView({ view, record: nonMatchingContact, agencyId, locationId }), false);

  // Test pagination filter
  const filterRes = filterSmartListRecords({
    view,
    records: [matchingContact, nonMatchingContact],
    agencyId,
    locationId,
    limit: 10
  });

  assert.equal(filterRes.total, 1);
  assert.equal(filterRes.items[0].firstName, 'Elon');
});

test('generateSmartListSql: generates parameterized SQL with composite agency/location isolation', () => {
  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  const view = createSmartListView({
    agencyId,
    locationId,
    name: 'Enterprise VIPs',
    logic: 'and',
    conditions: [
      { field: 'company', op: 'equals', value: 'Google' },
      { field: 'leadScore', op: 'gt', value: 50 },
      { field: 'email', op: 'ends_with', value: '@google.com' }
    ]
  });

  const result = generateSmartListSql({ view, tableName: 'contacts', agencyId, locationId });

  // Assert SQL uses parameters without raw values concatenated
  assert.match(result.sql, /WHERE contacts\.agency_id = \$1 AND contacts\.location_id = \$2/);
  assert.match(result.sql, /LOWER\(contacts\.company::text\) = LOWER\(\$3\)/);
  assert.match(result.sql, /contacts\.lead_score > \$4::numeric/);
  assert.match(result.sql, /contacts\.email::text ILIKE '%' \|\| \$5/);
  assert.deepEqual(result.params, [agencyId, locationId, 'Google', 50, '@google.com']);
});
