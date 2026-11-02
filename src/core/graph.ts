/**
 * Pure graph functions: no I/O, no side effects. Shared by the engine (server),
 * the editor (live validation) and any in-browser simulation.
 */
import { getBranches, type BlockDef, type BlockKind, type Blocks } from './blocks';
import { WorkflowError } from './errors';
import type { Workflow, WorkflowEdge, WorkflowNode } from './types';

/** What callers pass to engine.move() — and what actions return to continue. */
export type Move =
  | { to: string; force?: boolean }
  | { branch: string | boolean }
  | { next: true };

export interface Step {
  node: WorkflowNode;
  edge: WorkflowEdge | null;
  branch: string | null;
}

export function blockOf(node: WorkflowNode, blocks?: Blocks): BlockDef | undefined {
  return blocks?.[node.data?.type];
}

/** Node kind, from its block definition — or inferred for 1.x data without one. */
export function kindOf(node: WorkflowNode, blocks?: Blocks): BlockKind {
  const def = blockOf(node, blocks);
  if (def) return def.kind;
  if (node.type === 'terminal') return 'end';
  if (node.type === 'decision') return 'decision';
  if (node.data?.type === 'start' || node.data?.type === 'created') return 'start';
  return 'step';
}

/** Normalises a branch name; 1.x stored decision handles as 'true' / 'false'. */
export function normalizeBranch(branch: string | boolean | null | undefined): string | null {
  if (branch === true || branch === 'true') return 'yes';
  if (branch === false || branch === 'false') return 'no';
  return branch == null ? null : String(branch);
}

export function branchOf(edge: WorkflowEdge): string | null {
  const data = edge.data as { branch?: string } | undefined;
  return normalizeBranch(data?.branch ?? edge.sourceHandle ?? null);
}

export function getNode(workflow: Workflow, nodeId: string): WorkflowNode | undefined {
  return workflow.nodes.find((n) => n.id === nodeId);
}

export function outgoing(workflow: Workflow, nodeId: string): Step[] {
  const steps: Step[] = [];
  for (const edge of workflow.edges) {
    if (edge.source !== nodeId) continue;
    const node = getNode(workflow, edge.target);
    if (node) steps.push({ node, edge, branch: branchOf(edge) });
  }
  return steps;
}

export function isTerminal(workflow: Workflow, node: WorkflowNode, blocks?: Blocks): boolean {
  return kindOf(node, blocks) === 'end' || outgoing(workflow, node.id).length === 0;
}

/**
 * The entry node: the single node of kind 'start'; otherwise (1.x data) a node
 * typed 'start'/'created'; otherwise the single node with no incoming edges.
 */
export function findStartNode(workflow: Workflow, blocks?: Blocks): WorkflowNode | null {
  const starts = workflow.nodes.filter((n) => kindOf(n, blocks) === 'start');
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) return null;
  const targets = new Set(workflow.edges.map((e) => e.target));
  const roots = workflow.nodes.filter((n) => !targets.has(n.id));
  return roots.length === 1 ? roots[0] : null;
}

/**
 * Resolves a move from `fromNodeId` to exactly one next step, or throws.
 * Never guesses: unknown branches and ambiguous targets are errors.
 */
export function resolveMove(workflow: Workflow, fromNodeId: string, move: Move): Step {
  const from = getNode(workflow, fromNodeId);
  if (!from) throw new WorkflowError('NODE_NOT_FOUND', `Node "${fromNodeId}" is not in workflow ${workflow.id}`);
  const options = outgoing(workflow, fromNodeId);
  const describe = () => options.map((o) => (o.branch ? `${o.branch} → ${o.node.id}` : o.node.id));

  if ('to' in move) {
    if (move.force) {
      const node = getNode(workflow, move.to) ?? workflow.nodes.find((n) => n.data?.type === move.to);
      if (!node) throw new WorkflowError('NODE_NOT_FOUND', `Node "${move.to}" is not in workflow ${workflow.id}`);
      return { node, edge: null, branch: null };
    }
    const byId = options.filter((o) => o.node.id === move.to);
    const matches = byId.length ? byId : options.filter((o) => o.node.data?.type === move.to);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new WorkflowError('AMBIGUOUS_TRANSITION', `"${move.to}" matches ${matches.length} next nodes from "${fromNodeId}"; pass a node id`, {
        candidates: matches.map((m) => m.node.id),
      });
    }
    throw new WorkflowError('INVALID_TRANSITION', `Cannot move from "${fromNodeId}" to "${move.to}"`, { allowed: describe() });
  }

  if ('branch' in move) {
    const wanted = normalizeBranch(move.branch);
    const matches = options.filter((o) => o.branch === wanted);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new WorkflowError('AMBIGUOUS_TRANSITION', `Branch "${wanted}" has ${matches.length} edges from "${fromNodeId}"`, {
        candidates: matches.map((m) => m.node.id),
      });
    }
    throw new WorkflowError('INVALID_TRANSITION', `Node "${fromNodeId}" has no "${wanted}" branch`, { allowed: describe() });
  }

  if (options.length === 1) return options[0];
  if (options.length === 0) throw new WorkflowError('INVALID_TRANSITION', `Node "${fromNodeId}" has no outgoing edges`);
  throw new WorkflowError('AMBIGUOUS_TRANSITION', `Node "${fromNodeId}" has ${options.length} outgoing edges; pass { branch } or { to }`, {
    allowed: describe(),
  });
}

export { getBranches };
