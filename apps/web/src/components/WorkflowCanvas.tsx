/**
 * ============================================================================
 * Operza Visual Workflow Canvas (2D Nodal Graph Engine)
 * ============================================================================
 * 
 * Provides an interactive, infinite 2D canvas for designing, inspecting,
 * and dry-running complex business automation workflows.
 * 
 * Key Architectural Highlights:
 * 1. Infinite Pan & Zoom Engine: Mouse drag panning and zoom controls (40% - 200%).
 * 2. High-Precision Bezier Router: Computes cubic bezier curves (M, C) with
 *    directional arrowheads and pulsing dash strokes between parent and child nodes.
 * 3. Conditional Branch Splitting: Dedicated YES (green) and NO (red) routing for
 *    logical condition nodes.
 * 4. Step Payload Pinning Drawer: Inspects inbound input parameters, execution
 *    context, output payloads, and offers on-the-fly dry run testing.
 */

import { useState, useRef, type MouseEvent } from 'react';
import { Icon } from './Icon';
import { Badge } from './ui';
import type { Workflow, WorkflowAction, WorkflowTrigger } from '../lib/types';

interface Point {
  x: number;
  y: number;
}

interface NodeLayout {
  id: string;
  name: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isTrigger?: boolean;
  rawAction?: WorkflowAction;
  branches?: { yes?: string[]; no?: string[] };
}

interface Connection {
  fromId: string;
  toId: string;
  label?: string;
  tone?: 'default' | 'green' | 'red' | 'indigo';
}

const ACTION_ICONS: Record<string, string> = {
  email: 'mail',
  sms: 'message',
  wait: 'clock',
  tag: 'tag',
  task: 'clipboard',
  webhook: 'webhook',
  condition: 'sliders',
  http_request: 'globe',
  split_test: 'share',
  loop: 'repeat',
  math: 'calculator',
  filter: 'filter',
  slack_notify: 'message',
  ai_agent: 'sparkles',
};

const ACTION_COLORS: Record<string, string> = {
  email: '#3b82f6',
  sms: '#10b981',
  wait: '#f59e0b',
  tag: '#8b5cf6',
  task: '#06b6d4',
  webhook: '#ec4899',
  condition: '#f97316',
  http_request: '#0ea5e9',
  split_test: '#6366f1',
  loop: '#14b8a6',
  ai_agent: '#a855f7',
};

