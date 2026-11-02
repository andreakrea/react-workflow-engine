# vise-workflow-engine

A graph-based workflow engine with a drag-and-drop React editor. Admins draw the flow; your code runs the steps.

- **One config, both sides.** Define blocks once; the editor builds its palette and forms from them, the engine type-checks your handlers against them.
- **Strict, typed engine.** Typos in block ids, branches or variables are compile errors. Invalid moves throw instead of guessing.
- **Any database, any framework.** Knex adapter included (Postgres, MySQL, SQLite), or implement two small interfaces. The HTTP handler is a standard `Request → Response` function for Express, Next.js, Hono, Bun…
- **Drop-in editor.** Fills its container, styles scoped under `.vwe-root` (no Tailwind, no global reset), light/dark themes, live validation, auth headers, callbacks instead of popups.

**[▶ Live demo](https://andreakrea.github.io/react-workflow-engine/)**

```bash
npm install vise-workflow-engine
npm install knex pg                      # server, if you use the knex adapter
npm install react react-dom reactflow@11 # editor
```

## Quick start — three files

### 1. `workflow.config.ts` (imported by server and client)

```ts
import { defineBlocks, defineHooks, v } from 'vise-workflow-engine';

export const blocks = defineBlocks({
  start:   { kind: 'start', label: 'New ticket', icon: '🟢', color: '#dcfce7' },
  triage:  { kind: 'decision', label: 'Triage', icon: '🔀', color: '#ffedd5', branches: ['bot', 'human'] },
  reply:   { kind: 'step', label: 'AI reply', icon: '🤖', color: '#cffafe',
             variables: { tone: v.select(['formal', 'friendly'], { required: true }), maxWords: v.number({ default: 120 }) } },
  agent:   { kind: 'step', label: 'Agent handles it', icon: '👤', color: '#dbeafe' },
  closed:  { kind: 'end', label: 'Closed', icon: '✅', color: '#d1fae5' },
});

export const hooks = defineHooks({
  slack: { trigger: 'on_node_entry', label: 'Slack alert', icon: '💬', config: { channel: v.string({ default: '#support' }) } },
});
```

Block kinds: `start` (one per workflow), `step`, `decision` (one output per branch; default `['yes', 'no']`), `end`.

### 2. Server

```ts
import express from 'express';
import knexFactory from 'knex';
import { createEngine, validateLicense } from 'vise-workflow-engine';
import { knexStores } from 'vise-workflow-engine/knex';
import { createHandler, toNodeHandler } from 'vise-workflow-engine/server';
import { blocks, hooks } from './workflow.config';

validateLicense(process.env.WORKFLOW_ENGINE_KEY);
const knex = knexFactory({ client: 'pg', connection: process.env.DATABASE_URL });

export const engine = createEngine({
  ...knexStores(knex, { subjects: { table: 'tickets', columns: { nodeType: 'status' } } }),
  blocks,
  hooks,
  actions: {
    start: () => ({ next: true }),
    triage: async ({ subject }) => ({ branch: (await isSimple(subject)) ? 'bot' : 'human' }),
    reply: async ({ subject, variables }) => {          // variables: { tone: 'formal' | 'friendly'; maxWords: number }
      await sendAiReply(subject.id, variables);
      return { next: true };
    },
    // 'agent' has no action: the ticket waits there until you call engine.move()
  },
  hookHandlers: {
    slack: ({ subject, config, node }) => slack.post(config.channel, `#${subject.id} → ${node?.label}`),
  },
});

const app = express();
app.use('/api/workflows', requireAuth, toNodeHandler(createHandler({
  store: engine.workflows,
  validate: engine.validate,
  scope: (_req, { req }) => ({ tenant_id: req.user.orgId }),        // optional multi-tenancy
  authorize: (_req, action, { req }) => action === 'list' || action === 'read' || req.user.isAdmin,
})));

app.post('/api/tickets/:id/start', async (req, res) => res.json(await engine.start(req.params.id, req.body.workflowId)));
app.post('/api/tickets/:id/move', async (req, res) => res.json(await engine.move(req.params.id, req.body)));
```

### 3. Client

```tsx
import { WorkflowEditor, createHttpClient } from 'vise-workflow-engine/react';
import 'vise-workflow-engine/react/style.css';
import { blocks, hooks } from './workflow.config';

