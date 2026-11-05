export interface DashboardMetricsInput {
  contacts?: unknown[];
  opportunities?: Array<{ status?: string }>;
  conversations?: Array<{ unread?: number }>;
  workflows?: Array<{ id?: string; status?: string; actions?: unknown[] }>;
  workflowRuns?: Array<{ workflowId?: string; at?: string; status?: string }>;
  integrations?: Array<{ connected?: boolean }>;
  pendingApprovals?: number | null;
  now?: number;
}

export interface DashboardMetrics {
  contacts: number;
  openDeals: number;
  unreadInbox: number;
  aiRuns24h: number;
  activeWorkflows: number;
  pendingApprovals: number | null;
  disconnectedIntegrations: number;
  failedRuns24h: number;
}

export function getDashboardMetrics(input?: DashboardMetricsInput): DashboardMetrics;