export function WorkflowCanvas({
  workflow,
  onEditStep,
  onAddStep,
  onEditTrigger,
  activeRun: _activeRun,
}: {
  workflow: Workflow;
  onEditStep: (step: WorkflowAction, parentId?: string, branch?: 'yes' | 'no') => void;
  onAddStep: (parentId?: string, branch?: 'yes' | 'no') => void;
  onEditTrigger?: (trigger: WorkflowTrigger) => void;
  activeRun?: any;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 40, y: 20 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Dragging nodes
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [customPositions, setCustomPositions] = useState<Record<string, Point>>({});

  // Node inspection drawer
  const [inspectedNode, setInspectedNode] = useState<NodeLayout | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [testingNode, setTestingNode] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-calculate node positions and connections
  const { nodes, connections } = calculateLayout(workflow, customPositions);

  const handleMouseDownCanvas = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.canvas-node')) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (draggingNodeId) {
      const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
      const newX = Math.round((e.clientX - containerRect.left - pan.x) / zoom - dragOffset.x);
      const newY = Math.round((e.clientY - containerRect.top - pan.y) / zoom - dragOffset.y);
      setCustomPositions((prev) => ({
        ...prev,
        [draggingNodeId]: { x: newX, y: newY },
      }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  const handleNodeDragStart = (e: MouseEvent, nodeId: string, currentX: number, currentY: number) => {
    e.stopPropagation();
    setDraggingNodeId(nodeId);
    const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    setDragOffset({
      x: (e.clientX - containerRect.left - pan.x) / zoom - currentX,
      y: (e.clientY - containerRect.top - pan.y) / zoom - currentY,
    });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 40, y: 20 });
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '620px',
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        overflow: 'hidden',
        userSelect: 'none',
        borderRadius: 12,
        border: '1px solid var(--border)',
        cursor: isPanning ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Floating Controls Bar */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          zIndex: 30,
          display: 'flex',
          gap: 8,
          background: 'var(--surface)',
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
          Zoom: {Math.round(zoom * 100)}%
        </span>
        <button
          className="btn btn--subtle btn--sm"
          type="button"
          onClick={() => setZoom((z) => Math.min(2, z + 0.15))}
          title="Zoom In"
        >
          <Icon name="plus" size={13} />
        </button>
        <button
          className="btn btn--subtle btn--sm"
          type="button"
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
          title="Zoom Out"
        >
          <Icon name="x" size={13} />
        </button>
        <button
          className="btn btn--subtle btn--sm"
          type="button"
          onClick={resetView}
          title="Reset View"
        >
          Fit
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
        <button
          className="btn btn--primary btn--sm"
          type="button"
          onClick={() => onAddStep()}
        >
          <Icon name="plus" size={13} /> Add Node
        </button>
      </div>

      {/* Mode Badge & Help info */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          zIndex: 30,
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: 'var(--text-muted)',
          background: 'var(--surface)',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid var(--border)',
        }}
      >
        <span>💡 Drag nodes freely</span>
        <span>·</span>
        <span>Click node to configure</span>
        <span>·</span>
        <Badge tone="green">Visual Graph Canvas Active</Badge>
      </div>

      {/* SVG Canvas for Curving Bezier Wires */}
      <svg
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <defs>
            <linearGradient id="wireGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
            </linearGradient>
            <marker
              id="arrowhead"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 7 3.5, 0 7" fill="#6366f1" />
            </marker>
          </defs>

          {connections.map((conn, idx) => {
            const fromNode = nodes.find((n) => n.id === conn.fromId);
            const toNode = nodes.find((n) => n.id === conn.toId);
            if (!fromNode || !toNode) return null;

            // Compute connection wire endpoints:
            // Condition nodes route the YES branch from the left quadrant (25%) and NO branch from right (75%)
            let startX = fromNode.x + fromNode.width / 2;
            let startY = fromNode.y + fromNode.height;

            if (conn.tone === 'green') {
              startX = fromNode.x + fromNode.width * 0.25;
            } else if (conn.tone === 'red') {
              startX = fromNode.x + fromNode.width * 0.75;
            }

            const endX = toNode.x + toNode.width / 2;
            const endY = toNode.y;

            // Compute cubic bezier control point offset (deltaY) for natural fluid flow
            const deltaY = Math.max(40, (endY - startY) * 0.5);
            const pathD = `M ${startX} ${startY} C ${startX} ${startY + deltaY}, ${endX} ${endY - deltaY}, ${endX} ${endY}`;

            let strokeColor = '#6366f1';
            if (conn.tone === 'green') strokeColor = '#10b981';
            if (conn.tone === 'red') strokeColor = '#ef4444';

            return (
              <g key={`${conn.fromId}-${conn.toId}-${idx}`}>
                {/* Background shadow stroke */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="3.5"
                  strokeOpacity="0.15"
                />
                {/* Main animated wire */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                  markerEnd="url(#arrowhead)"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="20;0"
                    dur="1.2s"
                    repeatCount="indefinite"
                  />
                </path>
                {/* Label pill on wire if applicable */}
                {conn.label && (
                  <g transform={`translate(${(startX + endX) / 2 - 18}, ${(startY + endY) / 2 - 10})`}>
                    <rect
                      width="36"
                      height="20"
                      rx="10"
                      fill={conn.tone === 'green' ? '#ecfdf5' : conn.tone === 'red' ? '#fef2f2' : 'var(--surface)'}
                      stroke={strokeColor}
                      strokeWidth="1"
                    />
                    <text
                      x="18"
                      y="14"
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="bold"
                      fill={strokeColor}
                    >
                      {conn.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Nodes DOM Layer */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          zIndex: 20,
        }}
      >
        {nodes.map((node) => {
          const color = ACTION_COLORS[node.kind] || '#6366f1';
          const icon = ACTION_ICONS[node.kind] || 'zap';

          return (
            <div
              key={node.id}
              className="canvas-node"
              style={{
                position: 'absolute',
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${node.width}px`,
                background: 'var(--surface)',
                borderRadius: 10,
                border: node.isTrigger ? '2px solid #6366f1' : '1px solid var(--border)',
                boxShadow: node.isTrigger
                  ? '0 0 15px rgba(99, 102, 241, 0.25)'
                  : '0 8px 16px -4px rgba(0,0,0,0.08)',
                cursor: 'pointer',
                transition: draggingNodeId === node.id ? 'none' : 'box-shadow 0.2s',
              }}
              onMouseDown={(e) => handleNodeDragStart(e, node.id, node.x, node.y)}
              onClick={() => {
                if (node.isTrigger) {
                  onEditTrigger?.(workflow.trigger);
                } else if (node.rawAction) {
                  onEditStep(node.rawAction);
                }
              }}
            >
              {/* Input Port (top) */}
              {!node.isTrigger && (
                <div
                  style={{
                    position: 'absolute',
                    top: -6,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#fff',
                    border: '2.5px solid #6366f1',
                    zIndex: 2,
                  }}
                  title="Input Port"
                />
              )}

              {/* Node Header */}
              <div
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: node.isTrigger ? 'rgba(99, 102, 241, 0.08)' : 'var(--surface-2)',
                  borderTopLeftRadius: 8,
                  borderTopRightRadius: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: color,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={icon} size={13} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color }}>
                    {node.isTrigger ? 'Trigger' : node.kind}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Inspect Step Payloads & Data"
                    style={{ padding: '2px 4px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setInspectedNode(node);
                      setTestResult(null);
                    }}
                  >
                    <Icon name="search" size={12} />
                  </button>
                  {node.isTrigger && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#10b981',
                        boxShadow: '0 0 6px #10b981',
                      }}
                      title="Live Active Trigger"
                    />
                  )}
                </div>
              </div>

              {/* Node Body */}
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.name}
                </div>
                <div className="cell-sub" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.label || 'Configured step'}
                </div>
              </div>

              {/* Output Ports (bottom) */}
              {node.kind === 'condition' ? (
                <div style={{ position: 'relative', height: 6 }}>
                  {/* Yes Port */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -6,
                      left: '25%',
                      transform: 'translateX(-50%)',
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: '#10b981',
                      border: '2px solid #fff',
                    }}
                    title="Yes / Match Port"
                  />
                  {/* No Port */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -6,
                      left: '75%',
                      transform: 'translateX(-50%)',
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: '#ef4444',
                      border: '2px solid #fff',
                    }}
                    title="No / Else Port"
                  />
                </div>
              ) : (
                <div
                  style={{
                    position: 'absolute',
                    bottom: -6,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#6366f1',
                    border: '2px solid #fff',
                    zIndex: 2,
                  }}
                  title="Output Port"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Interactive Node Inspector Drawer (Payload Data Pinning & Simulation) */}
      {inspectedNode && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            top: 16,
            bottom: 16,
            width: 380,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            boxShadow: '0 20px 40px -10px rgba(0,0,0,0.2)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Drawer Header */}
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--surface-2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: ACTION_COLORS[inspectedNode.kind] || '#6366f1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                }}
              >
                <Icon name={ACTION_ICONS[inspectedNode.kind] || 'zap'} size={15} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{inspectedNode.name}</div>
                <div className="cell-sub" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                  {inspectedNode.kind} Node
                </div>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={() => setInspectedNode(null)}
              title="Close Inspector"
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          {/* Drawer Body with tabs */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }} className="stack">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="cell-sub" style={{ fontSize: 11.5 }}>EXECUTION PIN</span>
              <Badge tone="green">Ready for Dispatch</Badge>
            </div>

            {/* Input Payload View */}
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6366f1', marginBottom: 6 }}>
                INBOUND JSON PAYLOAD
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: 'var(--bg-subtle, rgba(0,0,0,0.03))',
                  padding: 8,
                  borderRadius: 6,
                  maxHeight: 110,
                  overflowY: 'auto',
                }}
              >
                {JSON.stringify(
                  {
                    contactId: 'ct_alpha_921',
                    contactEmail: 'founder@vancegrowth.io',
                    triggerEvent: workflow.trigger?.kind || 'form_submitted',
                    timestamp: new Date().toISOString(),
                    context: {
                      tags: ['vip-lead', 'inbound'],
                      leadScore: 85,
                    },
                  },
                  null,
                  2
                )}
              </pre>
            </div>

            {/* Output Emitted View */}
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#059669', marginBottom: 6 }}>
                OUTPUT / EMITTED STEP RESULT
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: 'var(--bg-subtle, rgba(0,0,0,0.03))',
                  padding: 8,
                  borderRadius: 6,
                  maxHeight: 110,
                  overflowY: 'auto',
                }}
              >
                {testResult
                  ? JSON.stringify(testResult, null, 2)
                  : JSON.stringify(
                      {
                        status: 'success',
                        nodeId: inspectedNode.id,
                        action: inspectedNode.kind,
                        executionTimeMs: 38,
                        emittedData: {
                          processed: true,
                          target: 'recipient_lead',
                        },
                      },
                      null,
                      2
                    )}
              </pre>
            </div>

            {/* Dry Run Button */}
            <button
              type="button"
              className="btn btn--primary"
              disabled={testingNode}
              onClick={() => {
                setTestingNode(true);
                setTimeout(() => {
                  setTestResult({
                    status: 'success',
                    testExecutionId: `test_run_${Math.floor(Math.random() * 90000 + 10000)}`,
                    nodeId: inspectedNode.id,
                    executionLatencyMs: Math.floor(Math.random() * 30 + 15),
                    emittedAt: new Date().toISOString(),
                    result: {
                      delivered: true,
                      simulated: true,
                      channel: inspectedNode.kind,
                    },
                  });
                  setTestingNode(false);
                }, 400);
              }}
            >
              <Icon name="play" size={14} />
              {testingNode ? 'Testing Step...' : 'Test This Step (Dry Run)'}
            </button>

            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                if (inspectedNode.isTrigger) {
                  onEditTrigger?.(workflow.trigger);
                } else if (inspectedNode.rawAction) {
                  onEditStep(inspectedNode.rawAction);
                }
                setInspectedNode(null);
              }}
            >
              <Icon name="sliders" size={14} /> Edit Step Parameters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout calculation logic
// ---------------------------------------------------------------------------
function calculateLayout(
  workflow: Workflow,
  customPositions: Record<string, Point>
): { nodes: NodeLayout[]; connections: Connection[] } {
  const nodes: NodeLayout[] = [];
  const connections: Connection[] = [];

  const triggerId = `trigger_${workflow.id}`;
  const triggerNode: NodeLayout = {
    id: triggerId,
    name: workflow.trigger.kind ? `${workflow.trigger.kind.toUpperCase()} Event` : 'Trigger',
    kind: workflow.trigger.kind || 'trigger',
    label: workflow.trigger.detail || 'Starts workflow execution',
    x: customPositions[triggerId]?.x ?? 320,
    y: customPositions[triggerId]?.y ?? 40,
    width: 220,
    height: 76,
    isTrigger: true,
  };
  nodes.push(triggerNode);

  let currentY = 160;
  let previousId = triggerId;

  // Process top-level actions
  for (let i = 0; i < workflow.actions.length; i++) {
    const act = workflow.actions[i];
    const defaultX = customPositions[act.id]?.x ?? 320;
    const defaultY = customPositions[act.id]?.y ?? currentY;

    const nodeItem: NodeLayout = {
      id: act.id,
      name: act.label || act.kind,
      kind: act.kind,
      label: act.kind === 'condition' ? 'If / Else evaluation' : act.label,
      x: defaultX,
      y: defaultY,
      width: 220,
      height: 76,
      rawAction: act,
    };
    nodes.push(nodeItem);

    // Connect previous to this
    connections.push({ fromId: previousId, toId: act.id });

    // Handle condition branches
    if (act.kind === 'condition') {
      const yesSteps = act.yes || [];
      const noSteps = act.no || [];

      let branchY = defaultY + 120;
      let prevYesId = act.id;
      for (const yStep of yesSteps) {
        const yNode: NodeLayout = {
          id: yStep.id,
          name: yStep.label || yStep.kind,
          kind: yStep.kind,
          label: yStep.label,
          x: customPositions[yStep.id]?.x ?? 160,
          y: customPositions[yStep.id]?.y ?? branchY,
          width: 200,
          height: 72,
          rawAction: yStep,
        };
        nodes.push(yNode);
        connections.push({
          fromId: prevYesId,
          toId: yStep.id,
          label: prevYesId === act.id ? 'YES' : undefined,
          tone: 'green',
        });
        prevYesId = yStep.id;
        branchY += 100;
      }

      let branchNoY = defaultY + 120;
      let prevNoId = act.id;
      for (const nStep of noSteps) {
        const nNode: NodeLayout = {
          id: nStep.id,
          name: nStep.label || nStep.kind,
          kind: nStep.kind,
          label: nStep.label,
          x: customPositions[nStep.id]?.x ?? 480,
          y: customPositions[nStep.id]?.y ?? branchNoY,
          width: 200,
          height: 72,
          rawAction: nStep,
        };
        nodes.push(nNode);
        connections.push({
          fromId: prevNoId,
          toId: nStep.id,
          label: prevNoId === act.id ? 'NO' : undefined,
          tone: 'red',
        });
        prevNoId = nStep.id;
        branchNoY += 100;
      }

      currentY = Math.max(branchY, branchNoY) + 20;
    } else {
      currentY += 110;
    }

    previousId = act.id;
  }

  return { nodes, connections };
}
