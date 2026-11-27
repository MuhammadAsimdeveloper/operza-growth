import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('@operza/ui exports core Design System 2.0 primitives', async () => {
  const src = await fs.readFile(path.resolve('packages/ui/src/components.tsx'), 'utf8');
  for (const symbol of ['Button', 'Input', 'Select', 'Card', 'LoadingState', 'ErrorState', 'Pagination', 'Skeleton', 'Alert']) {
    assert.ok(src.includes(`export function ${symbol}`), `Missing @operza/ui export: ${symbol}`);
  }
});
