export type SimulationStep = {
  id?: string;
  label?: string;
  kind: string;
  status: 'simulated' | 'failed' | 'skipped';
  detail: string;
};

export function simulateWorkflowActions(
  actions: unknown[],
  contact: unknown
): { status: 'simulated' | 'failed'; steps: SimulationStep[] };
