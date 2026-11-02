import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine, defineBlocks, memoryStores, validateLicense } from '../src';
import { createHandler, toNodeHandler } from '../src/server';
import { DEMO_KEY } from './helpers';

beforeAll(() => validateLicense(DEMO_KEY));

const blocks = defineBlocks({
  start: { kind: 'start', label: 'Start' },
  done: { kind: 'end', label: 'Done' },
});
const body = {
  name: 'Flow',
  nodes: [
    { id: 'a', position: { x: 0, y: 0 }, data: { type: 'start' } },
    { id: 'b', position: { x: 0, y: 0 }, data: { type: 'done' } },
  ],
  edges: [{ id: 'e', source: 'a', target: 'b' }],
};

function setup() {
  const engine = createEngine({ ...memoryStores(), blocks, logger: {} });
  const handler = createHandler<{ user: { org: number; role: string } }>({
    store: engine.workflows,
    validate: engine.validate,
    basePath: '/api/workflows',
    scope: (_req, ctx) => ({ tenant_id: ctx.user.org }),
    authorize: (_req, action, ctx) => action === 'list' || action === 'read' || ctx.user.role === 'admin',
    createdBy: (_req, ctx) => `org-${ctx.user.org}`,
    onError: () => {},
  });
  const call = (method: string, path: string, user = { org: 1, role: 'admin' }, payload?: unknown) =>
    handler(
      new Request(`http://x/api/workflows${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload),
      }),
      { user },
    );
  return { call };
}

describe('createHandler', () => {
  it('does CRUD scoped to the tenant, with validation issues attached', async () => {
    const { call } = setup();
    const created = await call('POST', '', undefined, { ...body, created_by: 'spoofed', id: 999 });
    expect(created.status).toBe(201);
    const { workflow, issues } = await created.json();
    expect(workflow).toMatchObject({ name: 'Flow', tenant_id: 1, created_by: 'org-1' });
    expect(workflow.id).not.toBe(999);
    expect(issues).toEqual([]);

    expect((await (await call('GET', '')).json()).workflows).toHaveLength(1);
    expect((await (await call('GET', '', { org: 2, role: 'admin' })).json()).workflows).toHaveLength(0);
    expect((await call('GET', `/${workflow.id}`, { org: 2, role: 'admin' })).status).toBe(404);

    const updated = await call('PUT', `/${workflow.id}`, undefined, { nodes: [body.nodes[1]] });
    expect((await updated.json()).issues.map((i: { code: string }) => i.code)).toContain('NO_START');

    expect((await call('DELETE', `/${workflow.id}`, { org: 1, role: 'viewer' })).status).toBe(403);
    expect((await call('DELETE', `/${workflow.id}`)).status).toBe(204);
    expect((await call('GET', `/${workflow.id}`)).status).toBe(404);
  });

  it('rejects malformed bodies with 400 and unknown routes with 404/405', async () => {
    const { call } = setup();
    const bad = await call('POST', '', undefined, { name: '', nodes: 'x' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('INVALID_BODY');
    expect((await call('POST', '', undefined, '{not json')).status).toBe(400);
    expect((await call('GET', '/1/extra')).status).toBe(404);
    expect((await call('POST', '/1', undefined, body)).status).toBe(405);
  });

  it('never leaks internal error messages', async () => {
    const handler = createHandler({
      store: { list: async () => { throw new Error('password=hunter2'); } } as never,
      onError: () => {},
    });
    const res = await handler(new Request('http://x/'));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('hunter2');
  });
});

describe('toNodeHandler', () => {
  let server: Server;
  let url: string;
  beforeAll(async () => {
    const engine = createEngine({ ...memoryStores(), blocks, logger: {} });
    const node = toNodeHandler(createHandler({ store: engine.workflows }));
    server = createServer((req, res) => {
      // Simulates Express: app.use('/api/workflows', …) strips the prefix; express.json() sets req.body.
      if (req.url?.startsWith('/api/workflows')) {
        req.url = req.url.slice('/api/workflows'.length) || '/';
        if (req.headers['x-preparsed']) {
          let raw = '';
          req.on('data', (c) => (raw += c));
          req.on('end', () => {
            (req as typeof req & { body: unknown }).body = JSON.parse(raw);
            void node(req, res);
          });
          return;
        }
        return void node(req, res);
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workflows`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('works mounted under a prefix, with raw or pre-parsed bodies', async () => {
    const raw = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(raw.status).toBe(201);
    const parsed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-preparsed': '1' }, body: JSON.stringify({ ...body, name: 'Two' }) });
    expect(parsed.status).toBe(201);
    const list = await (await fetch(url)).json();
    expect(list.workflows.map((w: { name: string }) => w.name).sort()).toEqual(['Flow', 'Two']);
  });
});
