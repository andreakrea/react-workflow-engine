# Integrating vise-workflow-engine — playbook for AI coding agents

Follow this file top to bottom when asked to add workflows to an app. It is written against v2.x; every snippet type-checks against the published package. Do not use APIs from memory or from 1.x: there is no `WorkflowEngine` class, no `createWorkflowRouter`, no `/frontend` entry, no `apiUrl` prop, no `reactflow` v11.

## 0. What it is

A graph workflow engine. Admins draw a flow in a drag-and-drop editor; the app's own records (tickets, orders, requests — called **subjects**) move through it. Each **block** type in the flow is backed by an **action** in server code. **Hooks** are workflow-level side effects (audit log, notifications) at lifecycle moments.

## 1. Decide before writing code

Look at the project, then pick:

| Question | Answer → use |
|---|---|
| Frontend is React | `vise-workflow-engine/react` (`<WorkflowEditor>`) — needs `react`, `react-dom`, `@xyflow/react@12` |
| Frontend is Angular, Vue, Svelte, plain HTML | `vise-workflow-engine/element` (`<vise-workflow-editor>`) — no peer deps |
| Backend is Node with knex (Postgres, MySQL, SQLite) | `vise-workflow-engine/knex` |
| Backend uses Prisma/Drizzle/other | implement `WorkflowStore` + `SubjectStore` (§10) |
| HTTP framework | Express/Connect → `toNodeHandler`; Next.js/Hono/Bun/Deno → handler as-is with `basePath` |
| Steps that wait ("remind in 3 days") or must retry | enable **timers** (§5, §6) |
| Need an audit trail of moves | enable **history** (§5, §6) |
| UI language | `labels={itLabels}` (React) or `lang="it"` (element); default English |

Ask the user only what the code can't tell you: which entity moves through the workflow (table name), and what each block should do.

## 2. Install

```bash
npm install vise-workflow-engine
npm install knex pg                         # if using the knex adapter (pg / mysql2 / better-sqlite3)
npm install react react-dom @xyflow/react   # only for the React editor
```

Node ≥ 18. ESM and CommonJS both work; types are included.

## 3. Database

The engine owns `workflows` (and optionally `workflow_history`, `workflow_timers`). Add the bundled migrations **next to** the app's own — never replace the app's directory:

```js
// knexfile.js
const { migrationsPath } = require('vise-workflow-engine/knex');
module.exports = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: { directory: ['./migrations', migrationsPath] },
};
```

Migrations: `001` workflows, `002` history, `003` timers. If the app can't use a second directory, call `createWorkflowsTable(knex, { extend: (t) => t.integer('tenant_id') })`, `createWorkflowHistoryTable(knex)`, `createWorkflowTimersTable(knex)` from one of the app's own migrations.

The subject table needs two columns (names configurable), added in the app's own migration:

```js
exports.up = (knex) => knex.schema.alterTable('tickets', (t) => {
  t.integer('workflow_id').nullable();
  t.string('current_node_id').nullable();
});
```

For multi-tenant apps add a tenant column to `workflows` (via `extend`) and use `scope` in §5.

## 4. Shared config — `workflow.config.ts`

One file imported by **both** server and client. Import from the core entry (`vise-workflow-engine`), which is small and safe in browsers:

```ts
import { defineBlocks, defineHooks, v } from 'vise-workflow-engine';

export const blocks = defineBlocks({
  start: { kind: 'start', label: 'New ticket', color: { bg: '#dcfce7', text: '#15803d' } },
  triage: { kind: 'decision', label: 'Triage', branches: ['bot', 'human'], color: { bg: '#ffedd5', text: '#c2410c' } },
  reply: {
    kind: 'step',
    label: 'AI reply',
    variables: { tone: v.select(['formal', 'friendly'], { label: 'Tone', required: true }), maxWords: v.number({ default: 120 }) },
  },
  agent: { kind: 'step', label: 'Agent handles it' },
  wait_reply: { kind: 'step', label: 'Wait for customer', variables: { duration: v.string({ default: '3d' }) } },
  closed: { kind: 'end', label: 'Closed' },
});

export const hooks = defineHooks({
  audit: { trigger: 'on_transition', label: 'Audit log' },
  slack: { trigger: 'on_node_entry', label: 'Slack alert', config: { channel: v.string({ default: '#support' }) } },
});
```

