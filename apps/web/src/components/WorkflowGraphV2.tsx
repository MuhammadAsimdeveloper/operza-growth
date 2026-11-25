import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Workflow } from '../lib/types';

export function WorkflowGraphV2({
  workflow,
  onSelectActionId,
}: {
  workflow: Workflow;
  onSelectActionId?: (actionId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const flowNodes: Node[] = [
      {
        id: 'trigger',
        position: { x: 220, y: 20 },
        data: { label: `Trigger: ${workflow.trigger.kind.replace(/_/g, ' ')}` },
        style: {
          background: '#eef2ff',
          border: '1px solid #6366f1',
          borderRadius: 10,
          padding: '8px 14px',
          fontWeight: 600,
          fontSize: 12,
        },
      },
    ];
    const flowEdges: Edge[] = [];
    let prevId = 'trigger';

    (workflow.actions || []).forEach((action, index) => {
      const nodeId = action.id || `node_${index}`;
      flowNodes.push({
        id: nodeId,
        position: { x: 220, y: 120 + index * 100 },
        data: { label: `${action.kind.toUpperCase()}: ${action.label}` },
        style: {
          background: '#ffffff',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          padding: '8px 14px',
          fontSize: 12,
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
  }, [workflow]);

  return (
    <div style={{ width: '100%', height: 420, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_evt, node) => {
          if (node.id !== 'trigger' && onSelectActionId) {
            onSelectActionId(node.id);
          }
        }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