const client = createHttpClient({
  baseUrl: '/api/workflows',
  headers: () => ({ Authorization: `Bearer ${getToken()}` }),
});

export function WorkflowSettings({ id }: { id?: number }) {
  return (
    <div style={{ height: 640 }}>
      <WorkflowEditor blocks={blocks} hooks={hooks} client={client} workflowId={id}
        onSaved={(w) => toast.success(`Saved ${w.name}`)} onError={(e) => toast.error(String(e))} />
    </div>
  );
}
```

That's the whole integration.

---

## Engine

### Moving subjects

```ts
await engine.start(ticketId, workflowId, { input });   // enters the start node
await engine.move(ticketId, { next: true });           // the only outgoing edge
await engine.move(ticketId, { branch: 'human' });      // a decision branch (true/false = yes/no)
await engine.move(ticketId, { to: 'node_7' });         // a reachable node, by id or block id
await engine.move(ticketId, { to: 'closed', force: true }); // admin override: any node

await engine.next(ticketId);   // [{ nodeId, type, label, branch, branchLabel }]
await engine.can(ticketId, { branch: 'bot' });
await engine.emit(ticketId, 'on_message', { text });   // run hooks for any trigger
```

`start` and `move` return `{ subject, node, path, status }` — `path` lists every node entered (more than one when actions auto-advance), `status` is `'waiting'` or `'completed'`.

### Actions

An action runs when a subject enters a node of its block. Its return value decides what happens next:

| Return | Effect |
|---|---|
| nothing | stay and wait for `engine.move()` (human step) |
| `{ next: true }` | follow the only outgoing edge |
| `{ branch: 'id' }` | decision: follow that branch (typed to the block's branches) |
| `{ to: 'nodeOrBlockId' }` | go to a specific next node |

Context: `{ subject, node, variables, workflow, input, tx }`. `variables` holds this node's values from the editor, typed from the block's `variables`.

### Order of events per step

`on_node_exit` hooks → state saved → `on_transition` hooks → `on_node_entry` hooks → action → (next step if the action returned a move). `start` runs the same sequence for the start node. Auto-advance stops after `maxSteps` (default 100).

### Errors

All engine errors are `WorkflowError` with a `code`: `SUBJECT_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `NO_WORKFLOW`, `NODE_NOT_FOUND`, `INVALID_TRANSITION`, `AMBIGUOUS_TRANSITION`, `INVALID_WORKFLOW`, `ACTION_FAILED` (with `cause`), `MAX_STEPS`. Use `isWorkflowError(e)`.

Hook failures never abort a move: they're logged and emitted as `hookError`.

### Transactions

With `knexStores` every `start` / `move` / `emit` runs in one transaction and the subject row is locked (`SELECT … FOR UPDATE` on Postgres/MySQL), so concurrent moves on the same subject are serialised and a failing action rolls the move back. Your handlers get the transaction as `tx` — write through it to be part of the same commit. Pass `transaction: false` to opt out.

### Where is it, and how did it get there?

```ts
await engine.get(ticketId);
// { subject, node: { id, type, label } | null, next: [...], status: 'not_started' | 'waiting' | 'completed' }

await engine.start(ticketId, workflowId, { actor: user.id });   // actor is stored in history and passed to handlers
await engine.history(ticketId);   // [{ from, to, branch, actor, at }, ...] oldest first
```

History needs a store: `knexStores(knex, { subjects, history: true })` (table from migration 002 or `createWorkflowHistoryTable(knex)`), or `memoryHistoryStore()`. It is written in the same transaction as the move. Automatic steps (actions that return a move) are recorded with `actor: null`.

### Events

```ts
engine.on('transitioned', ({ subjectId, from, to, branch }) => audit.log(...));
engine.on('completed', ({ subjectId, nodeId }) => ...);
engine.on('actionError' | 'hookError' | 'hookExecuted', ...);
```

### Validation

`engine.validate(workflow)` / `validateWorkflow(workflow, { blocks, hooks })` returns issues (`error` | `warning`): missing start, unknown blocks, unknown or missing branches, missing required variables, unreachable nodes, dead ends, dangling edges, unknown hooks. The editor shows them live; the HTTP handler returns them with every workflow; `engine.start` refuses workflows with errors. Drafts with errors can still be saved.

---

