import { getBranches, type Blocks, type Hooks } from './blocks';
import { blockOf, findStartNode, kindOf, outgoing } from './graph';
import type { Workflow, WorkflowInput } from './types';

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  hookId?: string;
}

export interface ValidateOptions {
  blocks?: Blocks;
  hooks?: Hooks;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Checks that a payload has the stored workflow shape. Used by the HTTP handler
 * to reject malformed requests (400) before anything is written.
 */
export function checkShape(input: unknown, partial = false): string[] {
  const errs: string[] = [];
  if (!isObj(input)) return ['body must be a JSON object'];
  const has = (k: string) => input[k] !== undefined;
  if (!partial || has('name')) {
    if (typeof input.name !== 'string' || !input.name.trim()) errs.push('name must be a non-empty string');
  }
  for (const key of ['nodes', 'edges', 'hooks'] as const) {
    if (!has(key)) {
      if (!partial && key !== 'hooks') errs.push(`${key} is required`);
      continue;
    }
    const list = input[key];
    if (!Array.isArray(list)) {
      errs.push(`${key} must be an array`);
      continue;
    }
    list.forEach((item, i) => {
      if (!isObj(item) || typeof item.id !== 'string') errs.push(`${key}[${i}].id must be a string`);
      else if (key === 'nodes' && (!isObj(item.data) || typeof item.data.type !== 'string')) errs.push(`nodes[${i}].data.type must be a string`);
      else if (key === 'edges' && (typeof item.source !== 'string' || typeof item.target !== 'string')) errs.push(`edges[${i}] needs source and target`);
      else if (key === 'hooks' && (typeof item.type !== 'string' || typeof item.trigger !== 'string')) errs.push(`hooks[${i}] needs type and trigger`);
    });
  }
  return errs;
}

/**
 * Semantic checks. Errors make a workflow unrunnable (engine.start refuses it);
 * warnings are shown in the editor but don't block anything. Drafts with errors
 * can still be saved.
 */
export function validateWorkflow(workflow: Workflow | WorkflowInput, opts: ValidateOptions = {}): ValidationIssue[] {
  const { blocks, hooks: hookDefs } = opts;
  const wf = { ...workflow, id: (workflow as Workflow).id ?? 'draft', hooks: workflow.hooks ?? [] } as Workflow;
  const issues: ValidationIssue[] = [];
  const err = (i: Omit<ValidationIssue, 'level'>) => issues.push({ level: 'error', ...i });
  const warn = (i: Omit<ValidationIssue, 'level'>) => issues.push({ level: 'warning', ...i });

  if (!wf.nodes.length) {
    err({ code: 'EMPTY', message: 'Workflow has no nodes' });
    return issues;
  }

  const ids = new Set<string>();
  for (const n of wf.nodes) {
    if (ids.has(n.id)) err({ code: 'DUPLICATE_ID', message: `Duplicate node id "${n.id}"`, nodeId: n.id });
    ids.add(n.id);
  }

  for (const e of wf.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      err({ code: 'DANGLING_EDGE', message: `Edge "${e.id}" points to a missing node`, edgeId: e.id });
    }
  }

  const starts = wf.nodes.filter((n) => kindOf(n, blocks) === 'start');
  const start = findStartNode(wf, blocks);
  if (starts.length > 1) {
    for (const s of starts.slice(1)) err({ code: 'MULTIPLE_STARTS', message: 'Only one start node is allowed', nodeId: s.id });
  } else if (!start) {
    err({ code: 'NO_START', message: 'Add a start node (or leave exactly one node without incoming edges)' });
  }

  for (const node of wf.nodes) {
    const def = blockOf(node, blocks);
    const label = node.data?.label || def?.label || node.data?.type;
    if (blocks && !def) {
      err({ code: 'UNKNOWN_BLOCK', message: `"${node.data?.type}" is not a known block`, nodeId: node.id });
      continue;
    }
    const kind = kindOf(node, blocks);
    const out = outgoing(wf, node.id);

    if (kind === 'end' && out.length) warn({ code: 'END_HAS_EXITS', message: `"${label}" is an end node but has outgoing edges`, nodeId: node.id });
    if (kind !== 'end' && !out.length) warn({ code: 'DEAD_END', message: `"${label}" has no way forward`, nodeId: node.id });

    if (kind === 'decision' && def) {
      const allowed = new Set(getBranches(def).map((b) => b.id));
      const used = new Map<string, number>();
      for (const o of out) {
        const b = o.branch ?? '(none)';
        used.set(b, (used.get(b) ?? 0) + 1);
        if (!allowed.has(b)) err({ code: 'UNKNOWN_BRANCH', message: `"${label}" has an edge on unknown branch "${b}"`, nodeId: node.id, edgeId: o.edge?.id });
      }
      for (const b of allowed) {
        if ((used.get(b) ?? 0) > 1) err({ code: 'DUPLICATE_BRANCH', message: `"${label}" has more than one "${b}" edge`, nodeId: node.id });
        if (!used.has(b)) warn({ code: 'MISSING_BRANCH', message: `"${label}" has no "${b}" edge`, nodeId: node.id });
      }
    }

    for (const [name, spec] of Object.entries(def?.variables ?? {})) {
      const val = node.data?.variables?.[name];
      if (spec.required && (val === undefined || val === null || val === '')) {
        err({ code: 'MISSING_VARIABLE', message: `"${label}": ${spec.label ?? name} is required`, nodeId: node.id });
      }
    }
  }

  if (start) {
    const seen = new Set<string>([start.id]);
    const queue = [start.id];
    while (queue.length) {
      for (const o of outgoing(wf, queue.shift()!)) {
        if (!seen.has(o.node.id)) {
          seen.add(o.node.id);
          queue.push(o.node.id);
        }
      }
    }
    for (const n of wf.nodes) {
      if (!seen.has(n.id)) warn({ code: 'UNREACHABLE', message: `"${n.data?.label || blockOf(n, blocks)?.label || n.data?.type}" can never be reached`, nodeId: n.id });
    }
  }

  for (const h of wf.hooks ?? []) {
    if (hookDefs && !hookDefs[h.type]) err({ code: 'UNKNOWN_HOOK', message: `"${h.type}" is not a known hook`, hookId: h.id });
    if (Array.isArray(h.scope)) {
      for (const id of h.scope) if (!ids.has(id)) warn({ code: 'HOOK_SCOPE', message: `Hook "${h.label ?? h.type}" is scoped to a missing node`, hookId: h.id });
    }
  }

  return issues;
}
