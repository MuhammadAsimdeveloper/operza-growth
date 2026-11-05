export type SimulationStep = {
  id?: string;
  label?: string;
  kind: string;
  status: 'simulated' | 'failed' | 'skipped';
  detail: string;
};

export function simulateWorkflowActions(
  actions: Array<Record<string, any>>,
  contact: Record<string, any>
): { status: 'simulated' | 'failed'; steps: SimulationStep[] };
