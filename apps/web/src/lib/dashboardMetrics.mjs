const DAY_MS = 24 * 60 * 60 * 1000;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function countAiNodes(actions) {
  return list(actions).reduce((count, action) => {
    const kind = typeof action?.kind === 'string' ? action.kind.toLowerCase() : '';
    return count + (kind === 'ai_agent' || kind.startsWith('ai_') ? 1 : 0) +
      countAiNodes(action?.yes) + countAiNodes(action?.no);
  }, 0);
}

function isRecent(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && timestamp >= now - DAY_MS;
}

/**
 * Derive dashboard values from workspace data. This function never supplies
 * demo counts and leaves external approval-queue data unknown when unavailable.
 */
export function getDashboardMetrics({
  contacts,
  opportunities,
  conversations,
  workflows,
  workflowRuns,
  integrations,
  pendingApprovals = null,
  now = Date.now()
} = {}) {
  const safeWorkflows = list(workflows);
  const safeRuns = list(workflowRuns);
  const aiWorkflowIds = new Set(
    safeWorkflows
      .filter((workflow) => countAiNodes(workflow?.actions) > 0)
      .map((workflow) => workflow?.id)
      .filter((id) => typeof id === 'string' && id.length > 0)
  );
  const recentRuns = safeRuns.filter((run) => isRecent(run?.at, now));
  const queueCount = Number.isInteger(pendingApprovals) && pendingApprovals >= 0
    ? pendingApprovals
    : null;

  return {
    contacts: list(contacts).length,
    openDeals: list(opportunities).filter((item) => item?.status === 'open').length,
    unreadInbox: list(conversations).reduce((total, item) => {
      const unread = Number.isFinite(item?.unread) ? Math.max(0, Math.floor(item.unread)) : 0;
      return total + unread;
    }, 0),
    aiRuns24h: recentRuns.filter((run) => aiWorkflowIds.has(run?.workflowId)).length,
    activeWorkflows: safeWorkflows.filter((workflow) => workflow?.status === 'published').length,
    pendingApprovals: queueCount,
    disconnectedIntegrations: list(integrations).filter((item) => item?.connected === false).length,
    failedRuns24h: recentRuns.filter((run) => run?.status === 'failed').length
  };
}
