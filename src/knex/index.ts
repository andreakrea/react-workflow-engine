import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';
import type {
  Scope,
  Subject,
  SubjectStore,
  TransactionRunner,
  Workflow,
  WorkflowId,
  WorkflowInput,
  WorkflowPatch,
  WorkflowStore,
} from '../core/types';

const parse = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

const db = (knex: Knex, tx: unknown) => (tx as Knex.Transaction | undefined) ?? knex;

// ─── Workflows ────────────────────────────────────────────────────────────────

export interface KnexWorkflowStoreOptions {
  /** Table name. Default 'workflows' (the bundled migration's table). */
  table?: string;
  /** Type of the id column. Non-numeric ids are treated as "not found" for 'integer'. Default 'integer'. */
  idType?: 'integer' | 'string';
}

/** Workflow definitions in the `workflows` table (same schema as 1.x). */
export function knexWorkflowStore(knex: Knex, opts: KnexWorkflowStoreOptions = {}): WorkflowStore {
  const table = opts.table ?? 'workflows';
  const validId = (id: WorkflowId) => opts.idType === 'string' || /^\d+$/.test(String(id));
  const toWorkflow = (row: Record<string, any>): Workflow => ({
    ...row,
    id: row.id,
    name: row.name,
    nodes: parse(row.nodes, []),
    edges: parse(row.edges, []),
    hooks: parse(row.hooks, []),
  });

  const get = async (id: WorkflowId, scope?: Scope, tx?: unknown) => {
    if (!validId(id)) return null;
    const row = await db(knex, tx)(table).where({ ...scope, id }).first();
    return row ? toWorkflow(row) : null;
  };

  return {
    get,
    async list(scope) {
      const rows = await knex(table).where({ ...scope }).orderBy('created_at', 'desc');
      return rows.map(toWorkflow);
    },
    async create(input: WorkflowInput, scope) {
      const [res] = await knex(table)
        .insert({
          name: input.name,
          description: input.description ?? null,
          nodes: JSON.stringify(input.nodes ?? []),
          edges: JSON.stringify(input.edges ?? []),
          hooks: JSON.stringify(input.hooks ?? []),
          created_by: (input.created_by as string | undefined) ?? null,
          ...scope,
        })
        .returning('id');
      const id = typeof res === 'object' && res !== null ? (res as { id: WorkflowId }).id : (res as WorkflowId);
      return (await get(id, scope))!;
    },
    async update(id, patch: WorkflowPatch, scope) {
      if (!validId(id)) return null;
      const row: Record<string, unknown> = { updated_at: knex.fn.now() };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description;
      for (const key of ['nodes', 'edges', 'hooks'] as const) {
        if (patch[key] !== undefined) row[key] = JSON.stringify(patch[key]);
      }
      const count = await knex(table).where({ ...scope, id }).update(row);
      return count ? get(id, scope) : null;
    },
    async remove(id, scope) {
      if (!validId(id)) return false;
      return (await knex(table).where({ ...scope, id }).del()) > 0;
    },
  };
}

// ─── Subjects ─────────────────────────────────────────────────────────────────

export interface KnexSubjectStoreOptions<S extends Subject> {
  /** Your entity table, e.g. 'tickets'. */
  table: string;
  columns?: {
    /** Default 'id'. */
    id?: string;
    /** Default 'workflow_id'. */
    workflowId?: string;
    /** Default 'current_node_id'. */
    nodeId?: string;
    /** Column that receives the current block id (e.g. 'status'). Default none. */
    nodeType?: string;
    /** Timestamp column touched on every move. Default none. */
    updatedAt?: string;
  };
  /** Customise how a row becomes the subject passed to your handlers. */
  map?: (row: Record<string, any>) => S;
}

/**
 * Reads and writes workflow position on your own entity table. Inside a
 * transaction the row is locked (SELECT … FOR UPDATE) so concurrent moves on
 * the same subject are serialised.
 */
export function knexSubjectStore<S extends Subject = Subject>(knex: Knex, opts: KnexSubjectStoreOptions<S>): SubjectStore<S> {
  const c = { id: 'id', workflowId: 'workflow_id', nodeId: 'current_node_id', ...opts.columns };
  const client = String(knex.client?.config?.client ?? '');
  const canLock = !/sqlite/.test(client);
  const map = opts.map ?? ((row) => ({ ...row, id: row[c.id], workflowId: row[c.workflowId] ?? null, nodeId: row[c.nodeId] ?? null }) as S);

  return {
    async get(id, tx) {
      let q = db(knex, tx)(opts.table).where(c.id, id).first();
      if (tx && canLock) q = q.forUpdate();
      const row = await q;
      return row ? map(row) : null;
    },
    async setState(id, state, tx) {
      const row: Record<string, unknown> = { [c.workflowId]: state.workflowId, [c.nodeId]: state.nodeId };
      if (c.nodeType) row[c.nodeType] = state.nodeType;
      if (c.updatedAt) row[c.updatedAt] = knex.fn.now();
      const count = await db(knex, tx)(opts.table).where(c.id, id).update(row);
      if (!count) throw new Error(`knexSubjectStore: no row in ${opts.table} with ${c.id} = ${id}`);
    },
  };
}

export function knexTransaction(knex: Knex): TransactionRunner {
  return (fn) => knex.transaction((trx) => fn(trx));
}

/**
 * Everything createEngine needs, in one call:
 *
 *   createEngine({ ...knexStores(knex, { subjects: { table: 'tickets' } }), blocks, actions })
 */
export function knexStores<S extends Subject = Subject>(
  knex: Knex,
  opts: { workflows?: KnexWorkflowStoreOptions; subjects: KnexSubjectStoreOptions<S>; transaction?: boolean },
): { workflows: WorkflowStore; subjects: SubjectStore<S>; transaction?: TransactionRunner } {
  return {
    workflows: knexWorkflowStore(knex, opts.workflows),
    subjects: knexSubjectStore<S>(knex, opts.subjects),
    transaction: opts.transaction === false ? undefined : knexTransaction(knex),
  };
}

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Directory holding the bundled migration. Add it next to your own:
 *   migrations: { directory: ['./migrations', migrationsPath] }
 */
export const migrationsPath = path.join(
  typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

/** Creates the workflows table — call it from one of your own migrations instead of using migrationsPath. */
export async function createWorkflowsTable(knex: Knex, opts: { table?: string; extend?: (t: Knex.CreateTableBuilder) => void } = {}) {
  await knex.schema.createTable(opts.table ?? 'workflows', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.text('description');
    t.jsonb('nodes').notNullable().defaultTo('[]');
    t.jsonb('edges').notNullable().defaultTo('[]');
    t.jsonb('hooks').notNullable().defaultTo('[]');
    t.string('created_by');
    t.timestamps(true, true);
    opts.extend?.(t);
  });
}
