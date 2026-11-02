import type { Edge, Node } from 'reactflow';
import { defaultVariableValues, type Blocks, type Hooks } from '../core/blocks';
import { kindOf, normalizeBranch } from '../core/graph';
import type { WorkflowEdge, WorkflowHook, WorkflowInput, WorkflowNode } from '../core/types';

export interface BlockNodeData {
  type: string;
  label?: string;
  variables: Record<string, unknown>;
}

export type FlowNode = Node<BlockNodeData>;

export function newId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

/**
 * Stored workflow → editor state (ReactFlow nodes/edges + hooks). Also upgrades
 * 1.x data: drops classNames and icon-prefixed labels, maps true/false handles to yes/no.
 */
export function toFlow(wf: Pick<WorkflowInput, 'nodes' | 'edges' | 'hooks'>, blocks: Blocks): { nodes: FlowNode[]; edges: Edge[]; hooks: WorkflowHook[] } {
  const decisionIds = new Set(wf.nodes.filter((n) => kindOf(n, blocks) === 'decision').map((n) => n.id));

  const nodes: FlowNode[] = wf.nodes.map((n) => {
    const def = blocks[n.data?.type];
    let label = typeof n.data?.label === 'string' ? n.data.label : undefined;
    if (label && def && (label === def.label || label === `${def.icon} ${def.label}`)) label = undefined;
    return {
      id: n.id,
      type: 'block',
      position: n.position ?? { x: 0, y: 0 },
      data: { type: n.data?.type, label, variables: { ...(n.data?.variables ?? {}) } },
    };
  });

  const edges: Edge[] = wf.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: decisionIds.has(e.source) ? normalizeBranch(e.sourceHandle ?? null) : null,
    targetHandle: null,
  }));

  const hooks = (wf.hooks ?? []).map((h) => ({ ...h, scope: h.scope ?? 'all', config: { ...(h.config ?? {}) } }));
  return { nodes, edges, hooks };
}

/** Editor state → stored workflow parts. Keeps only data; presentation comes from block definitions. */
export function fromFlow(nodes: FlowNode[], edges: Edge[], hooks: WorkflowHook[] = []): Pick<WorkflowInput, 'nodes' | 'edges' | 'hooks'> {
  const outNodes: WorkflowNode[] = nodes.map((n) => ({
    id: n.id,
    type: 'block',
    position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    data: { type: n.data.type, ...(n.data.label ? { label: n.data.label } : {}), variables: n.data.variables ?? {} },
  }));
  const outEdges: WorkflowEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
  }));
  return { nodes: outNodes, edges: outEdges, hooks };
}

export function createBlockNode(type: string, blocks: Blocks, position: { x: number; y: number }): FlowNode {
  return { id: newId('n'), type: 'block', position, data: { type, variables: defaultVariableValues(blocks[type]?.variables) } };
}

export function createHook(type: string, hooks: Hooks): WorkflowHook {
  const def = hooks[type];
  return { id: newId('h'), type, trigger: def?.trigger ?? 'on_message', scope: 'all', enabled: true, config: defaultVariableValues(def?.config) };
}
