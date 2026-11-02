import { memoryWorkflowStore } from '../core/memory';
import type { Workflow, WorkflowId, WorkflowInput, WorkflowPatch } from '../core/types';
import type { ValidationIssue } from '../core/validate';

/** How the editor loads and saves workflows. Implement it to use any backend. */
export interface WorkflowClient {
  list(): Promise<Workflow[]>;
  get(id: WorkflowId): Promise<Workflow>;
  create(input: WorkflowInput): Promise<Workflow>;
  update(id: WorkflowId, patch: WorkflowPatch): Promise<Workflow>;
  remove(id: WorkflowId): Promise<void>;
}

export class WorkflowClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WorkflowClientError';
  }
}

export interface HttpClientOptions {
  /** Exact URL where createHandler is mounted, e.g. '/api/workflows'. Nothing is appended. */
  baseUrl: string;
  /** Extra headers on every request (auth, tenant, CSRF…). May be async. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  /** Custom fetch (for interceptors, retries, tests). */
  fetch?: typeof fetch;
  /** Passed to fetch, e.g. 'include' for cookie auth across origins. */
  credentials?: RequestCredentials;
}

/** Client for the createHandler() HTTP API. */
export function createHttpClient(opts: HttpClientOptions): WorkflowClient & { lastIssues?: ValidationIssue[] } {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const extra = typeof opts.headers === 'function' ? await opts.headers() : opts.headers;
    const headers = new Headers(extra);
    if (body !== undefined) headers.set('content-type', 'application/json');
    headers.set('accept', 'application/json');
    const res = await doFetch(`${base}${path}`, {
      method,
      headers,
      credentials: opts.credentials,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
      throw new WorkflowClientError(e?.message ?? `Request failed (${res.status})`, res.status, e?.code ?? 'HTTP_ERROR', e?.details);
    }
    return data as T;
  }

  return {
    list: async () => (await request<{ workflows: Workflow[] }>('GET', '')).workflows,
    get: async (id) => (await request<{ workflow: Workflow }>('GET', `/${encodeURIComponent(String(id))}`)).workflow,
    create: async (input) => (await request<{ workflow: Workflow }>('POST', '', input)).workflow,
    update: async (id, patch) => (await request<{ workflow: Workflow }>('PUT', `/${encodeURIComponent(String(id))}`, patch)).workflow,
    remove: async (id) => {
      await request('DELETE', `/${encodeURIComponent(String(id))}`);
    },
  };
}

/**
 * Client that keeps workflows in the browser (localStorage), for prototypes,
 * demos and tests. No backend needed.
 */
export function createLocalClient(opts: { storageKey?: string; initial?: Workflow[] } = {}): WorkflowClient {
  const key = opts.storageKey ?? 'vise-workflow-engine';
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  let initial = opts.initial ?? [];
  try {
    const raw = storage?.getItem(key);
    if (raw) initial = JSON.parse(raw);
  } catch {
    /* ignore corrupt storage */
  }
  const store = memoryWorkflowStore(initial, { onChange: (all) => storage?.setItem(key, JSON.stringify(all)) });
  const notFound = (id: WorkflowId) => new WorkflowClientError(`Workflow ${id} not found`, 404, 'NOT_FOUND');
  return {
    list: () => store.list(),
    get: async (id) => (await store.get(id)) ?? Promise.reject(notFound(id)),
    create: (input) => store.create(input),
    update: async (id, patch) => (await store.update(id, patch)) ?? Promise.reject(notFound(id)),
    remove: async (id) => {
      if (!(await store.remove(id))) throw notFound(id);
    },
  };
}
