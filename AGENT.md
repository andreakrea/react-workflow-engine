# @workflow-engine/backend — Agent Instructions

A generic graph-based workflow state machine for Node.js + Express + PostgreSQL.
Zero domain knowledge — it works for any entity type (tickets, orders, disputes, etc.).

---

## Installation

```bash
npm install @workflow-engine/backend express knex pg
```

A license key must be validated before any engine or router calls will work:

```js
const { validateLicense } = require('@workflow-engine/backend');

const result = validateLicense(process.env.WORKFLOW_LICENSE_KEY);
if (!result.valid) throw new Error(result.error);
```

---

## Database Setup

The package owns a single table: `workflows`. Run the bundled migration once:

```js
// knexfile.js
module.exports = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  migrations: {
    directory: require('@workflow-engine/backend').migrationsPath,
  },
};
```

```bash
npx knex migrate:latest
```

The `workflows` table schema:

| Column       | Type      | Notes                          |
|--------------|-----------|--------------------------------|
| id           | integer   | primary key, auto-increment    |
| name         | string    | required                       |
| description  | text      | optional                       |
| nodes        | json      | array of node objects          |
| edges        | json      | array of edge objects          |
| hooks        | jsonb     | array of hook config objects   |
| created_by   | string    | optional, no FK enforced       |
| created_at   | timestamp |                                |
| updated_at   | timestamp |                                |

---

## Workflow Definition Structure

A workflow is a directed graph:

```js
{
  name: "Support Ticket Flow",
  nodes: [
    { id: "node_1", data: { type: "start",           label: "Created" } },
    { id: "node_2", data: { type: "waiting_review",  label: "Waiting Review" } },
    { id: "node_3", data: { type: "send_email",      label: "Send Email", variables: { to: "support@example.com", template: "follow_up", include_transcript: false } } },
    { id: "node_4", data: { type: "decision",        label: "Approved?" } },
    { id: "node_5", data: { type: "resolved",        label: "Resolved" } },
    { id: "node_6", data: { type: "rejected",        label: "Rejected" } },
  ],
  edges: [
    { id: "e1", source: "node_1", target: "node_2" },
    { id: "e2", source: "node_2", target: "node_3" },
    { id: "e3", source: "node_3", target: "node_4" },
    { id: "e4", source: "node_4", target: "node_5", sourceHandle: "true" },
    { id: "e5", source: "node_4", target: "node_6", sourceHandle: "false" },
  ],
  hooks: [],
}
```

Node `data.type` is the key identifier used in action registration and transitions.
Node `data.variables` (optional) stores per-node configuration values set in the editor’s config panel. The engine injects them into `context.variables` when executing action handlers and hooks.
The engine auto-detects the start node by looking for `data.type === 'start'`, then `'created'`, then `nodes[0]`.

For decision nodes with two outgoing edges, use `sourceHandle` values:
- Positive branch: `"true"`, `"yes"`, `"approved"`, `"success"`, `"accepted"`, `"progress"`
- Negative branch: `"false"`, `"no"`, `"rejected"`, `"cancel"`, `"declined"`

---

## REST API for Workflow CRUD — `createWorkflowRouter`

Mount this to manage workflow definitions stored in the database.

```js
const express = require('express');
const knex = require('knex')(require('./knexfile'));
const { validateLicense, createWorkflowRouter } = require('@workflow-engine/backend');

validateLicense(process.env.WORKFLOW_LICENSE_KEY);

const app = express();
app.use(express.json());

app.use('/api/workflows', createWorkflowRouter({
  knex,
  authMiddleware: requireAuth, // optional Express middleware
}));
```

### Endpoints

| Method | Path            | Body / Notes                                               | Response                         |
|--------|-----------------|------------------------------------------------------------|----------------------------------|
| GET    | `/`             | —                                                          | `{ success, workflows: [...] }`  |
| GET    | `/:id`          | —                                                          | `{ success, workflow: {...} }`   |
| POST   | `/`             | `{ name, nodes, edges, hooks?, description?, created_by? }` | `{ success, message, workflow }` |
| PUT    | `/:id`          | Any subset of POST body fields                             | `{ success, message, workflow }` |
| DELETE | `/:id`          | —                                                          | `{ success, message }`           |

