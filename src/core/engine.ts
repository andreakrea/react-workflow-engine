import { getBranches, type Blocks, type BranchIds, type Hooks, type InferVariables, type VariableSpecs } from './blocks';
import { WorkflowError, isWorkflowError } from './errors';
import { blockOf, findStartNode, getNode, isTerminal, outgoing, resolveMove, type Move, type Step } from './graph';
import { needsLicense, requireLicense } from './license';
import type {
  HookTrigger,
  Logger,
  Subject,
  SubjectStore,
  TransactionRunner,
  Workflow,
  WorkflowHook,
  WorkflowId,
  WorkflowNode,
  WorkflowStore,
} from './types';
import { validateWorkflow, type ValidationIssue } from './validate';

type Awaitable<T> = T | Promise<T>;

export interface NodeInfo {
  id: string;
  type: string;
  label: string;
}

// ─── Handler contracts ────────────────────────────────────────────────────────

export interface ActionContext<V = Record<string, any>, S extends Subject = Subject> {
  subject: S;
  node: NodeInfo;
  /** This node's configured values for the block's variables. */
  variables: V;
  workflow: Workflow;
  /** Whatever the caller passed as `input` to start / move. */
  input: Record<string, unknown>;
  /** The open transaction (when the engine has a `transaction` runner). */
  tx: unknown;
}

/**
 * What an action returns:
 *   nothing        → stay on this node and wait for engine.move() (e.g. a human step)
 *   { next: true } → continue along the only outgoing edge
 *   { branch }     → decision: follow the edge for that branch
 *   { to }         → jump to a specific next node (id or block id)
 */
export type ActionResult<Branch extends string = string> = void | undefined | { next: true } | { branch: Branch } | { to: string };

export interface HookContext<C = Record<string, any>, S extends Subject = Subject> {
  subject: S;
  hook: WorkflowHook;
  /** The hook's configured values. */
  config: C;
  trigger: HookTrigger;
  /** The node the hook fired for (entered, exited, or current). */
  node: NodeInfo | null;
  from: NodeInfo | null;
  to: NodeInfo | null;
  workflow: Workflow;
  input: Record<string, unknown>;
  tx: unknown;
}

/** Typed `variables` for a block; loose when the block declares none (or blocks aren't given). */
type VariablesOf<D> = D extends { variables: infer V extends VariableSpecs } ? InferVariables<V> : Record<string, any>;
type ConfigOf<D> = D extends { config: infer V extends VariableSpecs } ? InferVariables<V> : Record<string, any>;

/** Branch ids a block's action may return: its branches for decisions, none for other kinds. */
type BranchOf<D> = D extends { kind: 'decision' } ? BranchIds<D> : D extends { kind: infer K } ? ('decision' extends K ? string : never) : string;

type ActionFor<D, S extends Subject> = (ctx: ActionContext<VariablesOf<D>, S>) => Awaitable<ActionResult<BranchOf<D>>>;

export type Actions<B extends Blocks, S extends Subject = Subject> = { [K in keyof B]?: ActionFor<B[K], S> };

export type HookHandlers<H extends Hooks, S extends Subject = Subject> = {
  [K in keyof H]?: (ctx: HookContext<ConfigOf<H[K]>, S>) => Awaitable<unknown>;
};

// ─── Engine ───────────────────────────────────────────────────────────────────

export interface EngineOptions<B extends Blocks, H extends Hooks, S extends Subject> {
  workflows: WorkflowStore;
  subjects: SubjectStore<S>;
  /** Wraps every start / move in one transaction (state + your handlers). */
  transaction?: TransactionRunner;
  /** Block definitions shared with the editor. Enables typed actions and validation. */
  blocks?: B;
  /** Hook definitions shared with the editor. */
  hooks?: H;
  actions?: NoInfer<Actions<B, S>>;
  hookHandlers?: NoInfer<HookHandlers<H, S>>;
  /** Upper bound on automatic steps per call (protects against cycles). Default 100. */
  maxSteps?: number;
  logger?: Logger;
  licenseKey?: string;
}

export interface MoveOptions {
  input?: Record<string, unknown>;
}

export interface RunResult<S extends Subject = Subject> {
  subject: S;
  node: NodeInfo;
  /** Node ids entered during this call, in order (more than one when actions auto-advance). */
  path: string[];
  status: 'waiting' | 'completed';
}

export interface NextOption {
  nodeId: string;
  type: string;
  label: string;
  branch: string | null;
  /** Display label of the branch, from the block definition. */
  branchLabel: string | null;
}

export interface EngineEvents {
  transitioned: { subjectId: Subject['id']; workflowId: WorkflowId; from: string | null; to: string; branch: string | null };
  completed: { subjectId: Subject['id']; workflowId: WorkflowId; nodeId: string };
  actionError: { subjectId: Subject['id']; nodeId: string; error: unknown };
  hookError: { subjectId: Subject['id']; hookId: string; trigger: HookTrigger; error: unknown };
  hookExecuted: { subjectId: Subject['id']; hookId: string; hookType: string; trigger: HookTrigger };
}

