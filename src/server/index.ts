import type { IncomingMessage, ServerResponse } from 'node:http';
import { needsLicense, requireLicense } from '../core/license';
import type { Scope, WorkflowStore } from '../core/types';
import { checkShape, type ValidationIssue } from '../core/validate';
import type { Workflow } from '../core/types';

export type WorkflowAction = 'list' | 'read' | 'create' | 'update' | 'delete';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface HandlerOptions<C = any> {
  /** Where workflows are stored. Pass `engine.workflows`, knexWorkflowStore(knex), … */
  store: WorkflowStore;
  /**
   * Validation run on reads and writes; issues are returned next to the workflow.
   * Pass `engine.validate` to check against your block definitions.
   */
  validate?: (workflow: Workflow) => ValidationIssue[];
  /** Columns every query is filtered by — use it for multi-tenancy: (req) => ({ tenant_id: user.orgId }). */
  scope?: (request: Request, ctx: C) => Scope | undefined | Promise<Scope | undefined>;
  /** Return false to answer 403. */
  authorize?: (request: Request, action: WorkflowAction, ctx: C) => boolean | Promise<boolean>;
  /** Value stored in created_by on create (never taken from the request body). */
  createdBy?: (request: Request, ctx: C) => string | null | undefined | Promise<string | null | undefined>;
  /** Path prefix to strip when the framework passes full URLs (Next.js, Hono, Bun). Not needed with toNodeHandler under app.use(). */
  basePath?: string;
  /** Called with unexpected errors (responses never include internal messages). */
  onError?: (error: unknown) => void;
  licenseKey?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkflowHandler<C = any> = ((request: Request, ctx?: C) => Promise<Response>) & {
  GET: (request: Request, ctx?: C) => Promise<Response>;
  POST: (request: Request, ctx?: C) => Promise<Response>;
  PUT: (request: Request, ctx?: C) => Promise<Response>;
  PATCH: (request: Request, ctx?: C) => Promise<Response>;
  DELETE: (request: Request, ctx?: C) => Promise<Response>;
};

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });

const fail = (status: number, code: string, message: string, details?: unknown) =>
  json(status, { error: { code, message, ...(details ? { details } : {}) } });

const WRITABLE = ['name', 'description', 'nodes', 'edges', 'hooks'] as const;
const pick = (body: Record<string, unknown>) =>
  Object.fromEntries(WRITABLE.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));

/**
 * CRUD for workflow definitions, as a standard fetch handler:
 *
 *   GET    /       → { workflows }
 *   GET    /:id    → { workflow, issues }
 *   POST   /       → 201 { workflow, issues }      body: { name, nodes, edges, hooks?, description? }
 *   PUT    /:id    → { workflow, issues }          body: any subset (PATCH works too)
 *   DELETE /:id    → 204
 *   errors         → { error: { code, message, details? } }
 */
/**
 * `C` is whatever your framework passes as the second argument — `{ req, res }`
 * under toNodeHandler. It defaults to `any` so `(_r, { req }) => req.user` works
 * with your own Express typings; pass a type argument for stricter checks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHandler<C = any>(options: HandlerOptions<C>): WorkflowHandler<C> {
  const { store, validate, scope, authorize, createdBy, onError } = options;
  if (!store) throw new TypeError('createHandler: `store` is required');
  if (options.licenseKey || needsLicense(store)) requireLicense('createHandler', options.licenseKey);
  const base = (options.basePath ?? '').replace(/\/+$/, '');
  const withIssues = (workflow: Workflow) => ({ workflow, issues: validate ? validate(workflow) : [] });

  async function handle(request: Request, ctx?: C): Promise<Response> {
    try {
      let path = new URL(request.url).pathname;
      if (base && path.startsWith(base)) path = path.slice(base.length);
      const segments = path.split('/').filter(Boolean);
      if (segments.length > 1) return fail(404, 'NOT_FOUND', 'Not found');
      const id = segments[0] ? decodeURIComponent(segments[0]) : null;
      const method = request.method.toUpperCase();

      const action: WorkflowAction | null =
        method === 'GET' ? (id ? 'read' : 'list')
        : method === 'POST' && !id ? 'create'
        : (method === 'PUT' || method === 'PATCH') && id ? 'update'
        : method === 'DELETE' && id ? 'delete'
        : null;
      if (!action) return fail(405, 'METHOD_NOT_ALLOWED', `${method} ${id ? '/:id' : '/'} is not supported`);

      if (authorize && !(await authorize(request, action, ctx as C))) return fail(403, 'FORBIDDEN', 'Not allowed');
      const s = scope ? await scope(request, ctx as C) : undefined;

      if (action === 'list') return json(200, { workflows: await store.list(s) });
      if (action === 'delete') return (await store.remove(id!, s)) ? json(204) : fail(404, 'NOT_FOUND', 'Workflow not found');
      if (action === 'read') {
        const wf = await store.get(id!, s);
        return wf ? json(200, withIssues(wf)) : fail(404, 'NOT_FOUND', 'Workflow not found');
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return fail(400, 'INVALID_BODY', 'Body must be JSON');
      }
      const errors = checkShape(body, action === 'update');
      if (errors.length) return fail(400, 'INVALID_BODY', errors[0], errors);
      const data = pick(body as Record<string, unknown>);

      if (action === 'create') {
        const by = createdBy ? await createdBy(request, ctx as C) : undefined;
        const wf = await store.create({ hooks: [], ...data, ...(by != null ? { created_by: by } : {}) } as never, s);
        return json(201, withIssues(wf));
      }
      const wf = await store.update(id!, data, s);
      return wf ? json(200, withIssues(wf)) : fail(404, 'NOT_FOUND', 'Workflow not found');
    } catch (error) {
      if (onError) onError(error);
      else console.error('vise-workflow-engine: request failed', error);
      return fail(500, 'INTERNAL', 'Internal error');
    }
  }

  return Object.assign(handle, { GET: handle, POST: handle, PUT: handle, PATCH: handle, DELETE: handle });
}

// ─── Node / Express adapter ───────────────────────────────────────────────────

export interface NodeContext {
  req: IncomingMessage & { body?: unknown };
  res: ServerResponse;
}

/**
 * Adapts a fetch handler to Node's (req, res) — works with Express, Connect,
 * Fastify's raw mode and plain http.createServer. Mount it under a prefix:
 *
 *   app.use('/api/workflows', toNodeHandler(handler))
 *
 * Reads the body itself, or uses req.body if express.json() already parsed it.
 */
export function toNodeHandler<C extends NodeContext = NodeContext>(handler: (request: Request, ctx: C) => Promise<Response>) {
  return async (req: NodeContext['req'], res: ServerResponse, next?: (err?: unknown) => void) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      let body: string | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        if (req.body !== undefined) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        else {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          body = Buffer.concat(chunks).toString('utf8');
        }
        headers.delete('content-length');
      }
      const response = await handler(new Request(url, { method, headers, body }), { req, res } as C);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      if (next) next(err);
      else {
        res.statusCode = 500;
        res.end();
      }
    }
  };
}
