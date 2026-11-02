# vise-workflow-engine — notes for coding agents

Package: `vise-workflow-engine` (v2). Entry points: `vise-workflow-engine` (core, isomorphic), `/knex`, `/server`, `/react`, `/react/style.css`. There is no `/frontend` entry, no `WorkflowEngine` class, no `createWorkflowRouter` — those were 1.x.

## Integration = 3 files

1. **`workflow.config.ts`**, imported by server and client:
```ts
import { defineBlocks, defineHooks, v } from 'vise-workflow-engine';
export const blocks = defineBlocks({
  start: { kind: 'start', label: 'Start', color: '#dcfce7' },
  review: { kind: 'step', label: 'Review' },                                   // no action → waits for engine.move()
  notify: { kind: 'step', label: 'Notify', variables: { to: v.string({ required: true }) } },
  approve: { kind: 'decision', label: 'Approve?', branches: ['yes', 'no'] },   // default branches are yes/no
  done: { kind: 'end', label: 'Done' },
});
export const hooks = defineHooks({ audit: { trigger: 'on_transition', label: 'Audit' } });
```
Kinds: `start | step | decision | end`. Variables: `v.string|text|number|boolean(opts)`, `v.select([...], opts)`; opts `{ label, description, placeholder, required, default }` (a default makes it required).

2. **Server**:
```ts
import { createEngine, validateLicense } from 'vise-workflow-engine';
import { knexStores } from 'vise-workflow-engine/knex';
import { createHandler, toNodeHandler } from 'vise-workflow-engine/server';
validateLicense(process.env.WORKFLOW_ENGINE_KEY);
const engine = createEngine({
  ...knexStores(knex, { subjects: { table: 'tickets', columns: { nodeType: 'status' } } }),
  blocks, hooks,
  actions: {
    start: () => ({ next: true }),
    notify: async ({ subject, variables, tx }) => { await send(variables.to); return { next: true }; },
    approve: ({ subject }) => ({ branch: subject.amount < 500 ? 'yes' : 'no' }),
  },
  hookHandlers: { audit: ({ subject, from, to }) => log(subject.id, from?.id, to?.id) },
});
app.use('/api/workflows', auth, toNodeHandler(createHandler({ store: engine.workflows, validate: engine.validate, scope: (_r, { req }) => ({ tenant_id: req.user.orgId }) })));
```

3. **Client**:
```tsx
import { WorkflowEditor, createHttpClient } from 'vise-workflow-engine/react';
import 'vise-workflow-engine/react/style.css';
const client = createHttpClient({ baseUrl: '/api/workflows', headers: () => ({ Authorization: `Bearer ${token}` }) });
<div style={{ height: 600 }}><WorkflowEditor blocks={blocks} hooks={hooks} client={client} workflowId={id} onSaved={...} onError={...} /></div>
```
`baseUrl` is the exact mount path (nothing appended). The editor fills its parent; the parent needs a height. Controlled alternative: `value` + `onChange(draft, issues)` without `client`.

## Engine API

- `engine.start(subjectId, workflowId, { input? })` → `{ subject, node, path, status: 'waiting' | 'completed' }`
- `engine.move(subjectId, { next: true } | { branch } | { to, force? }, { input? })` — same result
- `engine.next(subjectId)` → `[{ nodeId, type, label, branch, branchLabel }]`; `engine.can(subjectId, move)`
- `engine.emit(subjectId, trigger, input)` — runs hooks for e.g. `'on_message'`
- `engine.on('transitioned' | 'completed' | 'actionError' | 'hookError' | 'hookExecuted', fn)`
- `engine.validate(workflow)` → `ValidationIssue[]`
- `engine.get(subjectId)` → `{ subject, node, next, status }`; `engine.history(subjectId)` → moves `{ from, to, branch, actor, at }` (needs `history: true` in knexStores + migration 002)
- MoveOptions: `{ input?, actor? }`

Action context: `{ subject, node, variables, workflow, input, tx }`. Return nothing (wait), `{ next: true }`, `{ branch }`, or `{ to }`. Hook context: `{ subject, hook, config, trigger, node, from, to, workflow, input, tx }`.

Per step: `on_node_exit` → persist → `on_transition` → `on_node_entry` → action. Errors are `WorkflowError` with `code` (`INVALID_TRANSITION`, `AMBIGUOUS_TRANSITION`, `ACTION_FAILED`, `MAX_STEPS`, `NO_WORKFLOW`, `SUBJECT_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `INVALID_WORKFLOW`); check with `isWorkflowError`. With knexStores each call is one transaction with the subject row locked.

## Subject routes

`app.use('/api/tickets', auth, toNodeHandler(createSubjectHandler({ engine, actor: (_r, { req }) => req.user.id })))` → `GET /:id`, `GET /:id/history`, `POST /:id/start {workflowId}`, `POST /:id/move {next|branch|to}`, `POST /:id/emit {trigger}`. Engine errors → 404/409/500 with `{ error: { code, message, details } }`.

## Data

Table `workflows` (bundled migration: `require('vise-workflow-engine/knex').migrationsPath`, add it to knex `migrations.directory` as an array entry; or `createWorkflowsTable(knex)`). Subject table needs `workflow_id` + `current_node_id` (configurable via `columns`).

Stored workflow: `{ id, name, description, nodes: [{ id, position, data: { type, label?, variables } }], edges: [{ id, source, target, sourceHandle? /* branch id */ }], hooks: [{ id, type, trigger, scope: 'all' | nodeId[], enabled, config, position }] }`.

## HTTP

`GET /` `{ workflows }` · `GET /:id` `{ workflow, issues }` · `POST /` 201 · `PUT|PATCH /:id` · `DELETE /:id` 204 · errors `{ error: { code, message, details? } }`. Next.js/Hono/Bun: `createHandler({ store, basePath: '/api/workflows' })` and use it as a fetch handler.

## License

Server only: `validateLicense(process.env.WORKFLOW_ENGINE_KEY)` before createEngine/createHandler with real stores. The editor and memory stores need no key.

## Testing

`memoryStores({ workflows, subjects })` gives in-memory stores; `createLocalClient()` gives an editor client backed by localStorage.