Rules:
- Kinds: `start` (exactly one per workflow), `step`, `decision`, `end`. Decisions default to branches `['yes', 'no']`; custom ones: `branches: ['bot', 'human']` or `[{ id, label, color }]`.
- Block ids are permanent keys stored in saved workflows: never rename one that is in use.
- Variables: `v.string | v.text | v.number | v.boolean (opts)`, `v.select([...], opts)`; opts `{ label, description, placeholder, required, default }`. A default makes it required and typed non-optional.
- `color`: any CSS colour or `{ bg, text, border }`. No Tailwind classes.
- One block type = one action. Per-node differences go in `variables`, not in separate handlers keyed by node id.

## 5. Server

```ts
import express from 'express';
import knexFactory from 'knex';
import { createEngine, validateLicense } from 'vise-workflow-engine';
import { knexStores } from 'vise-workflow-engine/knex';
import { createHandler, createSubjectHandler, toNodeHandler } from 'vise-workflow-engine/server';
import { blocks, hooks } from './workflow.config';

validateLicense(process.env.WORKFLOW_ENGINE_KEY); // required with real stores; not with memory stores
const knex = knexFactory({ client: 'pg', connection: process.env.DATABASE_URL });

type Ticket = { id: number; workflowId: number | null; nodeId: string | null; subject_line: string };

export const engine = createEngine({
  ...knexStores<Ticket>(knex, {
    subjects: { table: 'tickets', columns: { nodeType: 'status' } },
    history: true, // needs migration 002
    timers: true, // needs migration 003
  }),
  blocks,
  hooks,
  actions: {
    start: () => ({ next: true }),
    triage: async ({ subject }) => ({ branch: subject.subject_line.length < 80 ? 'bot' : 'human' }),
    reply: async ({ subject, variables, tx }) => {
      // variables: { tone: 'formal' | 'friendly'; maxWords: number } — typed from the block.
      // Do the work here; write to the database through `tx` to share the move's transaction.
      void subject; void variables; void tx;
      return { next: true };
    },
    // `agent` has no action: the ticket waits there until something calls engine.move()
    wait_reply: ({ variables, input }) => (input.timer ? { next: true } : { wait: variables.duration }),
  },
  hookHandlers: {
    audit: ({ subject, from, to }) => console.log('audit', subject.id, from?.id, to?.id),
    slack: async ({ config, node }) => console.log('slack', config.channel, node?.label),
  },
});

engine.startTimers({ intervalMs: 5000 }); // or call engine.runDue() from a cron job / queue worker

const app = express();
const requireAuth: express.RequestHandler = (_req, _res, next) => next(); // the app's own auth

// Workflow definitions (what the editor loads and saves)
app.use('/api/workflows', requireAuth, toNodeHandler(createHandler({
  store: engine.workflows,
  validate: engine.validate,
  // scope: (_r, { req }) => ({ tenant_id: req.user.orgId }),       // multi-tenant
  // authorize: (_r, action, { req }) => action === 'list' || action === 'read' || req.user.isAdmin,
})));

// Moving subjects (what the app's own UI calls)
app.use('/api/tickets', requireAuth, toNodeHandler(createSubjectHandler({
  engine,
  // actor: (_r, { req }) => String(req.user.id),
  // canAccess: async (_r, id, { req }) => (await loadTicket(id))?.orgId === req.user.orgId,
})));
```

Action contract — the return value is the next move:

