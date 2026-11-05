import assert from 'node:assert/strict';
import test from 'node:test';
import { exportWorkflowPackage, importWorkflowPackage } from '../src/workflow-package.mjs';

const sampleWorkflow = () => ({
  id: 'wf_original',
  name: 'Lead triage',
  status: 'published',
  trigger: { kind: 'webhook', detail: 'incoming-leads' },
  actions: [{
    id: 'condition_original',
    kind: 'condition',
    label: 'Is a priority lead?',
    config: { rule: { field: 'tag', operator: 'contains', value: 'priority' } },
    yes: [{ id: 'tag_original', kind: 'tag', label: 'Mark priority', config: { tag: 'priority' } }],
    no: [{ id: 'task_original', kind: 'task', label: 'Create follow-up', config: { title: 'Review new lead', dueInDays: 2 } }]
  }],
  enrolled: 14,
  completed: 9
});

test('workflow packages round-trip supported nodes but import as a new draft', () => {
  const exported = exportWorkflowPackage(sampleWorkflow(), { now: Date.parse('2026-11-06T12:00:00.000Z') });
  let sequence = 0;
  const imported = importWorkflowPackage(JSON.parse(JSON.stringify(exported)), {
    idFactory: (prefix) => `${prefix}_imported_${++sequence}`
  });

  assert.equal(exported.format, 'operza.workflow');
  assert.equal(exported.version, 1);
  assert.equal(imported.name, 'Lead triage');
  assert.equal(imported.status, 'draft');
  assert.equal(imported.enrolled, 0);
  assert.equal(imported.completed, 0);
  assert.equal(imported.id, 'wf_imported_1');
  assert.equal(imported.actions[0].id, 'wa_imported_2');
  assert.equal(imported.actions[0].yes[0].id, 'wa_imported_3');
  assert.equal(imported.actions[0].no[0].id, 'wa_imported_4');
});

test('workflow packages reject credential-like fields instead of silently exporting them', () => {
  const workflow = sampleWorkflow();
  workflow.actions[0].config.apiKey = 'not-a-real-key';
  assert.throws(() => exportWorkflowPackage(workflow), { code: 'CREDENTIAL_FIELD' });
});

test('workflow packages reject embedded URL credentials and unsupported node types', () => {
  const workflow = sampleWorkflow();
  workflow.actions = [{
    id: 'http_1',
    kind: 'webhook',
    label: 'Call endpoint',
    config: { url: 'https://user:pass@example.test/hook' }
  }];
  assert.throws(() => exportWorkflowPackage(workflow), { code: 'URL_CREDENTIALS' });

  workflow.actions = [{ id: 'code_1', kind: 'code', label: 'Run JavaScript' }];
  assert.throws(() => exportWorkflowPackage(workflow), { code: 'UNSUPPORTED_NODE' });
});

test('workflow imports reject unknown formats and malformed branch structures', () => {
  assert.throws(() => importWorkflowPackage({ format: 'n8n.workflow', version: 1 }), { code: 'PACKAGE_FORMAT' });
  const exported = exportWorkflowPackage(sampleWorkflow());
  exported.workflow.actions[0].yes = { node: 'not-an-array' };
  assert.throws(() => importWorkflowPackage(exported), { code: 'INVALID_BRANCH' });
});
