/**
 * ============================================================================
 * Operza Visual Workflow Canvas (n8n-Inspired 2D Nodal Graph Engine)
 * ============================================================================
 * 
 * High-performance, interactive 2D canvas engineered with n8n's visual elegance,
 * featuring smooth pan/zoom, bezier curves, real-time node execution pulsing,
 * full Node Details View (NDV), in-app workflow templates, and mini-map navigation.
 */

import { useState, useRef, useMemo, type MouseEvent } from 'react';
import { Icon } from './Icon';
import type { Workflow, WorkflowAction, WorkflowTrigger } from '../lib/types';
import { WORKFLOW_TEMPLATES, WORKFLOW_CATEGORIES, type WorkflowTemplateItem } from '../lib/workflowTemplates';

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
  status?: 'idle' | 'running' | 'success' | 'error';
  latencyMs?: number;
  itemCount?: number;
}

interface Connection {
  fromId: string;
  toId: string;
  label?: string;
  tone?: 'default' | 'green' | 'red' | 'indigo' | 'cyan';
  active?: boolean;
}

const ACTION_ICONS: Record<string, string> = {
  trigger: 'zap',
  webhook: 'webhook',
  schedule: 'clock',
  form: 'clipboard',
  email: 'mail',
  sms: 'message',
  wait: 'clock',
  tag: 'tag',
  task: 'clipboard',
  condition: 'sliders',
  http_request: 'globe',
  split_test: 'share',
  loop: 'repeat',
  math: 'calculator',
  filter: 'filter',
  ai_agent: 'sparkles',
  code: 'code',
  switch: 'sliders',
  merge: 'share',
};

const ACTION_COLORS: Record<string, { bg: string; border: string; glow: string }> = {
  trigger: { bg: '#ff6d5a', border: '#ff8575', glow: 'rgba(255, 109, 90, 0.4)' },
  webhook: { bg: '#06b6d4', border: '#22d3ee', glow: 'rgba(6, 182, 212, 0.35)' },
  schedule: { bg: '#f59e0b', border: '#fbbf24', glow: 'rgba(245, 158, 11, 0.35)' },
  form: { bg: '#3b82f6', border: '#60a5fa', glow: 'rgba(59, 130, 246, 0.35)' },
  email: { bg: '#3b82f6', border: '#60a5fa', glow: 'rgba(59, 130, 246, 0.35)' },
  sms: { bg: '#10b981', border: '#34d399', glow: 'rgba(16, 185, 129, 0.35)' },
  wait: { bg: '#f59e0b', border: '#fbbf24', glow: 'rgba(245, 158, 11, 0.35)' },
  tag: { bg: '#8b5cf6', border: '#a78bfa', glow: 'rgba(139, 92, 246, 0.35)' },
  task: { bg: '#0284c7', border: '#38bdf8', glow: 'rgba(2, 132, 199, 0.35)' },
  condition: { bg: '#f97316', border: '#fb923c', glow: 'rgba(249, 115, 22, 0.35)' },
  ai_agent: { bg: '#8b5cf6', border: '#c084fc', glow: 'rgba(139, 92, 246, 0.45)' },
  code: { bg: '#ea580c', border: '#f97316', glow: 'rgba(234, 88, 12, 0.4)' },
  switch: { bg: '#7c3aed', border: '#a78bfa', glow: 'rgba(124, 58, 237, 0.35)' },
  merge: { bg: '#0ea5e9', border: '#38bdf8', glow: 'rgba(14, 165, 233, 0.35)' },
};

