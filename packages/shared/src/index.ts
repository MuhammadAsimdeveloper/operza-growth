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
}
