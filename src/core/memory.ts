import { NO_LICENSE } from './license';
import type { HistoryEntry, HistoryStore, Timer, TimerStore, Scope, Subject, SubjectStore, Workflow, WorkflowId, WorkflowInput, WorkflowStore } from './types';

const clone = <T>(x: T): T => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
const inScope = (row: Record<string, unknown>, scope?: Scope) => !scope || Object.entries(scope).every(([k, v]) => row[k] === v);

export interface MemoryWorkflowStore extends WorkflowStore {
  readonly [NO_LICENSE]: true;
  /** Current contents (cloned). */
  all(): Workflow[];
}

/**
 * In-memory workflow store, for tests, demos and in-browser simulation.
 * `onChange` receives the full list after every write (e.g. to persist to localStorage).
 */
export function memoryWorkflowStore(initial: Workflow[] = [], opts: { onChange?: (all: Workflow[]) => void } = {}): MemoryWorkflowStore {
  let rows = clone(initial).map((w) => ({ ...w, hooks: w.hooks ?? [] }));
  let nextId = rows.reduce((max, w) => (typeof w.id === 'number' && w.id > max ? w.id : max), 0) + 1;
  const changed = () => opts.onChange?.(clone(rows));
  const find = (id: WorkflowId, scope?: Scope) => rows.find((w) => String(w.id) === String(id) && inScope(w, scope));

  return {
    [NO_LICENSE]: true,
    all: () => clone(rows),
    async get(id, scope) {
      const w = find(id, scope);
      return w ? clone(w) : null;
    },
    async list(scope) {
      return clone(rows.filter((w) => inScope(w, scope))).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    async create(input: WorkflowInput, scope) {
      const now = new Date().toISOString();
      const row: Workflow = { description: null, hooks: [], ...clone(input), ...scope, id: nextId++, created_at: now, updated_at: now };
      rows.push(row);
      changed();
      return clone(row);
    },
    async update(id, patch, scope) {
      const w = find(id, scope);
      if (!w) return null;
      const { id: _ignore, ...rest } = clone(patch) as Record<string, unknown>;
      Object.assign(w, rest, { updated_at: new Date().toISOString() });
      changed();
      return clone(w);
    },
    async remove(id, scope) {
      const before = rows.length;
      rows = rows.filter((w) => !(String(w.id) === String(id) && inScope(w, scope)));
      if (rows.length !== before) changed();
      return rows.length !== before;
    },
  };
}

export interface MemorySubjectStore<S extends Subject = Subject> extends SubjectStore<S> {
  readonly [NO_LICENSE]: true;
  add(subject: Partial<S> & { id: S['id'] }): S;
  all(): S[];
}

export function memorySubjectStore<S extends Subject = Subject>(initial: Array<Partial<S> & { id: S['id'] }> = []): MemorySubjectStore<S> {
  const rows = new Map<string, S>();
  const add = (s: Partial<S> & { id: S['id'] }) => {
    const row = { workflowId: null, nodeId: null, ...clone(s) } as S;
    rows.set(String(s.id), row);
    return clone(row);
  };
  initial.forEach(add);
  return {
    [NO_LICENSE]: true,
    add,
    all: () => clone([...rows.values()]),
    async get(id) {
      const s = rows.get(String(id));
      return s ? clone(s) : null;
    },
    async setState(id, state) {
      const s = rows.get(String(id));
      if (!s) throw new Error(`memorySubjectStore: subject ${id} not found`);
      Object.assign(s, { workflowId: state.workflowId, nodeId: state.nodeId, status: state.nodeType });
    },
  };
}

export function memoryHistoryStore(): HistoryStore & { readonly [NO_LICENSE]: true } {
  const rows: HistoryEntry[] = [];
  let id = 1;
  return {
    [NO_LICENSE]: true,
    async append(entry) {
      rows.push({ ...entry, id: id++ });
    },
    async list(subjectId, opts = {}) {
      const all = rows.filter((r) => String(r.subjectId) === String(subjectId));
      return clone(opts.limit ? all.slice(-opts.limit) : all);
    },
  };
}

export function memoryTimerStore(): TimerStore & { readonly [NO_LICENSE]: true } {
  let rows: Timer[] = [];
  let id = 1;
  return {
    [NO_LICENSE]: true,
    async add(timer) {
      rows.push({ ...clone(timer), id: id++ });
    },
    async claimDue(now) {
      const due = rows.filter((t) => t.dueAt <= now.toISOString()).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
      if (!due) return null;
      rows = rows.filter((t) => t !== due);
      return clone(due);
    },
    async clear(subjectId) {
      rows = rows.filter((t) => String(t.subjectId) !== String(subjectId));
    },
    async list(subjectId) {
      return clone(rows.filter((t) => String(t.subjectId) === String(subjectId)));
    },
  };
}

export function memoryStores<S extends Subject = Subject>(opts: { workflows?: Workflow[]; subjects?: Array<Partial<S> & { id: S['id'] }> } = {}) {
  return { workflows: memoryWorkflowStore(opts.workflows), subjects: memorySubjectStore<S>(opts.subjects), history: memoryHistoryStore(), timers: memoryTimerStore() };
}
