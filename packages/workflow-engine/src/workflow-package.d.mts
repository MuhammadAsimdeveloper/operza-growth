export interface WorkflowPackage {
  format: 'operza.workflow';
  version: 1;
  exportedAt: string;
  workflow: unknown;
}

export interface WorkflowPackageOptions {
  now?: number;
}

export interface WorkflowImportOptions {
  idFactory?: (prefix: 'wf' | 'wa') => string;
}

export function exportWorkflowPackage(workflow: unknown, options?: WorkflowPackageOptions): WorkflowPackage;
export function importWorkflowPackage(input: unknown, options?: WorkflowImportOptions): {
  id: string;
  name: string;
  status: 'draft';
  trigger: { kind: string; detail?: string; every?: number; unit?: 'minutes' | 'hours' | 'days' };
  actions: unknown[];
  enrolled: number;
  completed: number;
};
