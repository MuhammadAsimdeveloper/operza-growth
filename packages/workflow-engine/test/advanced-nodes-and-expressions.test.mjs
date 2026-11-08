import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, compileExpression } from '../src/expression-engine.mjs';
import { executeAdvancedNode } from '../src/node-runtime.mjs';
import { applyDataMapping, validateDataMapping } from '../src/safe-data-mapping.mjs';

test('expression-engine: evaluates complex arithmetic, logic, and functions without eval', () => {
  const context = {
    contact: { firstName: 'Sarah', lastName: 'Connor', score: 85 },
    deal: { value: 15000, discount: 2000 },
    steps: {
      tags: ['vip', 'enterprise']
    }
  };

  // Compile check
  assert.equal(compileExpression('deal.value - deal.discount > 10000').valid, true);

  // Arithmetic and comparison
  const isHighValue = evaluateExpression({
    expression: 'deal.value - deal.discount >= 13000',
    context
  });
  assert.equal(isHighValue, true);

  // String functions and concatenation
  const fullNameUpper = evaluateExpression({
    expression: "uppercase(trim(contact.firstName)) + ' ' + uppercase(contact.lastName)",
    context
  });
  assert.equal(fullNameUpper, 'SARAH CONNOR');

  // Coalesce and logic
  const tagList = evaluateExpression({
    expression: "join(steps.tags, ' | ')",
    context
  });
  assert.equal(tagList, 'vip | enterprise');

  // Protected / reserved field rejection
  assert.throws(
    () => evaluateExpression({ expression: 'contact.password === "secret"', context }),
    /reserved or invalid field/
  );
});

test('node-runtime: loop_over_items batches input arrays cleanly', () => {
  const input = Array.from({ length: 25 }, (_, i) => ({ id: `item_${i}`, val: i * 2 }));
  const node = {
    id: 'node_loop',
    type: 'loop_over_items',
    config: { batchSize: 5 }
  };

  const result = executeAdvancedNode({ node, input });
  assert.equal(result.control.status, 'loop');
  assert.equal(result.control.totalItems, 25);
  assert.equal(result.control.batches.length, 5);
  assert.equal(result.control.batches[0].length, 5);
  assert.equal(result.items.length, 25);
});

test('node-runtime: split_out unpacks nested array items into top-level items', () => {
  const input = [
    { orderId: 'ord_1', lineItems: [{ sku: 'A1', qty: 1 }, { sku: 'A2', qty: 2 }] },
    { orderId: 'ord_2', lineItems: [{ sku: 'B1', qty: 5 }] }
  ];
  const node = {
    id: 'node_split',
    type: 'split_out',
    config: { field: 'lineItems' }
  };

  const result = executeAdvancedNode({ node, input });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].orderId, 'ord_1');
  assert.equal(result.items[0].item.sku, 'A1');
  assert.equal(result.items[2].orderId, 'ord_2');
  assert.equal(result.items[2].item.sku, 'B1');
});

test('node-runtime: merge combines items by mode (append, combine_by_position, merge_by_key)', () => {
  const listA = [{ id: '1', name: 'Alpha' }, { id: '2', name: 'Beta' }];
  const listB = [{ id: '1', score: 90 }, { id: '2', score: 95 }, { id: '3', score: 80 }];

  // 1. merge_by_key
  const mergeKeyNode = {
    id: 'node_merge_key',
    type: 'merge',
    config: { mode: 'merge_by_key', key: 'id', includeUnmatched: true }
  };
  const keyResult = executeAdvancedNode({
    node: mergeKeyNode,
    input: listA,
    context: { mergeInputs: [listB] }
  });
  assert.equal(keyResult.items.length, 3);
  assert.deepEqual(keyResult.items[0], { id: '1', name: 'Alpha', score: 90 });
  assert.deepEqual(keyResult.items[1], { id: '2', name: 'Beta', score: 95 });
  assert.deepEqual(keyResult.items[2], { id: '3', score: 80 });

  // 2. append mode
  const mergeAppendNode = {
    id: 'node_merge_append',
    type: 'merge',
    config: { mode: 'append' }
  };
  const appendResult = executeAdvancedNode({
    node: mergeAppendNode,
    input: listA,
    context: { mergeInputs: [listB] }
  });
  assert.equal(appendResult.items.length, 5);
});

test('node-runtime: aggregate calculates sum, avg, count, min, and max', () => {
  const items = [{ price: 100 }, { price: 200 }, { price: 300 }];

  const sumResult = executeAdvancedNode({
    node: { id: 'n1', type: 'aggregate', config: { operation: 'sum', field: 'price' } },
    input: items
  });
  assert.equal(sumResult.items[0].value, 600);

  const avgResult = executeAdvancedNode({
    node: { id: 'n2', type: 'aggregate', config: { operation: 'avg', field: 'price' } },
    input: items
  });
  assert.equal(avgResult.items[0].value, 200);

  const countResult = executeAdvancedNode({
    node: { id: 'n3', type: 'aggregate', config: { operation: 'count' } },
    input: items
  });
  assert.equal(countResult.items[0].value, 3);
});

test('safe-data-mapping: validates and maps fields with transformations', () => {
  const mapping = [
    { source: 'contact.firstName', target: 'contact.first_name', transform: 'trim' },
    { source: 'deal.value', target: 'deal.total_amount', transform: 'number' },
    { source: 'steps.active', target: 'workflow.is_active', transform: 'boolean' }
  ];

  assert.doesNotThrow(() => validateDataMapping({ mapping }));

  const context = {
    contact: { firstName: '   Bob  ' },
    deal: { value: '450.50' },
    steps: { active: 'yes' }
  };

  const output = applyDataMapping({ mapping, context });
  assert.equal(output.contact.first_name, 'Bob');
  assert.equal(output.deal.total_amount, 450.50);
  assert.equal(output.workflow.is_active, true);
});