## Storage

### Knex (`vise-workflow-engine/knex`)

```ts
knexStores(knex, {
  workflows: { table: 'workflows' },                 // optional
  subjects: {
    table: 'tickets',
    columns: { id: 'id', workflowId: 'workflow_id', nodeId: 'current_node_id', nodeType: 'status', updatedAt: 'updated_at' },
    map: (row) => ({ ...row, id: row.id, workflowId: row.workflow_id, nodeId: row.current_node_id }), // optional
  },
});
```

Schema — either add the bundled migration next to yours:

```js
// knexfile.js
const { migrationsPath } = require('vise-workflow-engine/knex');
module.exports = { client: 'pg', connection: process.env.DATABASE_URL, migrations: { directory: ['./migrations', migrationsPath] } };
```

…or call `createWorkflowsTable(knex, { extend: (t) => t.integer('tenant_id') })` from one of your own migrations. Your subject table needs `workflow_id` and `current_node_id` columns (names configurable).

### Anything else

Implement two interfaces (both are small):

```ts
interface WorkflowStore { get(id, scope?, tx?); list(scope?); create(input, scope?); update(id, patch, scope?); remove(id, scope?) }
interface SubjectStore  { get(id, tx?); setState(id, { workflowId, nodeId, nodeType }, tx?) }
```

…plus an optional `transaction: (fn) => Promise` runner. `memoryStores()` is included for tests and prototypes.

## HTTP handler (`vise-workflow-engine/server`)

| Request | Response |
|---|---|
| `GET /` | `{ workflows }` |
| `GET /:id` | `{ workflow, issues }` |
| `POST /` | `201 { workflow, issues }` — body `{ name, nodes, edges, hooks?, description? }` |
| `PUT /:id` (or `PATCH`) | `{ workflow, issues }` — any subset |
| `DELETE /:id` | `204` |
| errors | `{ error: { code, message, details? } }` with 400 / 403 / 404 / 405 / 500 |

Options: `store` (required), `validate`, `scope(req, ctx)`, `authorize(req, action, ctx)`, `createdBy(req, ctx)`, `basePath`, `onError`. Internal error messages are never sent to clients; `created_by` is never read from the body.

### Subjects: start, move, read, history

`createSubjectHandler({ engine })` gives your app the routes that drive tickets, so you don't write them by hand:

| Request | Response |
|---|---|
| `GET /:id` | `{ subject, node, next, status }` |
| `GET /:id/history?limit=` | `{ history }` |
| `POST /:id/start` | body `{ workflowId, input? }` → `{ subject, node, path, status }` |
| `POST /:id/move` | body `{ next: true }` \| `{ branch }` \| `{ to, force? }`, plus `input?` |
| `POST /:id/emit` | body `{ trigger, input? }` → `{ fired, failed }` |

Engine errors map to statuses: not found → 404; invalid or ambiguous moves, unstarted subjects, invalid workflows → 409 with `details.allowed`; failed actions → 500. Options: `authorize(req, action, ctx)` (actions `read`, `history`, `start`, `move`, `emit`, and `force` — forced moves are refused unless this allows them), `actor(req, ctx)`, `canAccess(req, subjectId, ctx)` (return false → 404, e.g. other tenants), `basePath`, `onError`.

```ts
app.use('/api/tickets', requireAuth, toNodeHandler(createSubjectHandler({
  engine,
  actor: (_r, { req }) => req.user.id,
  canAccess: async (_r, id, { req }) => (await db.tickets.find(id))?.orgId === req.user.orgId,
})));
```

```ts
// Express / Connect / node:http — mounted under a prefix
app.use('/api/workflows', toNodeHandler(handler));      // ctx = { req, res }

// Next.js app router: app/api/workflows/[[...id]]/route.ts
const handler = createHandler({ store, basePath: '/api/workflows' });
export const { GET, POST, PUT, PATCH, DELETE } = handler;

// Hono / Bun / Deno — full URLs, so set basePath: '/api/workflows' here too
app.all('/api/workflows/*', (c) => handler(c.req.raw));
```

## Editor (`vise-workflow-engine/react`)

