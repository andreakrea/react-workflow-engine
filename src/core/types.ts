// ─── Stored workflow format (JSON, compatible with 1.x data) ──────────────────

export type WorkflowId = string | number;

export interface WorkflowNode {
  id: string;
  /** ReactFlow component type. 1.x used 'standard' | 'decision' | 'terminal' | 'hook'. */
  type?: string;
  position: { x: number; y: number };
  data: {
    /** Block id — the key that links this node to a block definition and its action. */
    type: string;
    /** Optional per-node label; falls back to the block label. */
    label?: string;
    /** Per-node values for the block's variables. */
    variables?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** For decision nodes: the branch this edge represents (e.g. 'yes', 'approve'). */
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
  [key: string]: unknown;
}

export type HookTrigger = 'on_node_entry' | 'on_node_exit' | 'on_transition' | 'on_message' | (string & {});

export interface WorkflowHook {
  id: string;
  /** Hook id — the key that links this hook to a hook definition and its handler. */
  type: string;
  trigger: HookTrigger;
  /** 'all' or a list of node ids where the hook is active. */
  scope: 'all' | string[];
  enabled?: boolean;
  label?: string;
  config?: Record<string, unknown>;
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface Workflow {
  id: WorkflowId;
  name: string;
  description?: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  hooks: WorkflowHook[];
  created_by?: string | null;
  created_at?: string | Date;
  updated_at?: string | Date;
  [key: string]: unknown;
}

export interface WorkflowInput {
  name: string;
  description?: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  hooks?: WorkflowHook[];
  [key: string]: unknown;
}

export type WorkflowPatch = Partial<WorkflowInput>;

/** Extra columns every query is filtered by (e.g. { tenant_id: 7 }). */
export type Scope = Record<string, unknown>;

// ─── Storage ports ─────────────────────────────────────────────────────────────

export interface WorkflowStore {
  get(id: WorkflowId, scope?: Scope, tx?: unknown): Promise<Workflow | null>;
  list(scope?: Scope): Promise<Workflow[]>;
  create(input: WorkflowInput, scope?: Scope): Promise<Workflow>;
  update(id: WorkflowId, patch: WorkflowPatch, scope?: Scope): Promise<Workflow | null>;
  remove(id: WorkflowId, scope?: Scope): Promise<boolean>;
}

/** The entity moving through a workflow (ticket, order, …). Extra fields are passed through. */
export interface Subject {
  id: string | number;
  workflowId: WorkflowId | null;
  nodeId: string | null;
  [key: string]: unknown;
}

export interface SubjectState {
  workflowId: WorkflowId;
  nodeId: string;
  /** The block id of nodeId — handy for a denormalised `status` column. */
  nodeType: string;
}

export interface SubjectStore<S extends Subject = Subject> {
  /** When called inside a transaction, implementations should lock the row. */
  get(id: Subject['id'], tx?: unknown): Promise<S | null>;
  setState(id: Subject['id'], state: SubjectState, tx?: unknown): Promise<void>;
}

export type TransactionRunner = <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;

export interface Logger {
  debug?(msg: string, meta?: unknown): void;
  warn?(msg: string, meta?: unknown): void;
  error?(msg: string, meta?: unknown): void;
}
