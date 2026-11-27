import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { request } from '../lib/api';
import { Badge } from './ui';
import type { Workflow, WorkflowRun } from '../lib/types';

interface RegistryNode {
  type: string;
  displayName: string;
  description: string;
  category: string;
  riskLevel: string;
}

interface ValidationIssue {
  code: string;
  nodeId?: string;
  message: string;
}

const STATUS_BORDER: Record<string, string> = {
  completed: '#10b981',
  running: '#3b82f6',
  failed: '#ef4444',
  skipped: '#94a3b8',
  waiting_approval: '#f59e0b',
  waiting: '#f59e0b',
};

function buildInitialGraph(workflow: Workflow): { nodes: Node[]; edges: Edge[] } {
  const flowNodes: Node[] = [
    {
      id: 'trigger',
      position: { x: 240, y: 20 },
      data: { label: `Trigger: ${workflow.trigger.kind.replace(/_/g, ' ')}`, kind: workflow.trigger.kind },
      style: {
        background: '#eef2ff',
        border: '2px solid #6366f1',
        borderRadius: 10,
        padding: '8px 14px',
        fontWeight: 600,
        fontSize: 12,
        color: '#1e1b4b',
      },
    },
  ];
  const flowEdges: Edge[] = [];
  let prevId = 'trigger';

  (workflow.actions || []).forEach((action, index) => {
    const nodeId = action.id || `node_${index}`;
    flowNodes.push({
      id: nodeId,
      position: { x: 240, y: 120 + index * 105 },
      data: {
        label: `${action.kind.toUpperCase()}: ${action.label}`,
        kind: action.kind,
        rawLabel: action.label,
        config: action.config || {},
      },
      style: {
        background: '#ffffff',
        border: '1px solid #cbd5e1',
        borderRadius: 10,
        padding: '8px 14px',
        fontSize: 12,
        color: '#0f172a',
      },
    });
    flowEdges.push({
      id: `e_${prevId}_${nodeId}`,
      source: prevId,
      target: nodeId,
      animated: true,
    });
    prevId = nodeId;
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export function WorkflowGraphV2({
  workflow,
  activeRun,
  onSelectActionId,
}: {
  workflow: Workflow;
  activeRun?: WorkflowRun | null;
  onSelectActionId?: (actionId: string) => void;
}) {
  const initial = useMemo(() => buildInitialGraph(workflow), [workflow]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [history, setHistory] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const [redoStack, setRedoStack] = useState<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const [clipboard, setClipboard] = useState<Node[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeSearch, setNodeSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [validationState, setValidationState] = useState<{
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [recoverableDraft, setRecoverableDraft] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  const draftKey = `operza_wf_draft_${workflow.id}`;

  const { data: registryData } = useQuery<{ nodes?: RegistryNode[] }>({
    queryKey: ['workflows', 'v2', 'registry'],
    queryFn: () => request<{ nodes?: RegistryNode[] }>('/api/workflows/v2/registry'),
  });

  const registryNodes = registryData?.nodes || [];
  const filteredPalette = useMemo(() => {
    const q = nodeSearch.trim().toLowerCase();
    return registryNodes.filter((n) => {
      if (n.category === 'triggers') return false;
      if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
      if (!q) return true;
      return n.displayName.toLowerCase().includes(q) || n.type.toLowerCase().includes(q);
    });
  }, [registryNodes, nodeSearch, categoryFilter]);

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed?.nodes) && parsed.nodes.length !== initial.nodes.length) {
          setRecoverableDraft(parsed);
        }
      }
    } catch {
      // ignore invalid localStorage draft
    }
  }, [initial, draftKey, setNodes, setEdges]);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ nodes, edges }));
    } catch {
      // ignore storage quota errors
    }
  }, [draftKey, nodes, edges]);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-24), { nodes, edges }]);
    setRedoStack([]);
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, { nodes, edges }]);
      setNodes(last.nodes);
      setEdges(last.edges);
      return prev.slice(0, -1);
    });
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setHistory((h) => [...h, { nodes, edges }]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return prev.slice(0, -1);
    });
  }, [nodes, edges, setNodes, setEdges]);

  const handleAddRegistryNode = useCallback(
    (item: RegistryNode) => {
      pushHistory();
      const id = `${item.type}_${Date.now().toString(36)}`;
      const newNode: Node = {
        id,
        position: { x: 260, y: 120 + nodes.length * 90 },
        data: { label: `${item.type.toUpperCase()}: ${item.displayName}`, kind: item.type, rawLabel: item.displayName, config: {} },
        style: {
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          padding: '8px 14px',
          fontSize: 12,
          color: '#0f172a',
        },
      };
      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(id);
    },
    [nodes.length, pushHistory, setNodes]
  );

  const handleDeleteSelected = useCallback(() => {
    const selectedIds = new Set(nodes.filter((n) => (n.selected || n.id === selectedNodeId) && n.id !== 'trigger').map((n) => n.id));
    if (selectedIds.size === 0) return;
    pushHistory();
    setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
    setEdges((eds) => eds.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target)));
    setSelectedNodeId(null);
  }, [nodes, selectedNodeId, pushHistory, setNodes, setEdges]);

  const handleDuplicateSelected = useCallback(() => {
    const targets = nodes.filter((n) => (n.selected || n.id === selectedNodeId) && n.id !== 'trigger');
    if (targets.length === 0) return;
    pushHistory();
    const clones = targets.map((n, i) => ({
      ...n,
      id: `${n.id}_copy_${Date.now().toString(36)}_${i}`,
      selected: false,
      position: { x: n.position.x + 40, y: n.position.y + 40 },
    }));
    setNodes((nds) => [...nds, ...clones]);
  }, [nodes, selectedNodeId, pushHistory, setNodes]);

  const handleAutoLayout = useCallback(() => {
    pushHistory();
    setNodes((nds) =>
      nds.map((n, idx) => ({
        ...n,
        position: { x: 240, y: 20 + idx * 105 },
      }))
    );
  }, [pushHistory, setNodes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const picked = nodes.filter((n) => (n.selected || n.id === selectedNodeId) && n.id !== 'trigger');
        if (picked.length > 0) setClipboard(picked);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.length > 0) {
        e.preventDefault();
        pushHistory();
        const pasted = clipboard.map((n, idx) => ({
          ...n,
          id: `${n.id}_paste_${Date.now().toString(36)}_${idx}`,
          position: { x: n.position.x + 50, y: n.position.y + 50 },
        }));
        setNodes((nds) => [...nds, ...pasted]);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, handleDeleteSelected, nodes, selectedNodeId, clipboard, pushHistory, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...connection, animated: true }, eds));
    },
    [pushHistory, setEdges]
  );

  const stepStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of activeRun?.steps || []) {
      const stepRec = s as unknown as { nodeId?: string; actionId?: string; stepId?: string };
      const id = stepRec.nodeId || stepRec.actionId || stepRec.stepId;
      if (id) map.set(id, s.status);
    }
    return map;
  }, [activeRun]);

  const styledNodes = useMemo(
    () =>
      nodes.map((n) => {
        const runStatus = stepStatusMap.get(n.id);
        if (!runStatus) return n;
        return {
          ...n,
          style: {
            ...n.style,
            border: `2px solid ${STATUS_BORDER[runStatus] || '#6366f1'}`,
          },
        };
      }),
    [nodes, stepStatusMap]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const runValidation = async () => {
    const payloadNodes = nodes
      .filter((n) => n.id !== 'trigger')
      .map((n) => ({
        id: n.id,
        kind: (n.data as Record<string, unknown>)?.kind || 'tag',
        label: (n.data as Record<string, unknown>)?.rawLabel || String((n.data as Record<string, unknown>)?.label || n.id),
        config: ((n.data as Record<string, unknown>)?.config as Record<string, unknown>) || {},
      }));
    const res = await request<{ valid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] }>(
      '/api/workflows/v2/validate',
      { method: 'POST', body: JSON.stringify({ nodes: payloadNodes, edges, trigger: workflow.trigger }) }
    );
    setValidationState(res);
  };

  const saveDraft = async () => {
    const payloadNodes = nodes
      .filter((n) => n.id !== 'trigger')
      .map((n) => ({
        id: n.id,
        kind: (n.data as Record<string, unknown>)?.kind || 'tag',
        label: (n.data as Record<string, unknown>)?.rawLabel || String((n.data as Record<string, unknown>)?.label || n.id),
        config: ((n.data as Record<string, unknown>)?.config as Record<string, unknown>) || {},
      }));
    await request(`/api/workflows/v2/${workflow.id}/draft`, {
      method: 'POST',
      body: JSON.stringify({ nodes: payloadNodes, graphJson: { nodes: payloadNodes, edges } }),
    });
    localStorage.removeItem(draftKey);
    setRecoverableDraft(null);
    setSaveMessage('Draft saved');
    setTimeout(() => setSaveMessage(null), 2500);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 260px', gap: 10, height: 540 }}>
      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, overflowY: 'auto', background: 'var(--surface)' }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Node Library</div>
        <input
          className="input"
          placeholder="Search nodes..."
          value={nodeSearch}
          onChange={(e) => setNodeSearch(e.target.value)}
          style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
        />
        <select
          className="input"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
        >
          <option value="all">All categories</option>
          <option value="crm">CRM 2.0</option>
          <option value="communication">Communication</option>
          <option value="logic">Logic & Flow</option>
          <option value="data">Data Ops</option>
          <option value="commerce">Commerce</option>
          <option value="ai">AI Ops</option>
        </select>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filteredPalette.map((item) => (
            <button
              key={item.type}
              type="button"
              className="btn btn--ghost"
              onClick={() => handleAddRegistryNode(item)}
              style={{ justifyContent: 'space-between', fontSize: 11, padding: '5px 8px', textAlign: 'left' }}
              title={item.description}
            >
              <span>{item.displayName}</span>
              <span style={{ opacity: 0.6 }}>{item.category}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--ghost" onClick={handleUndo} disabled={history.length === 0}>Undo</button>
          <button type="button" className="btn btn--ghost" onClick={handleRedo} disabled={redoStack.length === 0}>Redo</button>
          <button type="button" className="btn btn--ghost" onClick={handleDuplicateSelected}>Duplicate</button>
          <button type="button" className="btn btn--ghost" onClick={handleDeleteSelected}>Delete</button>
          <button type="button" className="btn btn--ghost" onClick={handleAutoLayout}>Auto Layout</button>
          <button type="button" className="btn btn--ghost" onClick={runValidation}>Validate</button>
          <button type="button" className="btn btn--primary" onClick={saveDraft}>Save Draft</button>
          {saveMessage && <Badge tone="green">{saveMessage}</Badge>}
        </div>

        {recoverableDraft && (
          <div style={{ padding: '6px 10px', borderRadius: 8, background: '#fef3c7', color: '#78350f', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Unsaved local draft detected.</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setNodes(recoverableDraft.nodes);
                  setEdges(recoverableDraft.edges);
                  setRecoverableDraft(null);
                }}
              >
                Recover
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  localStorage.removeItem(draftKey);
                  setRecoverableDraft(null);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
          <ReactFlow
            nodes={styledNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            selectionOnDrag
            multiSelectionKeyCode="Shift"
            fitView
            onNodeClick={(_evt, node) => {
              setSelectedNodeId(node.id);
              setContextMenu(null);
              if (node.id !== 'trigger' && onSelectActionId) {
                onSelectActionId(node.id);
              }
            }}
            onNodeContextMenu={(evt, node) => {
              evt.preventDefault();
              setSelectedNodeId(node.id);
              setContextMenu({ x: evt.clientX, y: evt.clientY, nodeId: node.id });
            }}
            onPaneClick={() => setContextMenu(null)}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
          {contextMenu && (
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 60,
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <button type="button" className="btn btn--ghost" onClick={() => { handleDuplicateSelected(); setContextMenu(null); }}>Duplicate Node</button>
              <button type="button" className="btn btn--ghost" onClick={() => { handleDeleteSelected(); setContextMenu(null); }}>Delete Node</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, overflowY: 'auto', background: 'var(--surface)' }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Inspector & Validation</div>
        {selectedNode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div><strong>ID:</strong> {selectedNode.id}</div>
            <div><strong>Type:</strong> {String((selectedNode.data as Record<string, unknown>)?.kind || 'node')}</div>
            <label>
              Label
              <input
                className="input"
                value={String((selectedNode.data as Record<string, unknown>)?.label || '')}
                onChange={(e) => {
                  const val = e.target.value;
                  setNodes((nds) =>
                    nds.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, label: val, rawLabel: val } } : n))
                  );
                }}
              />
            </label>
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.7 }}>Select a node to inspect or edit.</div>
        )}

        {validationState && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
            <Badge tone={validationState.valid ? 'green' : 'red'}>
              {validationState.valid ? 'Graph Valid' : `${validationState.errors.length} Error(s)`}
            </Badge>
            {validationState.errors.map((err, i) => (
              <div key={i} style={{ color: '#ef4444' }}>{err.code}: {err.message}</div>
            ))}
            {validationState.warnings.map((w, i) => (
              <div key={i} style={{ color: '#f59e0b' }}>{w.code}: {w.message}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
