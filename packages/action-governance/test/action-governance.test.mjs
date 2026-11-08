import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJsonSchema,
  normalizeActionSchemas,
  validateInput,
  createActionRegistry,
  defineAction,
  getAction,
  listActions,
  resolveActionInputExpressions
} from '../index.mjs';

test('ReDoS safety: unanchored and backtracking patterns are strictly rejected', () => {
  // Reject unanchored pattern
  assert.throws(
    () => normalizeActionSchemas({ inputSchema: { type: 'string', pattern: '[a-z]+' } }),
    /must be anchored/
  );

  // Reject unsupported / backtracking syntax like nested groups or wildcards with alternation
  assert.throws(
    () => normalizeActionSchemas({ inputSchema: { type: 'string', pattern: '^([a-z]+)+$' } }),
    /unsupported syntax/
  );

  // Accept safe anchored pattern
  const valid = normalizeActionSchemas({ inputSchema: { type: 'string', pattern: '^[a-z0-9_-]+$' } });
  assert.equal(valid.inputSchema.pattern, '^[a-z0-9_-]+$');
});

test('Prototype pollution defense: __proto__ and constructor keys are rejected', () => {
  assert.throws(
    () => normalizeActionSchemas({
      inputSchema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')
    }),
    /unsafe key/
  );
  assert.throws(
    () => normalizeActionSchemas({
      inputSchema: JSON.parse('{"type":"object","properties":{"constructor":{"type":"string"}}}')
    }),
    /unsafe key/
  );
});

test('Credential leakage defense: rejects inputs containing secrets, passwords, or tokens', () => {
  assert.throws(
    () => validateInput({ username: 'operza_user', password: 'plain_password' }),
    { code: 'credential_in_input' }
  );
  assert.throws(
    () => validateInput({ api_key: 'sk_live_123456789' }),
    { code: 'credential_in_input' }
  );
  assert.throws(
    () => validateInput({ nested: { client_secret: 'top_secret' } }),
    { code: 'credential_in_input' }
  );

  // Clean inputs pass
  assert.doesNotThrow(() => validateInput({ name: 'Valid User', email: 'user@operza.io' }));
});

test('JSON Schema validation: type checking and bounds enforcement', () => {
  const schema = {
    type: 'object',
    required: ['name', 'email'],
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 50 },
      email: { type: 'string', pattern: '^[a-z0-9_.-]+@[a-z0-9_.-]+$' },
      age: { type: 'integer', minimum: 18, maximum: 120 }
    },
    additionalProperties: false
  };

  // Valid payload
  assert.equal(validateJsonSchema({ name: 'Alice', email: 'alice@operza.io', age: 30 }, schema), true);

  // Missing required field
  assert.throws(
    () => validateJsonSchema({ name: 'Alice' }, schema),
    /email is required/
  );

  // Value outside bounds
  assert.throws(
    () => validateJsonSchema({ name: 'Alice', email: 'alice@operza.io', age: 15 }, schema),
    /below minimum/
  );

  // Disallowed additional property
  assert.throws(
    () => validateJsonSchema({ name: 'Alice', email: 'alice@operza.io', hackerField: true }, schema),
    /not allowed/
  );
});

test('Action Registry: calculates deterministic definition hashes and catalogs risk tiers', () => {
  const action = defineAction({
    id: 'crm.lead.qualify',
    name: 'Qualify Lead',
    domain: 'crm',
    risk: 'write',
    approval: 'none',
    inputSchema: { type: 'object', properties: { score: { type: 'number' } } }
  });

  assert.equal(action.id, 'crm.lead.qualify');
  assert.equal(typeof action.definitionHash, 'string');
  assert.equal(action.definitionHash.length, 64);

  const defaultAction = getAction('crm.contact.upsert');
  assert.ok(defaultAction);
  assert.equal(defaultAction.risk, 'write');

  const financialActions = listActions({ risk: 'financial' });
  assert.ok(financialActions.some(a => a.id === 'commerce.payment.refund'));
});

test('AST Expression evaluation in action inputs', () => {
  const context = {
    contact: { firstName: 'Diana', points: 150 },
    steps: {
      lookup: { score: 85 }
    }
  };

  const resolved = resolveActionInputExpressions({
    input: {
      displayName: { $expression: "uppercase(contact.firstName) + ' (' + string(contact.points) + ')'" },
      isVip: { $expression: "contact.points >= 100 && steps.lookup.score > 80" }
    },
    context
  });

  assert.equal(resolved.displayName, 'DIANA (150)');
  assert.equal(resolved.isVip, true);
});