`nodes` and `edges` are returned as parsed objects (not raw JSON strings).

---

## Running the State Machine — `WorkflowEngine`

The engine drives a *subject* (any entity in your DB) through a workflow.
It does **not** own your entity table — you supply a `subjectRepo` adapter.

```js
const { WorkflowEngine } = require('@workflow-engine/backend');

const engine = new WorkflowEngine({
  knex,                 // required — used to read the workflows table
  subjectRepo,          // required — adapter to your entity table (see below)
  hookDispatcher,       // optional — WorkflowHooksDispatcher instance
  actionRegistry,       // optional — external action registry object
  onCancelTracking,     // optional — async (subjectId, nodeId) => void
  onLogHookExecution,   // optional — async (subjectId, hookData) => void
});
```

### `subjectRepo` interface

You must implement these three methods against your own database table:

```js
const subjectRepo = {
  // Return the entity. MUST include these fields:
  async getById(id) {
    const row = await knex('tickets').where({ id }).first();
    return row ? {
      id:            row.id,
      workflowId:    row.workflow_id,
      currentNodeId: row.current_node_id,
      status:        row.status,
      // ...any extra fields your action handlers need
    } : null;
  },

  // Called after every transition
  async updateState(id, newNodeId, newNodeType) {
    await knex('tickets').where({ id }).update({
      current_node_id: newNodeId,
      status:          newNodeType,
      updated_at:      knex.fn.now(),
    });
  },

  // Called once when a workflow is first assigned to the entity
  async setWorkflow(id, workflowId, initialNodeId, initialNodeType) {
    await knex('tickets').where({ id }).update({
      workflow_id:     workflowId,
      current_node_id: initialNodeId,
      status:          initialNodeType,
      updated_at:      knex.fn.now(),
    });
  },
};
```

### Registering action handlers

Register one async handler per node type. Called automatically when the engine enters that node.

The second argument `context` always includes a `variables` object containing any per-node values configured in the editor. If no variables are defined for the node, `context.variables` is `{}`.

```js
// Returns: { success, autoProgress?, decision?, ...anything }
engine.registerAction('send_email', async (subject, context) => {
  const { to, template, include_transcript } = context.variables;
  await sendEmail(to || subject.email, template, { include_transcript });
  return { success: true, autoProgress: false };
});

engine.registerAction('auto_approve', async (subject, context) => {
  const approved = await checkEligibility(subject);
  // autoProgress: true + decision tells the engine to immediately follow
  // the matching outgoing edge without waiting for an external call
  return { success: true, autoProgress: true, decision: approved };
});
```

If no handler is registered for a node type, the engine logs a warning and continues (does not throw).

### Engine methods

```js
// Assign a workflow to a subject and land on the start node.
// Fires the start node's action handler and auto-progresses if needed.
await engine.initializeSubject(subjectId, workflowId, context?);

// Transition to a specific node by node id OR node type string.
await engine.transition(subjectId, 'waiting_review', context?);
await engine.transition(subjectId, 'node_3', context?);

// Transition using a boolean or string decision from the current node.
await engine.transitionByDecision(subjectId, true, context?);
await engine.transitionByDecision(subjectId, 'approved', context?);

// Check if a transition to a given node is valid from the current state.
const ok = await engine.canTransition(subjectId, 'node_3');

// List valid next nodes from the subject's current position.
const next = await engine.getAvailableTransitions(subjectId);
// → [{ nodeId, nodeType, edge }, ...]

// Manually fire lifecycle hooks (e.g. from a webhook handler).
await engine.executeHooks(subjectId, 'on_message', context?);
```

All state-machine methods return the updated subject merged with `{ actionResult }`.

---

## Lifecycle Hooks — `WorkflowHooksDispatcher`

Hooks are config objects stored inside the workflow definition and fired automatically by the engine at four trigger points:

