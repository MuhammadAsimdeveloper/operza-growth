export interface User {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive';
}

export interface Agency {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'closed';
}

export interface Location {
  id: string;
  agencyId: string;
  name: string;
  timezone: string;
  status: 'active' | 'inactive';
}

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface Membership {
  id: string;
  agencyId: string;
  userId: string;
  role: Role;
  status: 'active' | 'inactive';
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  tags?: string[];
  status?: string;
  notes?: string;
  customValues?: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export interface Opportunity {
  id: string;
  name: string;
  contactId?: string;
  pipeline: string;
  stage: string;
  value: number;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  owner?: string;
  closeDate?: string;
  source?: string;
  customValues?: Record<string, any>;
}

export interface Pipeline {
  id: string;
  name: string;
  stages: string[];
  status: string;
  description?: string;
}

export interface FormDef {
  id: string;
  name: string;
  publicSlug: string;
  fields: Array<{
    id: string;
    label: string;
    type: 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox';
    required: boolean;
    options?: string[];
  }>;
  status: 'draft' | 'published';
  submissions: number;
}

export type WorkflowTriggerKind = 
  | 'form'
  | 'tag'
  | 'appointment'
  | 'opportunity_stage'
  | 'invoice'
  | 'payment'
  | 'webhook'
  | 'schedule'
  | 'manual';

export type WorkflowActionKind =
  | 'email'
  | 'sms'
  | 'wait'
  | 'tag'
  | 'task'
  | 'webhook'
  | 'condition'
  | 'ai_agent'
  | 'opportunity_stage';

export interface WorkflowNode {
  id: string;
  type: WorkflowActionKind;
  name: string;
  config: Record<string, any>;
  requiresApproval?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'paused' | 'archived';
  triggerType: WorkflowTriggerKind;
  triggerConfig: Record<string, any>;
  nodes: WorkflowNode[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowStepStatus = 'running' | 'waiting' | 'waiting_approval' | 'done' | 'completed' | 'simulated' | 'failed' | 'skipped';

export interface WorkflowExecutionStep {
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  status: WorkflowStepStatus;
  result?: unknown;
  error?: string | null;
  errorCode?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'waiting' | 'waiting_approval' | 'completed' | 'failed' | 'canceled';
  currentNodeId?: string;
  triggerEvent: Record<string, any>;
  attempts: number;
  lastErrorCode?: string;
  createdAt: string;
  finishedAt?: string;
  steps?: WorkflowExecutionStep[];
}

export type ProviderConnectionStatus = 'pending_verification' | 'verified' | 'degraded' | 'revoked';
export type CommunicationChannel = 'email' | 'sms' | 'whatsapp';
export type CommunicationPurpose = 'transactional' | 'marketing' | 'appointment' | 'review_request';
export type ConsentStatus = 'granted' | 'revoked';

export interface ProviderConnectionSummary {
  id: string;
  providerKey: string;
  channel: CommunicationChannel | 'payments';
  label: string;
  status: ProviderConnectionStatus;
  secretConfigured: boolean;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  revokedAt: string | null;
  lastCheckCode: string | null;
}

export interface CommunicationConsent {
  id: string;
  tenantId: string;
  locationId: string;
  contactId: string;
  channel: CommunicationChannel;
  purpose: CommunicationPurpose;
  status: ConsentStatus;
  source: 'web_form' | 'api' | 'keyword_opt_out' | 'manual' | 'import';
  proofRef: string | null;
  capturedAt: string;
  expiresAt: string | null;
}

export interface CopilotProposal {
  id: string;
  tenantId: string;
  locationId: string;
  requestedByActorId: string;
  toolName: string;
  params: Record<string, unknown>;
  risk: 'write' | 'workflow' | 'external_side_effect';
  status: 'pending_review' | 'rejected' | 'approved';
  requiresHumanApproval: true;
  createdAt: string;
  decidedAt: string | null;
  decidedByActorId: string | null;
}

export interface TenantEntitlements {
  planId: 'beta' | 'studio' | 'growth' | 'enterprise';
  label: string;
  pricing: null;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

export interface TenantUsageSnapshot {
  period: 'current_utc_month';
  usage: Record<string, number>;
  limits: Record<string, number>;
  features: Record<string, boolean>;
}
