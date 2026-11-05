import assert from 'node:assert/strict';
import test from 'node:test';
import { getDashboardMetrics } from '../../../apps/web/src/lib/dashboardMetrics.mjs';

test('dashboard metrics count actual workspace records without inventing activity', () => {
  const metrics = getDashboardMetrics({
    now: Date.parse('2026-11-06T12:00:00.000Z'),
    contacts: [{ id: 'c1' }, { id: 'c2' }],
    opportunities: [
      { id: 'o1', status: 'open' },
      { id: 'o2', status: 'won' },
      { id: 'o3', status: 'open' }
    ],
    conversations: [{ unread: 3 }, { unread: 0 }, { unread: 2 }],
    workflows: [{ id: 'w1', status: 'published', actions: [] }, { id: 'w2', status: 'draft', actions: [] }],
    workflowRuns: [],
    integrations: [{ connected: true }, { connected: false }]
  });

  assert.equal(metrics.contacts, 2);
  assert.equal(metrics.openDeals, 2);
  assert.equal(metrics.unreadInbox, 5);
  assert.equal(metrics.activeWorkflows, 1);
  assert.equal(metrics.disconnectedIntegrations, 1);
  assert.equal(metrics.aiRuns24h, 0);
  assert.equal(metrics.failedRuns24h, 0);
});

test('AI activity counts only recent runs belonging to workflows with AI nodes', () => {
  const metrics = getDashboardMetrics({
    now: Date.parse('2026-11-06T12:00:00.000Z'),
    workflows: [
      { id: 'ai', actions: [{ kind: 'ai_agent' }] },
      { id: 'plain', actions: [{ kind: 'tag' }] }
    ],
    workflowRuns: [
      { workflowId: 'ai', at: '2026-11-06T11:00:00.000Z', status: 'success' },
      { workflowId: 'ai', at: '2026-11-05T10:00:00.000Z', status: 'success' },
      { workflowId: 'plain', at: '2026-11-06T11:30:00.000Z', status: 'success' },
      { workflowId: 'ai', at: '2026-11-06T10:00:00.000Z', status: 'failed' }
    ]
  });

  assert.equal(metrics.aiRuns24h, 2);
  assert.equal(metrics.failedRuns24h, 1);
});

test('approval queue remains unknown when the approval endpoint is unavailable', () => {
  const metrics = getDashboardMetrics({
    now: Date.parse('2026-11-06T12:00:00.000Z'),
    pendingApprovals: null
  });

  assert.equal(metrics.pendingApprovals, null);
});