| Return | Effect |
|---|---|
| nothing | stay; wait for `engine.move()` (a person acts) |
| `{ next: true }` | follow the only outgoing edge |
| `{ branch: 'id' }` | decision: follow that branch (typed to the block's branches) |
| `{ to: 'nodeIdOrBlockId' }` | jump to a reachable next node |
| `{ wait: '3d' \| ms \| Date, then? }` | continue later by itself (`input.timer` is set when it fires) |

Action context: `{ subject, node, variables, workflow, input, actor, attempt, tx }`. Hook context: `{ subject, hook, config, trigger, node, from, to, workflow, input, tx }`. Per step: `on_node_exit` hooks → state saved → `on_transition` → `on_node_entry` → action. With `knexStores`, each `start`/`move`/`emit` is one transaction with the subject row locked; a throwing action rolls the move back unless the block has `retry: { attempts, delay, backoff }`.

Other frameworks: Next.js app router — in `app/api/workflows/[[...id]]/route.ts`, `export const { GET, POST, PUT, PATCH, DELETE } = createHandler({ store: engine.workflows, basePath: '/api/workflows' })`. Hono / Bun — `app.all('/api/workflows/*', (c) => handler(c.req.raw))` with `basePath` set.

## 6. Wire the app to the engine

Find where the app creates its entity and where users act on it:

```ts
import { engine } from './engine';

export async function examples(ticketId: number, workflowId: number, userId: string, text: string) {
  // when a ticket is created
  await engine.start(ticketId, workflowId, { actor: userId });
  // when a person finishes a step or makes a decision (or POST /api/tickets/:id/move)
  await engine.move(ticketId, { branch: 'human' }, { actor: userId }); // or { next: true } / { to: 'node_7' }
  // what to show next to the ticket: { node, next: [{ nodeId, label, branch, branchLabel }], status, timers }
  const view = await engine.get(ticketId);
  // on incoming messages or other events: run the matching hooks
  await engine.emit(ticketId, 'on_message', { text });
  // audit trail: [{ from, to, branch, actor, at }]
  const moves = await engine.history(ticketId);
  return { view, moves };
}
```

HTTP equivalents from `createSubjectHandler`: `GET /:id`, `GET /:id/history`, `POST /:id/start {workflowId}`, `POST /:id/move {next|branch|to}`, `POST /:id/emit {trigger, input}`. Errors are `{ error: { code, message, details } }` with 404 (not found), 409 (invalid/ambiguous move, not started, invalid workflow — `details.allowed` lists valid moves), 500 (action failed).

## 7. Frontend — React

```tsx
import { WorkflowEditor, createHttpClient, itLabels } from 'vise-workflow-engine/react';
import 'vise-workflow-engine/react/style.css';
import { blocks, hooks } from './workflow.config';

const client = createHttpClient({
  baseUrl: '/api/workflows', // exactly where createHandler is mounted — nothing is appended
  headers: () => ({ Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` }),
});

export function WorkflowSettings({ id }: { id?: number }) {
  return (
    <div style={{ height: 'calc(100dvh - 64px)' }}>
      <WorkflowEditor blocks={blocks} hooks={hooks} client={client} workflowId={id} labels={itLabels}
        onSaved={(w) => console.log('saved', w.id)} onError={(e) => console.error(e)} />
    </div>
  );
}
```

Props: `blocks`, `hooks`, `icons` (ReactNodes by block/hook id), `client` or `value`+`onChange` (controlled), `workflowId`, `onWorkflowIdChange`, `onSaved`, `onDeleted`, `onError`, `title`, `headerActions`, `labels`, `theme` (`light`|`dark`|`system`), `readOnly`, `hideAttribution`, `className`, `style`.

## 8. Frontend — Angular, Vue, plain HTML (custom element)

```ts
// Angular standalone component
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { blocks, hooks } from './workflow.config'; // config imports from 'vise-workflow-engine', NOT from /element

