import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, EmptyState } from './ui';

interface ModelEntry {
  provider: string;
  modelId: string;
  contextWindow: number;
  readiness: string;
  toolCalling: boolean;
  paid: boolean;
}

interface SpecialistEntry {
  type: string;
  purpose: string;
  allowedTools: string[];
  approvalPolicy: string;
}

interface AgentRow {
  id: string;
  name: string;
  persona: string;
  model: string;
  status: string;
  max_steps: number;
}

interface RunRow {
  id: string;
  model: string;
  status: string;
  steps_count: number;
  estimated_cost_microcents: number;
  created_at: string;
}

export function AiStudio2Panel() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'agents' | 'models' | 'runs' | 'evals'>('agents');
  const [newAgentName, setNewAgentName] = useState('');
  const [evalSummary, setEvalSummary] = useState<{ passed: boolean; passedCases: number; totalCases: number } | null>(null);

  const { data: modelsData } = useQuery<{ models?: ModelEntry[] }>({
    queryKey: ['ai', 'v2', 'models'],
    queryFn: () => api('/api/ai/v2/models'),
  });

  const { data: specialistsData } = useQuery<{ specialists?: SpecialistEntry[] }>({
    queryKey: ['ai', 'v2', 'specialists'],
    queryFn: () => api('/api/ai/v2/specialists'),
  });

  const { data: agentsData } = useQuery<{ agents?: AgentRow[] }>({
    queryKey: ['ai', 'v2', 'agents'],
    queryFn: () => api('/api/ai/v2/agents'),
  });

  const { data: runsData } = useQuery<{ runs?: RunRow[] }>({
    queryKey: ['ai', 'v2', 'runs'],
    queryFn: () => api('/api/ai/v2/runs'),
  });

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;
    await api('/api/ai/v2/agents', {
      method: 'POST',
      body: JSON.stringify({ name: newAgentName.trim(), persona: 'executive', model: 'operza-deterministic-v1' }),
    });
    setNewAgentName('');
    await queryClient.invalidateQueries({ queryKey: ['ai', 'v2', 'agents'] });
  };

  const handleRunEval = async () => {
    const res = await api<{ evalResult?: { passed: boolean; passedCases: number; totalCases: number } }>('/api/ai/v2/evals/run', {
      method: 'POST',
      body: '{}',
    });
    if (res?.evalResult) setEvalSummary(res.evalResult);
  };

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, marginBottom: 18, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>AI Studio 2.0 &amp; Bounded Agent Runtime</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Models: {modelsData?.models?.length ?? 0} · Specialists: {specialistsData?.specialists?.length ?? 0} · Custom Agents: {agentsData?.agents?.length ?? 0}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['agents', 'models', 'runs', 'evals'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'btn btn--primary' : 'btn btn--ghost'}
              onClick={() => setTab(t)}
            >
              {t === 'agents' ? 'Agents & Specialists' : t === 'models' ? 'Model Gateway' : t === 'runs' ? 'Runs & Cost' : 'Safety & Evals'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'agents' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              className="input"
              placeholder="New agent name..."
              value={newAgentName}
              onChange={(e) => setNewAgentName(e.target.value)}
            />
            <button type="button" className="btn btn--primary" onClick={handleCreateAgent}>Create Agent</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
            {(specialistsData?.specialists || []).map((sp) => (
              <div key={sp.type} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{sp.type}</strong>
                  <Badge tone="blue">{sp.approvalPolicy}</Badge>
                </div>
                <div style={{ opacity: 0.78 }}>{sp.purpose}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'models' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          {(modelsData?.models || []).map((m) => (
            <div key={m.modelId} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
              <span><strong>{m.modelId}</strong> ({m.provider}) · {m.contextWindow.toLocaleString()} ctx</span>
              <Badge tone={m.readiness === 'operationally_verified' ? 'green' : 'amber'}>{m.readiness}</Badge>
            </div>
          ))}
        </div>
      )}

      {tab === 'runs' && (
        (runsData?.runs || []).length === 0 ? (
          <EmptyState icon="sparkles" title="No AI 2.0 runs recorded" body="Agent runs, step plans, and token cost estimates appear here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            {(runsData?.runs || []).map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
                <span>{r.model} · {r.steps_count} steps</span>
                <Badge tone={r.status === 'completed' ? 'green' : 'amber'}>{r.status}</Badge>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'evals' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <div>
            <button type="button" className="btn btn--primary" onClick={handleRunEval}>Run Deterministic Eval Gate</button>
          </div>
          {evalSummary && (
            <Badge tone={evalSummary.passed ? 'green' : 'red'}>
              {evalSummary.passed ? `PASS (${evalSummary.passedCases}/${evalSummary.totalCases})` : 'FAIL'}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