| Trigger         | When it fires                            |
|-----------------|------------------------------------------|
| `on_node_entry` | After the engine lands on a new node     |
| `on_node_exit`  | Before the engine leaves a node          |
| `on_transition` | After state is persisted, before entry   |
| `on_message`    | Manually — call `engine.executeHooks()`  |

A hook config (inside `workflow.hooks`):

```js
{
  id: "hook_1",
  type: "send_slack_alert",   // matches the registered handler key
  trigger: "on_node_entry",
  scope: "all",               // "all" or array of nodeIds that activate it
  enabled: true,
  config: { channel: "#support" }, // passed to your handler via hook.config
}
```

Registering handlers:

```js
const { WorkflowHooksDispatcher } = require('@workflow-engine/backend');

const hookDispatcher = new WorkflowHooksDispatcher();

hookDispatcher.register('send_slack_alert', async (subject, hook, context) => {
  await slack.post(hook.config.channel, `Ticket ${subject.id} moved to ${context.currentNodeId}`);
  return { success: true };
});

hookDispatcher.register('escalation_detector', async (subject, hook, context) => {
  const escalating = await aiDetect(subject.id);
  if (escalating) await flagTicket(subject.id);
  return { success: true, escalating };
});

const engine = new WorkflowEngine({ knex, subjectRepo, hookDispatcher });
```

Handler signature: `async (subject, hook, context) => { success: boolean, ...anything }`

`context` always includes `currentNodeId` plus anything passed to the engine method.

---

## Complete Setup Example

```js
const express = require('express');
const knex = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL,
});

const {
  validateLicense,
  WorkflowEngine,
  WorkflowHooksDispatcher,
  createWorkflowRouter,
} = require('@workflow-engine/backend');

validateLicense(process.env.WORKFLOW_LICENSE_KEY);

const app = express();
app.use(express.json());

// 1. Mount CRUD router for managing workflow definitions
app.use('/api/workflows', createWorkflowRouter({ knex }));

// 2. Set up the state machine
const subjectRepo = {
  async getById(id) {
    const row = await knex('tickets').where({ id }).first();
    return row ? { id: row.id, workflowId: row.workflow_id, currentNodeId: row.current_node_id, status: row.status } : null;
  },
  async updateState(id, nodeId, nodeType) {
    await knex('tickets').where({ id }).update({ current_node_id: nodeId, status: nodeType, updated_at: knex.fn.now() });
  },
  async setWorkflow(id, workflowId, nodeId, nodeType) {
    await knex('tickets').where({ id }).update({ workflow_id: workflowId, current_node_id: nodeId, status: nodeType, updated_at: knex.fn.now() });
  },
};

const hookDispatcher = new WorkflowHooksDispatcher();
hookDispatcher.register('notify', async (subject, hook, context) => {
  console.log(`Notify: ticket ${subject.id} is now at ${context.currentNodeId}`);
  return { success: true };
});

const engine = new WorkflowEngine({ knex, subjectRepo, hookDispatcher });

engine.registerAction('send_email', async (subject, context) => {
  await sendEmail(subject.email, 'Your ticket was updated');
  return { success: true, autoProgress: true };
});

// 3. API routes that drive the state machine
app.post('/api/tickets/:id/start', async (req, res) => {
  const result = await engine.initializeSubject(req.params.id, req.body.workflowId);
  res.json(result);
});

app.post('/api/tickets/:id/transition', async (req, res) => {
  const result = await engine.transition(req.params.id, req.body.node);
  res.json(result);
});

app.post('/api/tickets/:id/decide', async (req, res) => {
  const result = await engine.transitionByDecision(req.params.id, req.body.decision);
  res.json(result);
});

app.listen(3000);
```

---

## License Key

The engine and router are gated behind a license key. Call `validateLicense()` once at startup before using any other export. The key encodes `org`, `plan`, and optional `exp` (expiry timestamp).

```js
const { validateLicense, getLicenseInfo } = require('@workflow-engine/backend');

validateLicense(process.env.WORKFLOW_LICENSE_KEY);

const info = getLicenseInfo(); // → { org, plan } or null
```

If the key is missing, expired, or invalid, `validateLicense` returns `{ valid: false, error: '...' }` and subsequent engine/router calls will throw.
