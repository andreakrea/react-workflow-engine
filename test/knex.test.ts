import knexFactory, { type Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEngine, defineBlocks, validateLicense, type WorkflowInput } from '../src';
import { createWorkflowsTable, knexStores, migrationsPath } from '../src/knex';
import { DEMO_KEY } from './helpers';

let knex: Knex;

const blocks = defineBlocks({
  start: { kind: 'start', label: 'Start' },
  triage: { kind: 'decision', label: 'Triage', branches: ['bot', 'human'] },
  bot: { kind: 'step', label: 'Bot' },
  human: { kind: 'step', label: 'Human' },
  closed: { kind: 'end', label: 'Closed' },
});

const n = (id: string, type: string) => ({ id, position: { x: 0, y: 0 }, data: { type } });
const flow: WorkflowInput = {
  name: 'Support',
  nodes: [n('a', 'start'), n('b', 'triage'), n('c', 'bot'), n('d', 'human'), n('e', 'closed')],
  edges: [
    { id: '1', source: 'a', target: 'b' },
    { id: '2', source: 'b', target: 'c', sourceHandle: 'bot' },
    { id: '3', source: 'b', target: 'd', sourceHandle: 'human' },
    { id: '4', source: 'c', target: 'e' },
    { id: '5', source: 'd', target: 'e' },
  ],
  hooks: [],
};

beforeAll(async () => {
  validateLicense(DEMO_KEY);
  knex = knexFactory({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await createWorkflowsTable(knex, { extend: (t) => t.integer('tenant_id') });
  await knex.schema.createTable('tickets', (t) => {
    t.increments('id');
    t.string('subject_line');
    t.integer('priority');
    t.integer('workflow_id');
    t.string('current_node_id');
    t.string('status');
  });
});

afterAll(() => knex.destroy());

describe('knex adapter', () => {
  it('stores workflows with tenant scoping', async () => {
    const { workflows } = knexStores(knex, { subjects: { table: 'tickets' } });
    const a = await workflows.create(flow, { tenant_id: 1 });
    await workflows.create({ ...flow, name: 'Other tenant' }, { tenant_id: 2 });
    expect(a).toMatchObject({ name: 'Support', tenant_id: 1, nodes: flow.nodes });
    expect((await workflows.list({ tenant_id: 1 })).map((w) => w.name)).toEqual(['Support']);
    expect(await workflows.get(a.id, { tenant_id: 2 })).toBeNull();
    expect(await workflows.update(a.id, { name: 'Nope' }, { tenant_id: 2 })).toBeNull();
    expect((await workflows.update(a.id, { name: 'Support v2' }, { tenant_id: 1 }))?.name).toBe('Support v2');
    expect(await workflows.remove(a.id, { tenant_id: 2 })).toBe(false);
  });

  it('runs the engine against a real table, in a transaction', async () => {
    const stores = knexStores<{ id: number; workflowId: number | null; nodeId: string | null; priority: number }>(knex, {
      subjects: { table: 'tickets', columns: { nodeType: 'status' } },
    });
    const wf = await stores.workflows.create(flow);
    const [{ id: low }] = await knex('tickets').insert({ subject_line: 'printer', priority: 1 }).returning('id');
    const [{ id: high }] = await knex('tickets').insert({ subject_line: 'outage', priority: 9 }).returning('id');

    const engine = createEngine({
      ...stores,
      blocks,
      logger: {},
      actions: {
        start: () => ({ next: true }),
        triage: ({ subject }) => ({ branch: subject.priority > 5 ? 'human' : 'bot' }),
        bot: () => ({ next: true }),
      },
    });

    expect(await engine.start(low, wf.id)).toMatchObject({ status: 'completed', path: ['a', 'b', 'c', 'e'] });
    expect(await engine.start(high, wf.id)).toMatchObject({ status: 'waiting', node: { id: 'd', type: 'human' } });
    expect(await knex('tickets').where({ id: high }).first()).toMatchObject({ workflow_id: wf.id, current_node_id: 'd', status: 'human' });
  });

  it('rolls back state when an action fails inside the transaction', async () => {
    const stores = knexStores(knex, { subjects: { table: 'tickets', columns: { nodeType: 'status' } } });
    const wf = await stores.workflows.create(flow);
    const [{ id }] = await knex('tickets').insert({ subject_line: 'x', priority: 1 }).returning('id');
    const engine = createEngine({
      ...stores,
      blocks,
      logger: {},
      actions: { start: () => ({ next: true }), triage: () => { throw new Error('model timeout'); } },
    });
    await expect(engine.start(id, wf.id)).rejects.toMatchObject({ code: 'ACTION_FAILED' });
    expect(await knex('tickets').where({ id }).first()).toMatchObject({ workflow_id: null, current_node_id: null });
  });

  it('exposes the bundled 1.x migration directory', () => {
    expect(migrationsPath.replace(/\\/g, '/')).toMatch(/\/migrations$/);
  });
});
