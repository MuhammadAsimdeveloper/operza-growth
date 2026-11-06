import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { authorizeCopilotTool } from '../src/tool-permissions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await readFile(path.resolve(here, '../evals/copilot-safety-cases.json'), 'utf8'));

test('Copilot safety evaluation fixtures remain within expected permission boundaries', () => {
  assert.equal(fixture.version, 1);
  for (const item of fixture.cases) {
    const actual = authorizeCopilotTool({
      toolName: item.tool,
      actorRole: item.actorRole,
      tenantCapability: item.tenantCapability ?? true
    });
    assert.equal(actual.decision, item.expectedDecision, item.id);
  }
});