export interface Engine<B extends Blocks = Blocks, S extends Subject = Subject> {
  /** Assigns a workflow to a subject and enters its start node. */
  start(subjectId: S['id'], workflowId: WorkflowId, opts?: MoveOptions): Promise<RunResult<S>>;
  /** Moves a subject: { to }, { branch } or { next: true }. Throws on invalid or ambiguous moves. */
  move(subjectId: S['id'], move: Move, opts?: MoveOptions): Promise<RunResult<S>>;
  /** Valid next steps from the subject's current node. */
  next(subjectId: S['id']): Promise<NextOption[]>;
  can(subjectId: S['id'], move: Move): Promise<boolean>;
  /** Fires hooks for any trigger (e.g. 'on_message') at the subject's current node. */
  emit(subjectId: S['id'], trigger: HookTrigger, input?: Record<string, unknown>): Promise<{ fired: number; failed: number }>;
  validate(workflow: Workflow): ValidationIssue[];
  on<E extends keyof EngineEvents>(event: E, listener: (payload: EngineEvents[E]) => void): () => void;
  readonly workflows: WorkflowStore;
  readonly blocks: B | undefined;
}

export function createEngine<const B extends Blocks, const H extends Hooks, S extends Subject>(
  options: EngineOptions<B, H, S>,
): Engine<B, S> {
  const { workflows, subjects, transaction, blocks, hooks: hookDefs, maxSteps = 100 } = options;
  if (!workflows) throw new TypeError('createEngine: `workflows` store is required');
  if (!subjects) throw new TypeError('createEngine: `subjects` store is required');
  if (options.licenseKey || needsLicense(workflows, subjects)) requireLicense('createEngine', options.licenseKey);

  const actions = (options.actions ?? {}) as Record<string, (ctx: ActionContext) => Awaitable<ActionResult>>;
  const hookHandlers = (options.hookHandlers ?? {}) as Record<string, (ctx: HookContext) => Awaitable<unknown>>;
  const log: Logger = options.logger ?? { warn: (m, x) => console.warn(m, x ?? ''), error: (m, x) => console.error(m, x ?? '') };

  if (blocks) {
    for (const key of Object.keys(actions)) {
      if (!blocks[key]) throw new TypeError(`createEngine: action "${key}" does not match any block`);
    }
  }
  if (hookDefs) {
    for (const key of Object.keys(hookHandlers)) {
      if (!hookDefs[key]) throw new TypeError(`createEngine: hook handler "${key}" does not match any hook definition`);
    }
  }

  const listeners = new Map<keyof EngineEvents, Set<(p: any) => void>>();
  function fire<E extends keyof EngineEvents>(event: E, payload: EngineEvents[E]) {
    for (const fn of listeners.get(event) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        log.error?.(`vise-workflow-engine: "${event}" listener threw`, err);
      }
    }
  }

  const run = <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => (transaction ? transaction(fn) : fn(undefined));

  const info = (node: WorkflowNode): NodeInfo => ({
    id: node.id,
    type: node.data?.type,
    label: node.data?.label || blockOf(node, blocks)?.label || node.data?.type,
  });

  async function getWorkflow(id: WorkflowId, tx: unknown): Promise<Workflow> {
    const wf = await workflows.get(id, undefined, tx);
    if (!wf) throw new WorkflowError('WORKFLOW_NOT_FOUND', `Workflow ${id} not found`, { workflowId: id });
    return wf;
  }

  async function getSubject(id: S['id'], tx: unknown): Promise<S> {
    const s = await subjects.get(id, tx);
    if (!s) throw new WorkflowError('SUBJECT_NOT_FOUND', `Subject ${id} not found`, { subjectId: id });
    return s;
  }

  async function load(id: S['id'], tx: unknown) {
    const subject = await getSubject(id, tx);
    if (subject.workflowId == null || subject.nodeId == null) {
      throw new WorkflowError('NO_WORKFLOW', `Subject ${id} has not been started on a workflow`, { subjectId: id });
    }
    const workflow = await getWorkflow(subject.workflowId, tx);
    const node = getNode(workflow, subject.nodeId);
    if (!node) throw new WorkflowError('NODE_NOT_FOUND', `Subject ${id} is on node "${subject.nodeId}", which no longer exists`, { subjectId: id });
    return { subject, workflow, node };
  }

  async function runHooks(
    trigger: HookTrigger,
    at: WorkflowNode | null,
    base: { subject: S; workflow: Workflow; input: Record<string, unknown>; tx: unknown; from: WorkflowNode | null; to: WorkflowNode | null },
  ): Promise<{ fired: number; failed: number }> {
    const list = (base.workflow.hooks ?? []).filter(
      (h) => h.trigger === trigger && h.enabled !== false && (h.scope === 'all' || (at != null && Array.isArray(h.scope) && h.scope.includes(at.id))),
    );
    let failed = 0;
    await Promise.all(
      list.map(async (hook) => {
        const handler = hookHandlers[hook.type];
        if (!handler) {
          log.warn?.(`vise-workflow-engine: no handler for hook "${hook.type}"`);
          return;
        }
        try {
          await handler({
            subject: base.subject,
            hook,
            config: hook.config ?? {},
            trigger,
            node: at ? info(at) : null,
            from: base.from ? info(base.from) : null,
            to: base.to ? info(base.to) : null,
            workflow: base.workflow,
            input: base.input,
            tx: base.tx,
          });
          fire('hookExecuted', { subjectId: base.subject.id, hookId: hook.id, hookType: hook.type, trigger });
        } catch (error) {
          failed++;
          log.error?.(`vise-workflow-engine: hook "${hook.type}" failed`, error);
          fire('hookError', { subjectId: base.subject.id, hookId: hook.id, trigger, error });
        }
      }),
    );
    return { fired: list.length, failed };
  }

  /** Enters `first`, runs hooks and the action, and keeps going while actions return a move. */
  async function walk(subject: S, workflow: Workflow, from: WorkflowNode | null, first: Step, input: Record<string, unknown>, tx: unknown): Promise<RunResult<S>> {
    const path: string[] = [];
    let current = from;
    let step: Step | null = first;

    while (step) {
      if (path.length >= maxSteps) {
        throw new WorkflowError('MAX_STEPS', `Stopped after ${maxSteps} automatic steps (cycle?)`, { path });
      }
      const target: WorkflowNode = step.node;
      const ctx = { workflow, input, tx, from: current, to: target };

      if (current) await runHooks('on_node_exit', current, { subject, ...ctx });

      await subjects.setState(subject.id, { workflowId: workflow.id, nodeId: target.id, nodeType: target.data?.type }, tx);
      subject = { ...subject, workflowId: workflow.id, nodeId: target.id };
      path.push(target.id);
      fire('transitioned', { subjectId: subject.id, workflowId: workflow.id, from: current?.id ?? null, to: target.id, branch: step.branch });

      if (current) await runHooks('on_transition', target, { subject, ...ctx });
      await runHooks('on_node_entry', target, { subject, ...ctx });

      const action: ((ctx: ActionContext) => Awaitable<ActionResult>) | undefined = actions[target.data?.type];
      let result: ActionResult;
      try {
        result = action
          ? await action({ subject, node: info(target), variables: { ...(target.data?.variables ?? {}) }, workflow, input, tx })
          : undefined;
      } catch (error) {
        fire('actionError', { subjectId: subject.id, nodeId: target.id, error });
        if (isWorkflowError(error)) throw error;
        throw new WorkflowError('ACTION_FAILED', `Action "${target.data?.type}" failed on node "${target.id}"`, { nodeId: target.id }, { cause: error });
      }

      current = target;
      step = result && typeof result === 'object' ? resolveMove(workflow, target.id, result as Move) : null;
    }

    const node = current!;
    const completed = isTerminal(workflow, node, blocks);
    if (completed) fire('completed', { subjectId: subject.id, workflowId: workflow.id, nodeId: node.id });
    return { subject, node: info(node), path, status: completed ? 'completed' : 'waiting' };
  }

  const engine: Engine<B, S> = {
    workflows,
    blocks,

    start(subjectId, workflowId, opts = {}) {
      return run(async (tx) => {
        const subject = await getSubject(subjectId, tx);
        const workflow = await getWorkflow(workflowId, tx);
        const errors = validateWorkflow(workflow, { blocks, hooks: hookDefs }).filter((i) => i.level === 'error');
        if (errors.length) {
          throw new WorkflowError('INVALID_WORKFLOW', `Workflow ${workflowId} has ${errors.length} error(s): ${errors[0].message}`, { issues: errors });
        }
        const start = findStartNode(workflow, blocks);
        if (!start) throw new WorkflowError('NO_START_NODE', `Workflow ${workflowId} has no start node`);
        return walk(subject, workflow, null, { node: start, edge: null, branch: null }, opts.input ?? {}, tx);
      });
    },

    move(subjectId, move, opts = {}) {
      return run(async (tx) => {
        const { subject, workflow, node } = await load(subjectId, tx);
        return walk(subject, workflow, node, resolveMove(workflow, node.id, move), opts.input ?? {}, tx);
      });
    },

    async next(subjectId) {
      const { workflow, node } = await load(subjectId, undefined);
      const branches = getBranches(blockOf(node, blocks));
      return outgoing(workflow, node.id).map((o) => ({
        nodeId: o.node.id,
        type: o.node.data?.type,
        label: info(o.node).label,
        branch: o.branch,
        branchLabel: o.branch ? (branches.find((b) => b.id === o.branch)?.label ?? o.branch) : null,
      }));
    },

    async can(subjectId, move) {
      const { workflow, node } = await load(subjectId, undefined);
      try {
        resolveMove(workflow, node.id, move);
        return true;
      } catch (err) {
        if (isWorkflowError(err)) return false;
        throw err;
      }
    },

    emit(subjectId, trigger, input = {}) {
      return run(async (tx) => {
        const { subject, workflow, node } = await load(subjectId, tx);
        return runHooks(trigger, node, { subject, workflow, input, tx, from: null, to: null });
      });
    },

    validate(workflow) {
      return validateWorkflow(workflow, { blocks, hooks: hookDefs });
    },

    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
  };

  return engine;
}