@Component({
  selector: 'app-workflow-settings',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <vise-workflow-editor base-url="/api/workflows" lang="it" heading="Impostazioni"
      [blocks]="blocks" [hooks]="hooks" [headers]="headers" (saved)="onSaved($event)"></vise-workflow-editor>
  `,
  styles: [`vise-workflow-editor { height: calc(100dvh - 64px); --vwe-primary: #18181b; }`],
})
export class WorkflowSettings {
  blocks = blocks;
  hooks = hooks;
  headers = () => ({ Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` });
  constructor() {
    void import('vise-workflow-engine/element'); // lazy: keeps ~110 KB out of the initial bundle
  }
  onSaved(e: Event) {
    console.log('saved', (e as CustomEvent<{ id: number }>).detail.id);
  }
}
```

Attributes: `base-url`, `workflow-id`, `lang` (`en`|`it`), `theme`, `heading`, `read-only`, `hide-attribution`. Properties: `blocks` (required), `hooks`, `headers`, `client`, `icons` (SVG markup strings from your own code), `labels`, `value`. Events (`CustomEvent.detail`): `saved`, `change` `{ draft, issues }`, `error`, `deleted`, `workflow-id-change`. Vue: `<vise-workflow-editor :blocks.prop="blocks" @saved="...">`, with the tag marked as a custom element in the Vue compiler options. Plain HTML: `<script src=".../dist/element.global.js">`, then `el.blocks = ViseWorkflowEditor.defineBlocks({...})`.

## 9. Pitfalls (each of these has bitten a real integration)

- The editor **fills its parent**: the parent (or the custom element) needs a height, or nothing shows.
- `baseUrl` / `base-url` is the **exact** mount path of `createHandler`.
- Auth goes in `headers` (the function form is read on every request); never patch `window.fetch`.
- React only: import `vise-workflow-engine/react/style.css` once. The element carries its own styles.
- Theme with `--vwe-*` variables (`--vwe-primary`, `--vwe-font`, `--vwe-radius`, …) on the editor or a parent; dark mode uses its own palette.
- Angular: `CUSTOM_ELEMENTS_SCHEMA`, lazy `import('vise-workflow-engine/element')`, read results from `event.detail`.
- License: `validateLicense` on the **server** only. The editor and `memoryStores()` need no key; tests and demos shouldn't use one.
- Timers do nothing until something calls `engine.startTimers()` or `engine.runDue()`. One worker or many — claims are locked.
- Actions can run more than once across retries: make external side effects idempotent (key them on `subject.id` + `node.id` + `attempt`).
- A decision's action must return `{ branch }`; `{ next: true }` from a node with several exits throws `AMBIGUOUS_TRANSITION`.
- Workflows with validation **errors** can be saved, but `engine.start` refuses them (`INVALID_WORKFLOW`); warnings are fine.
- Customise through props, labels, icons and CSS variables; don't fork the editor's CSS or copy its components.

## 10. Other databases

Implement two small interfaces and spread them into `createEngine` like `knexStores` does:

- `WorkflowStore`: `get(id, scope?, tx?)`, `list(scope?)`, `create(input, scope?)`, `update(id, patch, scope?)`, `remove(id, scope?)` — workflows are `{ id, name, description, nodes, edges, hooks }` with the arrays stored as JSON.
- `SubjectStore`: `get(id, tx?)` → `{ id, workflowId, nodeId, ...fields } | null` (lock the row when `tx` is given); `setState(id, { workflowId, nodeId, nodeType }, tx?)`.
- Optional: `transaction: (fn) => db.transaction((tx) => fn(tx))`, `history: HistoryStore`, `timers: TimerStore`.

Types are exported from `vise-workflow-engine`. `memoryStores()` returns in-memory versions of all four, for tests.

## 11. Verify before saying it's done

1. Type-check the app; fix every error (block ids, branches and variables are checked at compile time).
2. Open the editor page: it renders, loads and saves — the network tab shows `POST`/`PUT` to the exact base URL, with the auth header.
3. Build a workflow with a start, one step and an end, and save it. Then over HTTP or in code: `start` a subject → `GET /api/tickets/:id` shows the node and `next` → `move` → `history` lists the moves with the actor.
4. If timers are on: a `wait` step resumes after `engine.runDue({ now: future })` in a test.
5. Add at least one test with `memoryStores()` that starts and moves a subject through the app's real `actions`.
