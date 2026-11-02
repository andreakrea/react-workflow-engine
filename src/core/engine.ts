import { getBranches, type RetryPolicy, type Blocks, type BranchIds, type Hooks, type InferVariables, type VariableSpecs } from './blocks';
import { WorkflowError, isWorkflowError } from './errors';
import { blockOf, findStartNode, getNode, isTerminal, outgoing, resolveMove, type Move, type Step } from './graph';
import { needsLicense, requireLicense } from './license';
import { resolveUntil, toMs } from './time';
import type {
  HistoryEntry,
  HistoryStore,
  HookTrigger,
  Logger,
  Timer,
  TimerStore,
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
  /** MoveOptions.actor of the call that led here (null when a timer fired). */
  actor: string | null;
  /** 1 on the first run, 2+ when retrying (see BlockDef.retry). */
  attempt: number;
  /** The open transaction (when the engine has a `transaction` runner). */
  tx: unknown;
}

/**
 * What an action returns:
 *   nothing        → stay on this node and wait for engine.move() (e.g. a human step)
 *   { next: true } → continue along the only outgoing edge
 *   { branch }     → decision: follow the edge for that branch
 *   { to }         → jump to a specific next node (id or block id)
 *   { wait, then? } → continue after a delay ('3d', ms, Date); `then` defaults to { next: true }
 */
export type ActionResult<Branch extends string = string> =
  | void
  | undefined
  | { next: true }
  | { branch: Branch }
  | { to: string }
  /** Stay here and continue later: a duration ('3d', ms), a Date or an ISO date. Needs a timers store. */
  | { wait: number | string | Date; then?: { next: true } | { branch: Branch } | { to: string } };

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
  /** Records every move (from, to, branch, actor, time). Read it with engine.history(). */
  history?: HistoryStore;
  /** Stores waits and retries. Fire due ones with engine.runDue() or engine.startTimers(). */
  timers?: TimerStore;
  /** Retry policy for every action without its own BlockDef.retry. */
  retry?: RetryPolicy;
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
  /** Who is making the move (user id, 'system', ...). Stored in history and passed to handlers. */
  actor?: string | null;
}

export interface RunResult<S extends Subject = Subject> {
  subject: S;
  node: NodeInfo;
  /** Node ids entered during this call, in order (more than one when actions auto-advance). */
  path: string[];
  status: 'waiting' | 'completed';
  /** Set when the subject is waiting on a timer (an action returned { wait }, or a retry is scheduled). */
  wait?: { kind: 'resume' | 'retry'; until: string; attempt?: number };
}

export interface NextOption {
  nodeId: string;
  type: string;
  label: string;
  branch: string | null;
  /** Display label of the branch, from the block definition. */
  branchLabel: string | null;
}

export interface SubjectView<S extends Subject = Subject> {
  subject: S;
  /** Current node, or null before start. */
  node: NodeInfo | null;
  next: NextOption[];
  status: 'not_started' | 'waiting' | 'completed';
  /** Pending waits and retries ([] without a timers store). */
  timers: Timer[];
}

export interface EngineEvents {
  transitioned: { subjectId: Subject['id']; workflowId: WorkflowId; from: string | null; to: string; branch: string | null; actor: string | null };
  completed: { subjectId: Subject['id']; workflowId: WorkflowId; nodeId: string };
  actionError: { subjectId: Subject['id']; nodeId: string; attempt: number; error: unknown };
  scheduled: { subjectId: Subject['id']; nodeId: string; kind: 'resume' | 'retry'; until: string; attempt: number };
  timerError: { timer: Timer; error: unknown };
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
  /** Where a subject is and what can happen next, in one call. */
  get(subjectId: S['id']): Promise<SubjectView<S>>;
  /** Recorded moves, oldest first ([] without a history store). */
  history(subjectId: S['id'], opts?: { limit?: number }): Promise<HistoryEntry[]>;
  can(subjectId: S['id'], move: Move): Promise<boolean>;
  /** Fires hooks for any trigger (e.g. 'on_message') at the subject's current node. */
  emit(subjectId: S['id'], trigger: HookTrigger, input?: Record<string, unknown>): Promise<{ fired: number; failed: number }>;
  validate(workflow: Workflow): ValidationIssue[];
  /** Fires due timers (waits and retries). Call it from a cron job or queue worker, or use startTimers(). */
  runDue(opts?: { now?: Date; limit?: number }): Promise<{ processed: number; failed: number }>;
  /** Calls runDue() every `intervalMs` (default 5000). Returns a stop function. */
  startTimers(opts?: { intervalMs?: number }): () => void;
  on<E extends keyof EngineEvents>(event: E, listener: (payload: EngineEvents[E]) => void): () => void;
  readonly workflows: WorkflowStore;
  readonly blocks: B | undefined;
}