export function WorkflowCanvas({
  workflow,
  onEditStep,
  onAddStep,
  onEditTrigger,
  onImportTemplate,
  activeRun: _activeRun,
}: {
  workflow: Workflow;
  onEditStep: (step: WorkflowAction, parentId?: string, branch?: 'yes' | 'no') => void;
  onAddStep: (parentId?: string, branch?: 'yes' | 'no') => void;
  onEditTrigger?: (trigger: WorkflowTrigger) => void;
  onImportTemplate?: (template: WorkflowTemplateItem) => void;
  activeRun?: any;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 60, y: 30 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  // Node Dragging State
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [customPositions, setCustomPositions] = useState<Record<string, Point>>({});

  // Active / Selected Node
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Full Node Details View (NDV) Modal
  const [ndvNode, setNdvNode] = useState<NodeLayout | null>(null);
  const [ndvTab, setNdvTab] = useState<'params' | 'input' | 'output'>('params');
  const [testingStep, setTestingStep] = useState(false);
  const [ndvOutput, setNdvOutput] = useState<any>(null);

  // Templates Gallery Modal
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateCategory, setTemplateCategory] = useState<string>('all');

  // Simulation Runner State (Visual Pulse Animation)
  const [isExecutingWorkflow, setIsExecutingWorkflow] = useState(false);
  const [nodeExecutionStates, setNodeExecutionStates] = useState<Record<string, 'idle' | 'running' | 'success' | 'error'>>({});
  const [nodeLatencies, setNodeLatencies] = useState<Record<string, number>>({});

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Auto-calculate graph node layout and bezier connections
  const { nodes, connections } = useMemo(() => {
    return calculateLayout(workflow, customPositions, nodeExecutionStates, nodeLatencies);
  }, [workflow, customPositions, nodeExecutionStates, nodeLatencies]);

  // Mini-map bounding coordinates
  const bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, maxX: 800, minY: 0, maxY: 600 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.width);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + n.height);
    });
    return {
      minX: minX - 100,
      maxX: maxX + 100,
      minY: minY - 100,
      maxY: maxY + 100,
    };
  }, [nodes]);

  const handleMouseDownCanvas = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.canvas-node') || (e.target as HTMLElement).closest('.n8n-dock')) return;
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
    setSelectedNodeId(nodeId);
    setDraggingNodeId(nodeId);
    const containerRect = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
    setDragOffset({
      x: (e.clientX - containerRect.left - pan.x) / zoom - currentX,
      y: (e.clientY - containerRect.top - pan.y) / zoom - currentY,
    });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 60, y: 30 });
  };

  const cleanLayout = () => {
    setCustomPositions({});
    setZoom(1);
    setPan({ x: 60, y: 30 });
  };

  // Full Workflow Execution Simulation (Sequential Node Pulse)
  const handleExecuteWorkflow = async () => {
    if (isExecutingWorkflow || nodes.length === 0) return;
    setIsExecutingWorkflow(true);
    setNodeExecutionStates({});
    setNodeLatencies({});

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      setNodeExecutionStates(prev => ({ ...prev, [node.id]: 'running' }));
      const delay = Math.floor(Math.random() * 200 + 150);
      await new Promise(r => setTimeout(r, delay));
      setNodeExecutionStates(prev => ({ ...prev, [node.id]: 'success' }));
      setNodeLatencies(prev => ({ ...prev, [node.id]: Math.floor(Math.random() * 35 + 12) }));
    }

    setIsExecutingWorkflow(false);
  };

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return WORKFLOW_TEMPLATES.filter(tpl => {
      const matchesCat = templateCategory === 'all' || String(tpl.categoryId) === templateCategory || tpl.category.toLowerCase().includes(templateCategory.toLowerCase());
      const matchesQuery = !templateSearch || tpl.name.toLowerCase().includes(templateSearch.toLowerCase()) || tpl.description.toLowerCase().includes(templateSearch.toLowerCase());
      return matchesCat && matchesQuery;
    });
  }, [templateCategory, templateSearch]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '660px',
        backgroundColor: '#0d1117',
        backgroundImage: 'radial-gradient(circle, #21262d 1.2px, transparent 1.2px)',
        backgroundSize: '20px 20px',
        overflow: 'hidden',
        userSelect: 'none',
        borderRadius: 14,
        border: '1px solid #30363d',
        cursor: isPanning ? 'grabbing' : 'grab',
        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.4)',
      }}
      onMouseDown={handleMouseDownCanvas}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* ============================================================== */}
      {/* 1. TOP FLOATING DOCK (n8n Studio Glassmorphism Style)           */}
      {/* ============================================================== */}
      <div
        className="n8n-dock"
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          zIndex: 30,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        {/* Left: Workflow Status & Play Button */}
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(22, 27, 34, 0.88)',
            backdropFilter: 'blur(10px)',
            padding: '6px 12px',
            borderRadius: 10,
            border: '1px solid #30363d',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: workflow.status === 'published' ? '#22c55e' : '#f59e0b',
                boxShadow: workflow.status === 'published' ? '0 0 8px #22c55e' : '0 0 8px #f59e0b',
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc' }}>
              {workflow.name}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                padding: '2px 6px',
                borderRadius: 4,
                background: workflow.status === 'published' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                color: workflow.status === 'published' ? '#4ade80' : '#fcd34d',
                letterSpacing: '0.04em',
              }}
            >
              {workflow.status}
            </span>
          </div>

          <div style={{ width: 1, height: 18, background: '#30363d', margin: '0 4px' }} />

          {/* Test Workflow (n8n signature CTA) */}
          <button
            type="button"
            onClick={handleExecuteWorkflow}
            disabled={isExecutingWorkflow}
            style={{
              background: isExecutingWorkflow
                ? '#1f6feb'
                : 'linear-gradient(135deg, #ff6d5a 0%, #ea580c 100%)',
              border: 'none',
              borderRadius: 6,
              color: '#ffffff',
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 700,
              cursor: isExecutingWorkflow ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: '0 2px 10px rgba(255, 109, 90, 0.35)',
              transition: 'transform 0.15s ease',
            }}
          >
            <Icon name={isExecutingWorkflow ? 'clock' : 'play'} size={13} />
            {isExecutingWorkflow ? 'Executing...' : 'Test Workflow'}
          </button>
        </div>

        {/* Right: Actions, Templates, Zoom & Mini-map */}
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'rgba(22, 27, 34, 0.88)',
            backdropFilter: 'blur(10px)',
            padding: '6px 10px',
            borderRadius: 10,
            border: '1px solid #30363d',
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          }}
        >
          {/* Templates Library */}
          <button
            type="button"
            onClick={() => setShowTemplatesModal(true)}
            style={{
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Icon name="package" size={13} />
            <span>Templates</span>
            <span
              style={{
                fontSize: 10,
                background: '#0284c7',
                color: '#fff',
                padding: '1px 5px',
                borderRadius: 10,
                fontWeight: 700,
              }}
            >
              6
            </span>
          </button>

          {/* Add Node Button */}
          <button
            type="button"
            onClick={() => onAddStep()}
            style={{
              background: '#238636',
              border: '1px solid #2ea043',
              color: '#ffffff',
              borderRadius: 6,
              padding: '5px 11px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <Icon name="plus" size={13} /> Add Node
          </button>

          <div style={{ width: 1, height: 18, background: '#30363d', margin: '0 2px' }} />

          {/* Layout Cleaner */}
          <button
            type="button"
            onClick={cleanLayout}
            title="Clean Up Canvas Layout"
            style={{
              background: '#21262d',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <Icon name="sliders" size={13} />
          </button>

          {/* Zoom In / Out */}
          <button
            type="button"
            onClick={() => setZoom(z => Math.min(2, z + 0.15))}
            title="Zoom In"
            style={{
              background: '#21262d',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
            }}
          >
            <Icon name="plus" size={12} />
          </button>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', minWidth: 36, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(z => Math.max(0.4, z - 0.15))}
            title="Zoom Out"
            style={{
              background: '#21262d',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
            }}
          >
            <Icon name="x" size={12} />
          </button>
          <button
            type="button"
            onClick={resetView}
            title="Reset Zoom & Pan"
            style={{
              background: '#21262d',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Fit
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. SVG LAYER: n8n Curved Bezier Connectors                     */}
      {/* ============================================================== */}
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
            <marker
              id="n8n-arrowhead"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon points="0 1, 8 4, 0 7" fill="#8b949e" />
            </marker>
            <marker
              id="n8n-arrowhead-green"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon points="0 1, 8 4, 0 7" fill="#22c55e" />
            </marker>
            <marker
              id="n8n-arrowhead-red"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon points="0 1, 8 4, 0 7" fill="#ef4444" />
            </marker>
          </defs>

          {connections.map((conn, idx) => {
            const fromNode = nodes.find(n => n.id === conn.fromId);
            const toNode = nodes.find(n => n.id === conn.toId);
            if (!fromNode || !toNode) return null;

            let startX = fromNode.x + fromNode.width / 2;
            let startY = fromNode.y + fromNode.height;

            if (conn.tone === 'green') {
              startX = fromNode.x + fromNode.width * 0.25;
            } else if (conn.tone === 'red') {
              startX = fromNode.x + fromNode.width * 0.75;
            }

            const endX = toNode.x + toNode.width / 2;
            const endY = toNode.y;

            const deltaY = Math.max(45, (endY - startY) * 0.5);
            const pathD = `M ${startX} ${startY} C ${startX} ${startY + deltaY}, ${endX} ${endY - deltaY}, ${endX} ${endY}`;

            let strokeColor = '#8b949e';
            let markerId = 'url(#n8n-arrowhead)';
            if (conn.tone === 'green') {
              strokeColor = '#22c55e';
              markerId = 'url(#n8n-arrowhead-green)';
            } else if (conn.tone === 'red') {
              strokeColor = '#ef4444';
              markerId = 'url(#n8n-arrowhead-red)';
            }

            return (
              <g key={`${conn.fromId}-${conn.toId}-${idx}`}>
                {/* Glow underlay */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="5"
                  strokeOpacity="0.12"
                />
                {/* Active animated stroke */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                  markerEnd={markerId}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="20;0"
                    dur="1.4s"
                    repeatCount="indefinite"
                  />
                </path>

                {/* Port label badge */}
                {conn.label && (
                  <g transform={`translate(${(startX + endX) / 2 - 18}, ${(startY + endY) / 2 - 10})`}>
                    <rect
                      width="36"
                      height="20"
                      rx="10"
                      fill={conn.tone === 'green' ? '#14532d' : conn.tone === 'red' ? '#7f1d1d' : '#161b22'}
                      stroke={strokeColor}
                      strokeWidth="1.2"
                    />
                    <text
                      x="18"
                      y="14"
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="bold"
                      fill="#ffffff"
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

      {/* ============================================================== */}
      {/* 3. NODES DOM LAYER: Signature n8n Cards                        */}
      {/* ============================================================== */}
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
          const styling = ACTION_COLORS[node.kind] || ACTION_COLORS.trigger;
          const icon = ACTION_ICONS[node.kind] || 'zap';
          const isSelected = selectedNodeId === node.id;
          const status = node.status || 'idle';

          return (
            <div
              key={node.id}
              className="canvas-node"
              style={{
                position: 'absolute',
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: `${node.width}px`,
                background: '#161b22',
                borderRadius: 12,
                border: isSelected
                  ? `2px solid ${styling.border}`
                  : node.isTrigger
                  ? '2px solid #ff6d5a'
                  : '1px solid #30363d',
                boxShadow: isSelected
                  ? `0 0 0 3px ${styling.glow}, 0 10px 25px rgba(0,0,0,0.5)`
                  : status === 'running'
                  ? '0 0 15px rgba(56, 189, 248, 0.5)'
                  : '0 6px 16px rgba(0,0,0,0.3)',
                cursor: 'pointer',
                transition: draggingNodeId === node.id ? 'none' : 'box-shadow 0.2s, border 0.2s',
              }}
              onMouseDown={(e) => handleNodeDragStart(e, node.id, node.x, node.y)}
              onClick={() => {
                setSelectedNodeId(node.id);
                setNdvNode(node);
                setNdvTab('params');
              }}
            >
              {/* Top Input Handle */}
              {!node.isTrigger && (
                <div
                  style={{
                    position: 'absolute',
                    top: -7,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#0d1117',
                    border: '3px solid #ff6d5a',
                    zIndex: 4,
                  }}
                  title="Input Port"
                />
              )}

              {/* Node Card Header */}
              <div
                style={{
                  padding: '9px 12px',
                  borderBottom: '1px solid #21262d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: node.isTrigger
                    ? 'rgba(255, 109, 90, 0.12)'
                    : 'rgba(255, 255, 255, 0.02)',
                  borderTopLeftRadius: 10,
                  borderTopRightRadius: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 6,
                      background: styling.bg,
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: `0 2px 6px ${styling.glow}`,
                    }}
                  >
                    <Icon name={icon} size={14} />
                  </div>
                  <div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: styling.border,
                        display: 'block',
                      }}
                    >
                      {node.isTrigger ? 'Trigger' : node.kind}
                    </span>
                  </div>
                </div>

                {/* Status Indicator / Latency pill */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {status === 'running' && (
                    <span
                      style={{
                        fontSize: 10,
                        color: '#38bdf8',
                        fontWeight: 600,
                        animation: 'pulse 1s infinite',
                      }}
                    >
                      ⏳
                    </span>
                  )}
                  {status === 'success' && (
                    <span
                      style={{
                        fontSize: 10,
                        background: 'rgba(34, 197, 94, 0.2)',
                        color: '#4ade80',
                        padding: '1px 6px',
                        borderRadius: 10,
                        fontWeight: 700,
                      }}
                    >
                      ✔ {node.latencyMs ? `${node.latencyMs}ms` : 'OK'}
                    </span>
                  )}
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#8b949e',
                      padding: 2,
                      cursor: 'pointer',
                    }}
                    title="Open Node Details View (NDV)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNdvNode(node);
                      setNdvTab('params');
                    }}
                  >
                    <Icon name="sliders" size={12} />
                  </button>
                </div>
              </div>

              {/* Node Card Body */}
              <div style={{ padding: '10px 12px' }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 13,
                    color: '#f0f6fc',
                    marginBottom: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#8b949e',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.label || 'Configured Node Step'}
                </div>
              </div>

              {/* Output Handle & Item Count Chip */}
              {node.kind === 'condition' ? (
                <div style={{ position: 'relative', height: 8 }}>
                  {/* True Port */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -7,
                      left: '25%',
                      transform: 'translateX(-50%)',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#10b981',
                      border: '3px solid #0d1117',
                      zIndex: 4,
                    }}
                    title="TRUE Branch Port"
                  />
                  {/* False Port */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -7,
                      left: '75%',
                      transform: 'translateX(-50%)',
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#ef4444',
                      border: '3px solid #0d1117',
                      zIndex: 4,
                    }}
                    title="FALSE Branch Port"
                  />
                </div>
              ) : (
                <div
                  style={{
                    position: 'absolute',
                    bottom: -7,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#ff6d5a',
                    border: '3px solid #0d1117',
                    zIndex: 4,
                  }}
                  title="Output Port (1 item)"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ============================================================== */}
      {/* 4. BOTTOM-RIGHT MINIMAP OVERLAY                                */}
      {/* ============================================================== */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          width: 160,
          height: 105,
          background: 'rgba(22, 27, 34, 0.92)',
          border: '1px solid #30363d',
          borderRadius: 8,
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
          zIndex: 30,
          padding: 6,
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', marginBottom: 4 }}>
          CANVAS MAP
        </div>
        <div style={{ position: 'relative', width: '100%', height: 'calc(100% - 16px)' }}>
          {nodes.map(n => {
            const normalizedX = ((n.x - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * 140;
            const normalizedY = ((n.y - bounds.minY) / (bounds.maxY - bounds.minY || 1)) * 75;
            return (
              <div
                key={`map_${n.id}`}
                style={{
                  position: 'absolute',
                  left: `${normalizedX}px`,
                  top: `${normalizedY}px`,
                  width: 24,
                  height: 10,
                  borderRadius: 2,
                  background: n.isTrigger ? '#ff6d5a' : '#58a6ff',
                  opacity: 0.85,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 5. FULL NODE DETAILS VIEW (NDV) MODAL                          */}
      {/* ============================================================== */}
      {ndvNode && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setNdvNode(null)}
        >
          <div
            style={{
              width: '920px',
              maxWidth: '95vw',
              height: '580px',
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 14,
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* NDV Header Bar */}
            <div
              style={{
                height: 56,
                padding: '0 20px',
                borderBottom: '1px solid #30363d',
                background: '#0d1117',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: ACTION_COLORS[ndvNode.kind]?.bg || '#ff6d5a',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name={ACTION_ICONS[ndvNode.kind] || 'zap'} size={17} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#f0f6fc' }}>
                    {ndvNode.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase' }}>
                    {ndvNode.kind} Node · n8n Compatible
                  </div>
                </div>
              </div>

              {/* Tabs Switcher: Parameters / Input / Output */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  background: '#161b22',
                  padding: 3,
                  borderRadius: 8,
                  border: '1px solid #30363d',
                }}
              >
                <button
                  type="button"
                  onClick={() => setNdvTab('params')}
                  style={{
                    background: ndvTab === 'params' ? '#21262d' : 'transparent',
                    color: ndvTab === 'params' ? '#ffffff' : '#8b949e',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Parameters
                </button>
                <button
                  type="button"
                  onClick={() => setNdvTab('input')}
                  style={{
                    background: ndvTab === 'input' ? '#21262d' : 'transparent',
                    color: ndvTab === 'input' ? '#ffffff' : '#8b949e',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Input Data
                </button>
                <button
                  type="button"
                  onClick={() => setNdvTab('output')}
                  style={{
                    background: ndvTab === 'output' ? '#21262d' : 'transparent',
                    color: ndvTab === 'output' ? '#ffffff' : '#8b949e',
                    border: 'none',
                    borderRadius: 6,
                    padding: '6px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Output Preview
                </button>
              </div>

              {/* Test Step & Close */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  disabled={testingStep}
                  onClick={() => {
                    setTestingStep(true);
                    setTimeout(() => {
                      setNdvOutput({
                        status: 'success',
                        nodeId: ndvNode.id,
                        executionLatencyMs: Math.floor(Math.random() * 25 + 10),
                        timestamp: new Date().toISOString(),
                        items: [
                          {
                            json: {
                              id: 'rec_9148',
                              email: 'lead@operza-growth.test',
                              status: 'processed',
                              qualified: true,
                              score: 92,
                              nodeType: ndvNode.kind,
                              emittedAt: new Date().toISOString(),
                            },
                          },
                        ],
                      });
                      setTestingStep(false);
                      setNdvTab('output');
                    }, 350);
                  }}
                  style={{
                    background: '#238636',
                    border: '1px solid #2ea043',
                    color: '#ffffff',
                    borderRadius: 6,
                    padding: '6px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Icon name="play" size={13} />
                  {testingStep ? 'Testing...' : 'Execute Step'}
                </button>

                <button
                  type="button"
                  onClick={() => setNdvNode(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#8b949e',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <Icon name="x" size={18} />
                </button>
              </div>
            </div>

            {/* NDV Content Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#0d1117' }}>
              {ndvTab === 'params' && (
                <div style={{ maxWidth: 650, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ background: '#161b22', padding: 16, borderRadius: 10, border: '1px solid #30363d' }}>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#f0f6fc', marginBottom: 6 }}>
                      Node Step Label
                    </label>
                    <input
                      className="input"
                      style={{ background: '#0d1117', border: '1px solid #30363d', color: '#f0f6fc' }}
                      defaultValue={ndvNode.name}
                      readOnly
                    />
                    <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
                      Unique node descriptor within the automation graph.
                    </div>
                  </div>

                  {/* Code Editor Preview if kind === 'code' */}
                  {ndvNode.kind === 'code' ? (
                    <div style={{ background: '#161b22', padding: 16, borderRadius: 10, border: '1px solid #30363d' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: '#f0f6fc' }}>
                          JavaScript Code ($json Context)
                        </label>
                        <span style={{ fontSize: 11, color: '#ff6d5a', fontFamily: 'monospace' }}>
                          n8n-style return items
                        </span>
                      </div>
                      <textarea
                        rows={8}
                        style={{
                          width: '100%',
                          background: '#04070c',
                          border: '1px solid #30363d',
                          borderRadius: 8,
                          padding: 12,
                          color: '#38bdf8',
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          fontSize: 12.5,
                          lineHeight: 1.5,
                        }}
                        defaultValue={
                          ndvNode.rawAction?.config?.code ||
                          `// Access input item attributes via $json or items array\nreturn items.map(item => ({\n  json: {\n    ...item.json,\n    transformed: true,\n    processedAt: new Date().toISOString()\n  }\n}));`
                        }
                      />
                    </div>
                  ) : (
                    <div style={{ background: '#161b22', padding: 16, borderRadius: 10, border: '1px solid #30363d' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#f0f6fc', marginBottom: 8 }}>
                        Configuration Parameters
                      </div>
                      <pre
                        style={{
                          background: '#04070c',
                          padding: 12,
                          borderRadius: 6,
                          color: '#e6edf3',
                          fontSize: 12,
                          fontFamily: 'monospace',
                          margin: 0,
                        }}
                      >
                        {JSON.stringify(ndvNode.rawAction?.config || { mode: 'standard', retryOnError: true }, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn--subtle"
                      onClick={() => {
                        if (ndvNode.isTrigger) {
                          onEditTrigger?.(workflow.trigger);
                        } else if (ndvNode.rawAction) {
                          onEditStep(ndvNode.rawAction);
                        }
                        setNdvNode(null);
                      }}
                    >
                      Open Full Step Editor
                    </button>
                  </div>
                </div>
              )}

              {ndvTab === 'input' && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, textTransform: 'uppercase' }}>
                    INBOUND JSON RECORDS (1 ITEM)
                  </div>
                  <pre
                    style={{
                      background: '#04070c',
                      padding: 16,
                      borderRadius: 8,
                      border: '1px solid #30363d',
                      color: '#a5d6ff',
                      fontSize: 12.5,
                      fontFamily: 'monospace',
                    }}
                  >
                    {JSON.stringify(
                      [
                        {
                          json: {
                            id: 'lead_081',
                            name: 'Vance Sterling',
                            email: 'vance@enterprise-corp.test',
                            phone: '+1 555-0199',
                            status: 'lead',
                            score: 88,
                            triggerType: workflow.trigger?.kind || 'webhook',
                            receivedAt: new Date().toISOString(),
                          },
                        },
                      ],
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}

              {ndvTab === 'output' && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', marginBottom: 8, textTransform: 'uppercase' }}>
                    OUTPUT DATA (STEP EXECUTION RESULTS)
                  </div>
                  <pre
                    style={{
                      background: '#04070c',
                      padding: 16,
                      borderRadius: 8,
                      border: '1px solid #30363d',
                      color: '#7ee787',
                      fontSize: 12.5,
                      fontFamily: 'monospace',
                    }}
                  >
                    {JSON.stringify(
                      ndvOutput || {
                        status: 'success',
                        nodeId: ndvNode.id,
                        executionLatencyMs: 16,
                        items: [
                          {
                            json: {
                              processed: true,
                              nodeType: ndvNode.kind,
                              outputTimestamp: new Date().toISOString(),
                            },
                          },
                        ],
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 6. WORKFLOW TEMPLATES GALLERY MODAL (n8n Blueprints)           */}
      {/* ============================================================== */}
      {showTemplatesModal && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setShowTemplatesModal(false)}
        >
          <div
            style={{
              width: '880px',
              maxWidth: '95vw',
              height: '590px',
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 14,
              boxShadow: '0 25px 60px rgba(0,0,0,0.6)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #30363d',
                background: '#0d1117',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>📦</span>
                  <span>Workflow Templates & Blueprints (n8n-Inspired)</span>
                </div>
                <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>
                  Production-grade automation graphs ready to import directly into your workspace.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplatesModal(false)}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                <Icon name="x" size={18} />
              </button>
            </div>

            {/* Filter Bar */}
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid #21262d',
                background: '#161b22',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <input
                className="input"
                placeholder="Search blueprints by keyword..."
                value={templateSearch}
                onChange={(e) => setTemplateSearch(e.target.value)}
                style={{
                  maxWidth: 300,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  color: '#f0f6fc',
                  fontSize: 12.5,
                }}
              />
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                <button
                  type="button"
                  onClick={() => setTemplateCategory('all')}
                  style={{
                    background: templateCategory === 'all' ? '#ff6d5a' : '#21262d',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 20,
                    padding: '4px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  All
                </button>
                {WORKFLOW_CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setTemplateCategory(String(c.id))}
                    style={{
                      background: templateCategory === String(c.id) ? '#ff6d5a' : '#21262d',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 20,
                      padding: '4px 12px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Template Cards Grid */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 20,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                gap: 16,
                background: '#0d1117',
              }}
            >
              {filteredTemplates.map(tpl => (
                <div
                  key={tpl.id}
                  style={{
                    background: '#161b22',
                    border: '1px solid #30363d',
                    borderRadius: 10,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transition: 'border 0.2s',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: '#ff8575',
                          background: 'rgba(255, 109, 90, 0.12)',
                          padding: '2px 8px',
                          borderRadius: 4,
                        }}
                      >
                        {tpl.category}
                      </span>
                      <span style={{ fontSize: 11, color: '#8b949e' }}>
                        👁 {tpl.totalViews} views
                      </span>
                    </div>

                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f6fc', marginBottom: 6 }}>
                      {tpl.name}
                    </div>

                    <p style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.4, margin: '0 0 12px' }}>
                      {tpl.description}
                    </p>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                      {tpl.nodes.map(n => (
                        <span
                          key={n.id}
                          style={{
                            fontSize: 10.5,
                            background: '#21262d',
                            color: '#c9d1d9',
                            padding: '2px 6px',
                            borderRadius: 4,
                            border: '1px solid #30363d',
                          }}
                        >
                          {n.name}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onImportTemplate?.(tpl);
                      setShowTemplatesModal(false);
                    }}
                    style={{
                      width: '100%',
                      background: 'linear-gradient(135deg, #ff6d5a 0%, #ea580c 100%)',
                      border: 'none',
                      borderRadius: 6,
                      color: '#ffffff',
                      padding: '8px 14px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                    }}
                  >
                    <Icon name="plus" size={13} /> Import Blueprint into Canvas
                  </button>
                </div>
              ))}
            </div>
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
  customPositions: Record<string, Point>,
  executionStates: Record<string, 'idle' | 'running' | 'success' | 'error'> = {},
  latencies: Record<string, number> = {}
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
    status: executionStates[triggerId] || 'idle',
    latencyMs: latencies[triggerId],
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
      status: executionStates[act.id] || 'idle',
      latencyMs: latencies[act.id],
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
          status: executionStates[yStep.id] || 'idle',
          latencyMs: latencies[yStep.id],
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
          status: executionStates[nStep.id] || 'idle',
          latencyMs: latencies[nStep.id],
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
