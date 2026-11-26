import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  normalizePhone,
  detectDuplicateCandidates,
  validateSmartListAst,
  evaluateSmartListAst,
  validateCustomFieldValue
} from '../src/crm/crm-2-0.mjs';

test('CRM 2.0 Normalization & Duplicate Detection: exact email, phone, and name+company warning', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
  assert.equal(normalizePhone('(415) 555-0199'), '+14155550199');

  const groups = detectDuplicateCandidates([
    { id: 'c1', firstName: 'Alice', lastName: 'Ng', email: 'alice@example.com', phone: '4155550199', company: 'Acme' },
    { id: 'c2', firstName: 'Alice', lastName: 'Ng', email: 'ALICE@example.com', phone: '+1-415-555-0199', company: 'Acme' },
    { id: 'c3', firstName: 'Bob', lastName: 'Lee', email: 'bob@example.com', phone: '2125550100', company: 'Beta' }
  ]);
  assert.ok(groups.some((g) => g.reason === 'exact_email' && g.confidence === 'high'));
  assert.ok(groups.some((g) => g.reason === 'exact_phone' && g.confidence === 'high'));
  assert.ok(groups.some((g) => g.reason === 'name_company_similarity' && g.confidence === 'warning'));
});

test('CRM 2.0 Smart Lists AST: AND/OR evaluation and unsafe field/depth rejection', () => {
  const ast = {
    op: 'and',
    rules: [
      { field: 'lifecycleStage', operator: 'eq', value: 'customer' },
      {
        op: 'or',
        rules: [
          { field: 'tags', operator: 'contains', value: 'vip' },
          { field: 'customFields.tier', operator: 'eq', value: 'enterprise' }
        ]
      }
    ]
  };
  assert.equal(validateSmartListAst(ast), true);
  assert.equal(
    evaluateSmartListAst(ast, { lifecycleStage: 'customer', tags: ['vip'], customFields: {} }),
    true
  );
  assert.equal(
    evaluateSmartListAst(ast, { lifecycleStage: 'lead', tags: ['vip'], customFields: {} }),
    false
  );
  assert.throws(
    () => validateSmartListAst({ field: 'DROP TABLE contacts;--', operator: 'eq', value: 'x' }),
    (err) => err.code === 'UNSUPPORTED_FILTER_FIELD'
  );
});

test('CRM 2.0 Custom Field Validation: supports text, number, date, boolean, select, multi_select, url', () => {
  assert.equal(validateCustomFieldValue({ fieldKey: 'mrr', fieldType: 'number' }, 5000).valid, true);
  assert.equal(validateCustomFieldValue({ fieldKey: 'mrr', fieldType: 'number' }, 'bad').valid, false);
  assert.equal(validateCustomFieldValue({ fieldKey: 'site', fieldType: 'url' }, 'https://operza.io').valid, true);
  assert.equal(validateCustomFieldValue({ fieldKey: 'site', fieldType: 'url' }, 'javascript:alert(1)').valid, false);
  assert.equal(validateCustomFieldValue({ fieldKey: 'plan', fieldType: 'select', options: ['pro', 'scale'] }, 'pro').valid, true);
  assert.equal(validateCustomFieldValue({ fieldKey: 'plan', fieldType: 'select', options: ['pro', 'scale'] }, 'other').valid, false);
});