| Prop | |
|---|---|
| `blocks`, `hooks` | your definitions |
| `client` | `createHttpClient({ baseUrl, headers?, fetch?, credentials? })`, `createLocalClient()` (localStorage), or your own `WorkflowClient` |
| `workflowId`, `onWorkflowIdChange` | which workflow is open |
| `value`, `onChange(draft, issues)` | controlled mode — keep the draft in your own state, no client needed |
| `onSaved`, `onDeleted`, `onError` | callbacks (no `alert()`s) |
| `title`, `headerActions` | breadcrumb before the workflow name; extra header buttons |
| `icons` | icons by block or hook id, e.g. `{ send_email: <MailIcon /> }` — otherwise the definition's `icon` string, then the label's initial |
| `theme` | `'light'` (default), `'dark'`, or `'system'` |
| `readOnly`, `className`, `style` | |

The editor fills its parent — give the parent a height. It follows a quiet console look (white cards, zinc neutrals, black primary button); block colours appear only in each block's icon chip. Retheme it with CSS variables:

```css
.vwe-root {
  --vwe-primary: #0f766e;        /* main button, switches, focus */
  --vwe-focus: #0f766e;
  --vwe-font: inherit;           /* use the host app's font */
  --vwe-radius: 4px;
}
```

All variables are listed at the top of `vise-workflow-engine/react/style.css` (`--vwe-surface`, `--vwe-canvas`, `--vwe-border`, `--vwe-text`, `--vwe-muted`, …).

Hooks live in the sidebar's **Hooks** tab (enable, scope to nodes, settings); blocks in the **Blocks** tab, searchable and grouped by kind. On phones both open as bottom sheets.

Click a block to add it below the selected node (and connect it), or drag it anywhere. Shortcuts: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` redo, `Ctrl/Cmd+S` save, `Delete` removes the selection.

---

## License key

Production use needs a key: call `validateLicense(key)` once at startup on the server, or pass `licenseKey` to `createEngine` / `createHandler`. Keys are Ed25519-signed (`vwe2.…`); the package only contains the public key.

No key is needed for the editor, or for the engine and handler with in-memory stores (`memoryStores()`, `createLocalClient()`), so tests, demos and prototypes work out of the box. Keys issued for 1.x still work and log a warning; they stop working in 3.0, so ask for a new one.

## Upgrading from 1.x

Stored data is compatible: same `workflows` table and migration name, and workflows saved by the 1.x editor (including `true`/`false` decision handles and `className` labels) load and run unchanged. The API changed:

| 1.x | 2.x |
|---|---|
| `new WorkflowEngine({ knex, subjectRepo })` | `createEngine({ ...knexStores(knex, { subjects: { table } }), blocks })` |
| `engine.registerAction(type, (subject, ctx) => ({ success, autoProgress, decision }))` | `actions: { [type]: (ctx) => ({ next: true } \| { branch } \| undefined) }` |
| `engine.registerHook` / `WorkflowHooksDispatcher` | `hookHandlers: { [type]: (ctx) => … }` |
| `engine.initializeSubject(id, wf)` | `engine.start(id, wf)` |
| `engine.transition(id, nodeOrType)` | `engine.move(id, { to })` |
| `engine.transitionByDecision(id, bool)` | `engine.move(id, { branch })` |
| `engine.getAvailableTransitions(id)` | `engine.next(id)` |
| `engine.executeHooks(id, trigger, ctx)` | `engine.emit(id, trigger, input)` |
| `createWorkflowRouter({ knex, authMiddleware })` | `app.use(path, auth, toNodeHandler(createHandler({ store })))` |
| `require('vise-workflow-engine').migrationsPath` | `require('vise-workflow-engine/knex').migrationsPath` |
| `import { WorkflowEditor } from 'vise-workflow-engine/frontend'` + `apiUrl` | `from 'vise-workflow-engine/react'` + `client={createHttpClient({ baseUrl })}` |
| `blockTypes` / `hookTypes` arrays with Tailwind `color` classes | `blocks` / `hooks` objects with CSS colours |

`<WorkflowEditor licenseKey>` is gone: the editor needs no key. Behaviour changes: unknown decisions throw instead of following the first edge; moving "by type" only considers reachable nodes; `start` fires `on_node_entry` hooks like any other entry.

## Development

```bash
npm install
npm test            # vitest: engine, knex (SQLite), HTTP handler
npm run typecheck
npm run build       # dist/ via tsup
npm run dev:demo    # demo on the local source
```

## License

MIT
