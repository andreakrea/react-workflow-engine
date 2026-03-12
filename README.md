# vise-workflow-engine

A generic, graph-based workflow engine with a drag-and-drop React editor. Zero domain coupling — works with any entity (tickets, orders, disputes, applications…).

**One install. Backend state machine + frontend visual editor.**

```bash
npm install vise-workflow-engine
```

## Live Demo

Try the editor in your browser — no backend required:

```bash
git clone https://github.com/andreavisentin/workflow-engine.git
cd workflow-engine/demo
npm install
npm run dev
```

The demo uses an in-memory mock API (localStorage) so you can drag, drop, save, and load workflows without setting up a database.

## What's included

| Module | Import | Description |
|--------|--------|-------------|
| **WorkflowEngine** | `require('vise-workflow-engine')` | Graph-based state machine with lifecycle hooks and auto-progression |
| **WorkflowHooksDispatcher** | `require('vise-workflow-engine')` | Plugin registry for lifecycle hook handlers |
| **createWorkflowRouter** | `require('vise-workflow-engine')` | Express router with 5 CRUD endpoints for workflows |
| **migrationsPath** | `require('vise-workflow-engine')` | Absolute path to Knex migration files |
| **WorkflowEditor** | `import from 'vise-workflow-engine/frontend'` | Drag-and-drop ReactFlow editor component |

## Peer dependencies

Install whichever side you need:

```bash
# Backend
npm install express knex pg

# Frontend
npm install react react-dom reactflow
```

All peer dependencies are **optional** — install only the ones you use.

---

## Backend

### 1. Run the migration

Add the migration path to your `knexfile.js`:

```js
const { migrationsPath } = require('vise-workflow-engine');

module.exports = {
  client: 'pg',
  connection: { /* your DB config */ },
  migrations: {
    directory: migrationsPath,
  },
};
```

Then run:

```bash
npx knex migrate:latest
```

This creates a `workflows` table:

| Column | Type | Description |
|--------|------|-------------|
| id | int (PK) | Auto-increment |
| name | string | Workflow name |
| description | text | Optional description |
| nodes | json | ReactFlow node array |
| edges | json | ReactFlow edge array |
| hooks | jsonb | Lifecycle hook definitions |
| created_by | string | Optional creator identifier |
| created_at | timestamp | Auto-set |
| updated_at | timestamp | Auto-set |

### 2. Mount the Express router

```js
const express = require('express');
const { createWorkflowRouter } = require('vise-workflow-engine');
const knex = require('knex')(require('./knexfile'));

const app = express();
app.use(express.json());

app.use('/api/workflows', createWorkflowRouter({ knex }));

// With auth middleware:
app.use('/api/workflows', createWorkflowRouter({
  knex,
  authMiddleware: requireAuth,
}));
```

**Endpoints:**

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/` | — | `{ success, workflows }` |
| GET | `/:id` | — | `{ success, workflow }` |
| POST | `/` | `{ name, nodes, edges, hooks?, description?, created_by? }` | `{ success, message, workflow }` |
| PUT | `/:id` | Any subset of the above | `{ success, message, workflow }` |
| DELETE | `/:id` | — | `{ success, message }` |

### 3. Set up the engine

The engine needs two things: a `knex` instance and a `subjectRepo` adapter that bridges to your domain entity.

```js
const { WorkflowEngine } = require('vise-workflow-engine');

const engine = new WorkflowEngine({
  knex,

  subjectRepo: {
    async getById(id) {
      const row = await knex('tickets').where({ id }).first();
      return row ? {
        id: row.id,
        workflowId: row.workflow_id,
        currentNodeId: row.current_node_id,
        status: row.status,
      } : null;
    },

    async updateState(id, nodeId, nodeType) {
      await knex('tickets').where({ id }).update({
        current_node_id: nodeId,
        status: nodeType,
        updated_at: knex.fn.now(),
      });
    },

    async setWorkflow(id, workflowId, nodeId, nodeType) {
      await knex('tickets').where({ id }).update({
        workflow_id: workflowId,
        current_node_id: nodeId,
        status: nodeType,
        updated_at: knex.fn.now(),
      });
    },
  },
});
```

### 4. Register actions and hooks

Actions run when a node is entered. Hooks run at lifecycle moments.

```js
// Actions (one per node type)
engine.registerAction('send_email', async (subject, context) => {
  await sendEmail(subject.email, 'Your ticket has been updated');
  return { success: true, autoProgress: false };
});

engine.registerAction('auto_classify', async (subject, context) => {
  const category = await classifier.run(subject);
  await knex('tickets').where({ id: subject.id }).update({ category });
  // autoProgress: true → engine automatically moves to the next node
  return { success: true, autoProgress: true };
});

// Hooks (lifecycle triggers)
engine.registerHook('send_slack_alert', async (subject, hook, context) => {
  await slack.post(`Ticket ${subject.id} entered node ${context.currentNodeId}`);
  return { success: true };
});
```

### 5. Use the engine

```js
// Assign a workflow to an entity and land on the first node
await engine.initializeSubject(ticketId, workflowId);

// Transition to a specific node (by id or type)
await engine.transition(ticketId, 'awaiting_review');

// Decision-based transition (YES/NO branches)
await engine.transitionByDecision(ticketId, true);   // YES branch
await engine.transitionByDecision(ticketId, false);  // NO branch