export function createEngine<const B extends Blocks, const H extends Hooks, S extends Subject>(
  options: EngineOptions<B, H, S>,
): Engine<B, S> {
  const { workflows, subjects, transaction, history, timers, blocks, hooks: hookDefs, maxSteps = 100 } = options;
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

  type Outcome = { move?: Move; wait?: RunResult['wait'] };

  /** Runs the node's action and turns its result (or failure) into what happens next. */
  async function act(subject: S, workflow: Workflow, node: WorkflowNode, attempt: number, input: Record<string, unknown>, actor: string | null, tx: unknown): Promise<Outcome> {
    const type = node.data?.type;
    const action: ((ctx: ActionContext) => Awaitable<ActionResult>) | undefined = actions[type];
    if (!action) return {};
    let result: ActionResult;
    try {
      result = await action({ subject, node: info(node), variables: { ...(node.data?.variables ?? {}) }, workflow, input, actor, attempt, tx });
    } catch (error) {
      fire('actionError', { subjectId: subject.id, nodeId: node.id, attempt, error });
      if (isWorkflowError(error)) throw error;
      const policy = blockOf(node, blocks)?.retry ?? options.retry;
      if (policy && timers && attempt < policy.attempts) {
        const delay = toMs(policy.delay ?? '30s') * Math.pow(policy.backoff ?? 2, attempt - 1);
        const until = new Date(Date.now() + delay).toISOString();
        await timers.add({ subjectId: subject.id, workflowId: workflow.id, nodeId: node.id, kind: 'retry', dueAt: until, move: null, attempt: attempt + 1 }, tx);
        log.warn?.(`vise-workflow-engine: action "${type}" failed (attempt ${attempt}/${policy.attempts}), retrying at ${until}`, error);
        fire('scheduled', { subjectId: subject.id, nodeId: node.id, kind: 'retry', until, attempt: attempt + 1 });
        return { wait: { kind: 'retry', until, attempt: attempt + 1 } };
      }
      throw new WorkflowError('ACTION_FAILED', `Action "${type}" failed on node "${node.id}"`, { nodeId: node.id, attempt }, { cause: error });
    }
    if (!result || typeof result !== 'object') return {};
    if ('wait' in result) {
      if (!timers) throw new TypeError(`vise-workflow-engine: action "${type}" returned { wait } but the engine has no timers store`);
      const until = resolveUntil(result.wait);
      await timers.add({ subjectId: subject.id, workflowId: workflow.id, nodeId: node.id, kind: 'resume', dueAt: until, move: result.then ?? { next: true }, attempt: 1 }, tx);
      fire('scheduled', { subjectId: subject.id, nodeId: node.id, kind: 'resume', until, attempt: 1 });
      return { wait: { kind: 'resume', until } };
    }
    return { move: result as Move };
  }

  type Start = { enter: Step; from: WorkflowNode | null } | { actAt: WorkflowNode; attempt: number };

  /**
   * Enters nodes and runs their actions, following the moves actions return.
   * Starts either by entering a node, or (retries) by re-running the current node's action.
   */
  async function walk(subject: S, workflow: Workflow, start: Start, input: Record<string, unknown>, actor: string | null, tx: unknown): Promise<RunResult<S>> {
    const path: string[] = [];
    let current: WorkflowNode | null = 'enter' in start ? start.from : start.actAt;
    let step: Step | null = 'enter' in start ? start.enter : null;
    let actOn: WorkflowNode | null = 'enter' in start ? null : start.actAt;
    let attempt = 'enter' in start ? 1 : start.attempt;
    let wait: RunResult['wait'];

    for (;;) {
      if (step) {
        if (path.length >= maxSteps) {
          throw new WorkflowError('MAX_STEPS', `Stopped after ${maxSteps} automatic steps (cycle?)`, { path });
        }
        const target: WorkflowNode = step.node;
        const ctx = { workflow, input, tx, from: current, to: target };

        if (current) await runHooks('on_node_exit', current, { subject, ...ctx });

        await subjects.setState(subject.id, { workflowId: workflow.id, nodeId: target.id, nodeType: target.data?.type }, tx);
        if (timers) await timers.clear(subject.id, tx);
        subject = { ...subject, workflowId: workflow.id, nodeId: target.id };
        path.push(target.id);
        // Only the first step is the caller's; later ones are the engine following actions.
        const by = path.length === 1 ? actor : null;
        const entry = { subjectId: subject.id, workflowId: workflow.id, from: current?.id ?? null, to: target.id, branch: step.branch, actor: by };
        if (history) await history.append({ ...entry, at: new Date().toISOString() }, tx);
        fire('transitioned', entry);

        if (current) await runHooks('on_transition', target, { subject, ...ctx });
        await runHooks('on_node_entry', target, { subject, ...ctx });

        current = target;
        actOn = target;
        attempt = 1;
        step = null;
      }
      if (!actOn) break;
      const node = actOn;
      actOn = null;
      const outcome = await act(subject, workflow, node, attempt, input, actor, tx);
      if (outcome.move) step = resolveMove(workflow, node.id, outcome.move);
      else {
        wait = outcome.wait;
        break;
      }
    }

    const node = current!;
    const completed = !wait && isTerminal(workflow, node, blocks);
    if (completed) fire('completed', { subjectId: subject.id, workflowId: workflow.id, nodeId: node.id });
    return { subject, node: info(node), path, status: completed ? 'completed' : 'waiting', ...(wait ? { wait } : {}) };
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
        return walk(subject, workflow, { enter: { node: start, edge: null, branch: null }, from: null }, opts.input ?? {}, opts.actor ?? null, tx);
      });
    },

    move(subjectId, move, opts = {}) {
      return run(async (tx) => {
        const { subject, workflow, node } = await load(subjectId, tx);
        return walk(subject, workflow, { enter: resolveMove(workflow, node.id, move), from: node }, opts.input ?? {}, opts.actor ?? null, tx);
      });
    },

    async get(subjectId) {
      const subject = await getSubject(subjectId, undefined);
      if (subject.workflowId == null || subject.nodeId == null) return { subject, node: null, next: [], status: 'not_started', timers: [] };
      const workflow = await getWorkflow(subject.workflowId, undefined);
      const node = getNode(workflow, subject.nodeId);
      if (!node) throw new WorkflowError('NODE_NOT_FOUND', `Subject ${subjectId} is on node "${subject.nodeId}", which no longer exists`, { subjectId });
      const pending = timers ? await timers.list(subjectId) : [];
      return { subject, node: info(node), next: await engine.next(subjectId), status: isTerminal(workflow, node, blocks) ? 'completed' : 'waiting', timers: pending };
    },

    async history(subjectId, opts) {
      return history ? history.list(subjectId, opts) : [];
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

    async runDue({ now = new Date(), limit = 100 } = {}) {
      if (!timers) return { processed: 0, failed: 0 };
      let processed = 0;
      let failed = 0;
      for (let i = 0; i < limit; i++) {
        // Claim (remove) first, in its own transaction, so two workers never run the same timer.
        const timer = await run((tx) => timers.claimDue(now, tx));
        if (!timer) break;
        try {
          await run(async (tx) => {
            const subject = await subjects.get(timer.subjectId, tx);
            // Stale: the subject moved on (or was restarted) since the timer was set.
            if (!subject || subject.nodeId !== timer.nodeId || String(subject.workflowId) !== String(timer.workflowId)) return;
            const workflow = await getWorkflow(timer.workflowId, tx);
            const node = getNode(workflow, timer.nodeId);
            if (!node) return;
            if (timer.kind === 'resume') {
              return walk(subject, workflow, { enter: resolveMove(workflow, node.id, (timer.move ?? { next: true }) as Move), from: node }, { timer: true }, null, tx);
            }
            return walk(subject, workflow, { actAt: node, attempt: timer.attempt }, { retry: timer.attempt }, null, tx);
          });
          processed++;
        } catch (error) {
          failed++;
          log.error?.(`vise-workflow-engine: timer for subject ${timer.subjectId} failed`, error);
          fire('timerError', { timer, error });
        }
      }
      return { processed, failed };
    },

    startTimers({ intervalMs = 5000 } = {}) {
      let busy = false;
      const tick = async () => {
        if (busy) return;
        busy = true;
        try {
          await engine.runDue();
        } catch (error) {
          log.error?.('vise-workflow-engine: runDue failed', error);
        } finally {
          busy = false;
        }
      };
      const handle = setInterval(() => void tick(), intervalMs);
      void tick();
      return () => clearInterval(handle);
    },

    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
  };

  return engine;
}