// Get available next steps
const transitions = await engine.getAvailableTransitions(ticketId);

// Check if a transition is valid
const allowed = await engine.canTransition(ticketId, 'resolved');

// Fire hooks externally (e.g. on every incoming message)
await engine.executeHooks(ticketId, 'on_message', { message });
```

### Using WorkflowHooksDispatcher (optional)

For larger apps, use a centralized dispatcher instead of inline `registerHook`:

```js
const { WorkflowEngine, WorkflowHooksDispatcher } = require('vise-workflow-engine');

const hookDispatcher = new WorkflowHooksDispatcher();

hookDispatcher.register('send_slack_alert', async (subject, hook, context) => {
  await slack.post(`Ticket ${subject.id} moved to ${context.currentNodeId}`);
  return { success: true };
});

hookDispatcher.register('escalation_detector', async (subject, hook, context) => {
  const isEscalating = await ai.detectEscalation(subject.id);
  if (isEscalating) await flagForReview(subject.id);
  return { success: true, isEscalating };
});

const engine = new WorkflowEngine({ knex, subjectRepo, hookDispatcher });
```

---

## Frontend

A drag-and-drop React component for visually building workflows. Built on [ReactFlow](https://reactflow.dev).

### Setup

```tsx
import { WorkflowEditor } from 'vise-workflow-engine/frontend';
import 'vise-workflow-engine/frontend/style.css';
```

### Define your blocks

```tsx
import type { BlockType } from 'vise-workflow-engine/frontend';

const blockTypes: BlockType[] = [
  {
    id: 'start',
    label: 'Start',
    icon: '🟢',
    color: 'bg-green-100 border-green-300',
    description: 'Entry point of the workflow',
    nodeType: 'standard',
  },
  {
    id: 'review',
    label: 'Manual Review',
    icon: '👁️',
    color: 'bg-blue-100 border-blue-300',
    description: 'Agent reviews the ticket',
    nodeType: 'standard',
  },
  {
    id: 'needs_approval',
    label: 'Needs Approval?',
    icon: '❓',
    color: 'bg-yellow-100 border-yellow-300',
    description: 'Decision: approve or reject',
    nodeType: 'decision',
  },
  {
    id: 'resolved',
    label: 'Resolved',
    icon: '✅',
    color: 'bg-emerald-100 border-emerald-300',
    description: 'Ticket is resolved',
    nodeType: 'terminal',
  },
];

const hookTypes: BlockType[] = [
  {
    id: 'send_slack_alert',
    label: 'Slack Alert',
    icon: '💬',
    color: 'bg-purple-100 border-purple-300',
    description: 'Send a notification to Slack',
    nodeType: 'hook',
    trigger: 'on_node_entry',
  },
];
```

### Render the editor

```tsx
function App() {
  return (
    <WorkflowEditor
      apiUrl="http://localhost:3000"
      blockTypes={blockTypes}
      hookTypes={hookTypes}
      title="My Workflow Editor"
      onBack={() => navigate('/dashboard')}
    />
  );
}
```

### WorkflowEditorProps

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `apiUrl` | `string` | Yes | Base URL for the workflow API (e.g. `http://localhost:3000`) |
| `blockTypes` | `BlockType[]` | Yes | Workflow step blocks for the palette |
| `hookTypes` | `BlockType[]` | Yes | Lifecycle hook blocks for the palette |
| `title` | `string` | No | Editor header title (default: `"Workflow Editor"`) |
| `onBack` | `() => void` | No | Back button callback (hidden if omitted) |

### BlockType

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique type identifier |
| `label` | `string` | Display label |
| `icon` | `string` | Emoji or icon string |
| `color` | `string` | Tailwind CSS classes (e.g. `bg-blue-100 border-blue-300`) |
| `description` | `string` | Short help text |
| `nodeType` | `'standard' \| 'decision' \| 'terminal' \| 'hook'` | Determines node shape and handles |
| `trigger` | `'on_message' \| 'on_transition' \| 'on_node_entry' \| 'on_node_exit'` | Hook trigger (required for `hook` nodeType) |

**Node types:**
- **standard** — 1 input, 1 output
- **decision** — 1 input, 2 outputs (YES/NO branches)
- **terminal** — 1 input, no output (end state)
- **hook** — no handles (floating lifecycle trigger)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 WorkflowEditor                  │
│         (React drag-and-drop canvas)            │
│                                                 │
│   blockTypes[] ──→ palette ──→ canvas nodes     │
│   hookTypes[]  ──→ palette ──→ hook configs     │
│                                                 │
│   CRUD ←──→ POST/PUT/GET/DELETE /api/workflows  │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼────────┐
              │  Express Router │
              │  (5 endpoints)  │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │   workflows     │
              │   (PostgreSQL)  │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ WorkflowEngine  │
              │ (state machine) │
              │                 │
              │ ┌─────────────┐ │
              │ │ subjectRepo │◄├── Your domain entity adapter
              │ └─────────────┘ │
              │ ┌─────────────┐ │
              │ │   actions   │◄├── Your node handlers
              │ └─────────────┘ │
              │ ┌─────────────┐ │
              │ │    hooks    │◄├── Your lifecycle handlers
              │ └─────────────┘ │
              └─────────────────┘
```

## License

MIT
