# Project Prompt: AI-Powered Customer Care Platform

## What to build

Build a full-stack SaaS platform called **"Vise Care"** — an AI-powered customer care solution that businesses can customize to handle their support workflows.

The core idea: businesses sign up, visually design their support workflow using a drag-and-drop editor (powered by `vise-workflow-engine` from npm), and the platform runs AI-driven customer interactions through that workflow automatically.

---

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Knex.js
- **AI**: OpenAI API (GPT-4) for message handling, classification, summarization, and auto-replies
- **Real-time**: Socket.io for live chat and agent dashboard updates
- **Auth**: JWT-based authentication with bcrypt password hashing
- **File storage**: Local uploads or S3-compatible storage for attachments
- **Workflow engine**: `npm install vise-workflow-engine` (v2) — read `node_modules/vise-workflow-engine/AGENT.md` first. It provides:
  - `createEngine` — graph-based state machine (ticket states, typed actions per block, lifecycle hooks), from `vise-workflow-engine`
  - `knexStores` — Postgres storage for workflows + your `conversations` table, from `vise-workflow-engine/knex`
  - `createHandler` / `toNodeHandler` — workflow CRUD HTTP API, from `vise-workflow-engine/server`
  - `WorkflowEditor` / `createHttpClient` — React drag-and-drop editor, from `vise-workflow-engine/react`

---

## Database Schema

### Core tables

```
businesses
  id, name, slug, plan (free|starter|pro|enterprise), logo_url,
  created_at, updated_at

users
  id, business_id (FK), email, password_hash, role (owner|admin|agent),
  name, avatar_url, is_active, created_at

api_keys
  id, business_id (FK), key_hash, label, created_at, last_used_at

customers (end-users who contact support)
  id, business_id (FK), external_id, name, email, phone,
  metadata (JSONB — custom fields the business defines), created_at

conversations
  id, business_id (FK), customer_id (FK), channel (chat|email|whatsapp|api),
  workflow_id (FK), current_node_id (varchar — the node in the workflow graph),
  status (open|pending|resolved|closed), priority (low|normal|high|urgent),
  assigned_agent_id (FK → users), subject,
  ai_summary (text — auto-generated), ai_sentiment (varchar),
  tags (text[]), metadata (JSONB),
  created_at, updated_at, resolved_at

messages
  id, conversation_id (FK), sender_type (customer|agent|ai|system),
  sender_id (varchar), content (text), content_type (text|html|markdown),
  attachments (JSONB), ai_suggested_reply (text),
  created_at

workflows (managed by vise-workflow-engine — add require('vise-workflow-engine/knex').migrationsPath to your knex migration directories, or call createWorkflowsTable(knex, { extend: t => t.integer('business_id') }))

ai_actions
  id, business_id (FK), name, type (classify|auto_reply|summarize|sentiment|custom),
  prompt_template (text), model (varchar, default 'gpt-4'),
  config (JSONB — temperature, max_tokens, etc.), is_active, created_at

workflow_ai_bindings
  id, workflow_id (FK), node_id (varchar), hook_trigger (on_message|on_node_entry|on_node_exit|on_transition),
  ai_action_id (FK), priority (int), is_active, created_at

canned_responses
  id, business_id (FK), title, content (text), shortcut (varchar),
  category, created_at

knowledge_base_articles
  id, business_id (FK), title, content (text), embedding (vector — for RAG),
  category, is_published, created_at, updated_at
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React SPA)                     │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌───────────┐│
│  │  Login/  │  │    Agent     │  │  Workflow   │  │  Business ││
│  │  Signup  │  │  Dashboard   │  │   Editor    │  │  Settings ││
│  │          │  │  (live chat) │  │(vise-w-e)   │  │           ││
│  └──────────┘  └──────────────┘  └────────────┘  └───────────┘│
│        ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│        │  AI Actions  │  │  Knowledge   │  │   Analytics    │  │
│        │   Config     │  │    Base      │  │   Dashboard    │  │
│        └──────────────┘  └──────────────┘  └────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API + WebSocket
┌────────────────────────────┴────────────────────────────────────┐
│                        BACKEND (Express)                        │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────────┐│
│  │  Auth    │  │  Conversation │  │  AI Service               ││
│  │  Module  │  │  Manager      │  │  - classify intent        ││
│  │          │  │  (Socket.io)  │  │  - generate reply          ││
│  └──────────┘  └──────────────┘  │  - summarize conversation  ││
│  ┌──────────┐  ┌──────────────┐  │  - sentiment analysis      ││
│  │ Workflow │  │  Channel     │  │  - RAG from knowledge base ││
│  │ Engine   │  │  Router      │  └────────────────────────────┘│
│  │(vise-w-e)│  │  (chat/email)│                                │
│  └──────────┘  └──────────────┘                                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │   PostgreSQL    │
                    └─────────────────┘
```

---

## Feature Breakdown (build in this order)

### Phase 1: Foundation
1. **Project setup** — monorepo with `/server` and `/client` folders, shared TypeScript config
2. **Database** — Knex migrations for all tables above, seed data for development
3. **Auth system** — signup, login, JWT middleware, role-based access (owner/admin/agent)
4. **Business onboarding** — create business, invite agents via email

### Phase 2: Workflow + Conversations
5. **Workflow integration** — install `vise-workflow-engine`, run its migration, integrate `WorkflowEditor` in the frontend settings page so business admins can design their support flow
6. **Conversation system** — CRUD for conversations, message sending/receiving, assign to agents
7. **Ticket state machine** — when a message comes in, use `WorkflowEngine` to determine current state and available transitions. Agents can transition tickets between nodes.
8. **Real-time agent dashboard** — Socket.io powered. Shows all open conversations, unread count, live typing indicators. Agents can claim/transfer conversations.

### Phase 3: AI Layer
9. **AI service module** — wrapper around OpenAI API with retry logic, token tracking, and cost estimation
10. **AI actions system** — configurable AI actions (classify, auto_reply, summarize, sentiment) that businesses can create with custom prompt templates
11. **Workflow-AI binding** — bind AI actions to workflow hooks. Example: "When a ticket enters the Triage node, run the classify action. When a message arrives, run sentiment analysis."
12. **Auto-reply with human handoff** — AI responds to customers automatically when the workflow is configured for it. If confidence is low or customer requests human, transition to agent node.
13. **Knowledge base + RAG** — businesses upload articles, embeddings are generated, AI uses them as context when generating replies

### Phase 4: Channels
14. **Embeddable chat widget** — a small JS snippet businesses add to their website. Opens a chat window that connects via WebSocket. `<script src="https://yourapi.com/widget.js" data-business="slug"></script>`
15. **Email channel** — inbound email parsing (webhook from email provider), outbound replies via SMTP/API
16. **API channel** — REST API for businesses to send/receive messages programmatically (for WhatsApp, Telegram, custom integrations)

### Phase 5: Polish
17. **Analytics dashboard** — conversations per day, avg resolution time, AI vs human resolution rate, customer satisfaction, workflow bottleneck analysis
18. **Canned responses** — agents can save and reuse common replies with shortcuts
19. **Customer portal** — customers can view their ticket history, reopen tickets
20. **Multi-language** — AI auto-detects language and responds in the customer's language

---

## Key Integration: How vise-workflow-engine fits in

Define the blocks once and import them on both sides:

```ts
// shared/workflow.config.ts
import { defineBlocks, defineHooks, v } from 'vise-workflow-engine';

export const blocks = defineBlocks({
  start:          { kind: 'start', label: 'New conversation', icon: '🟢', color: '#dcfce7' },
  triage:         { kind: 'decision', label: 'Triage', icon: '📋', color: '#fef9c3', branches: ['ai', 'human'] },
  ai_response:    { kind: 'step', label: 'AI Auto-Reply', icon: '🤖', color: '#dbeafe',
                    variables: { ai_action_id: v.number({ label: 'AI action', required: true }), min_confidence: v.number({ default: 0.7 }) } },
  human_queue:    { kind: 'step', label: 'Agent Queue', icon: '👤', color: '#dcfce7' },
  in_progress:    { kind: 'step', label: 'In Progress', icon: '🔄', color: '#f3e8ff' },
  needs_approval: { kind: 'decision', label: 'Needs Approval', icon: '✋', color: '#ffedd5' },
  resolved:       { kind: 'end', label: 'Resolved', icon: '✅', color: '#d1fae5' },
  closed:         { kind: 'end', label: 'Closed', icon: '🔒', color: '#f1f5f9' },
});

export const hooks = defineHooks({
  on_new_message: { trigger: 'on_message', label: 'New Message Handler', icon: '💬', config: { ai_action_id: v.number() } },
  on_escalation:  { trigger: 'on_transition', label: 'Escalation Hook', icon: '🚨' },
  on_resolve:     { trigger: 'on_node_entry', label: 'Resolution Hook', icon: '📊' },
});
```

```ts
// server/src/services/workflow.ts
import { createEngine, validateLicense } from 'vise-workflow-engine';
import { knexStores } from 'vise-workflow-engine/knex';
import { createHandler, toNodeHandler } from 'vise-workflow-engine/server';
import { blocks, hooks } from '../../shared/workflow.config';

validateLicense(process.env.WORKFLOW_ENGINE_KEY);

export const engine = createEngine({
  ...knexStores(knex, { subjects: { table: 'conversations', columns: { nodeType: 'status' } } }),
  blocks,
  hooks,
  actions: {
    start: () => ({ next: true }),
    triage: async ({ subject }) => ({ branch: (await ai.classify(subject)).needsHuman ? 'human' : 'ai' }),
    ai_response: async ({ subject, variables, tx }) => {
      const reply = await ai.reply(subject, variables.ai_action_id);
      if (reply.confidence < variables.min_confidence) return { to: 'human_queue' };
      await saveMessage(tx, subject.id, reply);
      // no return → wait for the next customer message
    },
    // human_queue / in_progress / needs_approval wait for agents: engine.move(id, { next: true } | { branch: 'yes' })
  },
  hookHandlers: {
    on_new_message: ({ subject, config, input }) => ai.runAction(config.ai_action_id, subject, input.message),
    on_escalation: ({ subject, to }) => notifyManagers(subject, to),
    on_resolve: ({ subject }) => sendSatisfactionSurvey(subject),
  },
});

// Workflow CRUD, scoped to the business
app.use('/api/workflows', requireAuth, toNodeHandler(createHandler({
  store: engine.workflows,
  validate: engine.validate,
  scope: (_req, { req }) => ({ business_id: req.user.businessId }),
  authorize: (_req, action, { req }) => action === 'list' || action === 'read' || req.user.role !== 'agent',
  createdBy: (_req, { req }) => String(req.user.id),
})));

// When a new message arrives on a conversation:
export async function handleIncomingMessage(conversationId: number, message: Message) {
  await engine.emit(conversationId, 'on_message', { message });
}
```

```tsx
// client/src/pages/WorkflowSettings.tsx
import { WorkflowEditor, createHttpClient } from 'vise-workflow-engine/react';
import 'vise-workflow-engine/react/style.css';
import { blocks, hooks } from '../../../shared/workflow.config';

const client = createHttpClient({ baseUrl: '/api/workflows', headers: () => ({ Authorization: `Bearer ${getToken()}` }) });

export default function WorkflowSettings() {
  const [id, setId] = useState<number | null>(null);
  return (
    <div style={{ height: 'calc(100vh - 64px)' }}>
      <WorkflowEditor blocks={blocks} hooks={hooks} client={client} workflowId={id} onWorkflowIdChange={setId}
        title="Support Workflow" onSaved={() => toast.success('Saved')} onError={(e) => toast.error(String(e))} />
    </div>
  );
}
```

---

## Important Implementation Notes

- Every API route must be scoped to the authenticated business (`WHERE business_id = ?`) — never expose data across businesses
- Rate limit the AI endpoints per business based on their plan
- Store OpenAI API keys per business (they bring their own) OR use a shared key and track usage
- The chat widget must be lightweight (<50KB gzipped), load asynchronously, and not block the host page
- Workflow moves already run in one transaction (knexStores); write messages inside actions/hooks through the `tx` they receive so they commit or roll back with the move
- Index `conversations` on `(business_id, status)` and `(business_id, assigned_agent_id)` for dashboard queries
- All WebSocket connections must be authenticated and scoped to business

---

## Folder Structure

```
vise-care/
├── server/
│   ├── src/
│   │   ├── index.ts              # Express app setup
│   │   ├── config.ts             # env vars, DB config
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT verification
│   │   │   └── businessScope.ts  # ensures business isolation
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── conversations.ts
│   │   │   ├── messages.ts
│   │   │   ├── customers.ts
│   │   │   ├── ai-actions.ts
│   │   │   ├── knowledge-base.ts
│   │   │   └── analytics.ts
│   │   ├── services/
│   │   │   ├── ai.ts             # OpenAI wrapper
│   │   │   ├── workflow.ts       # vise-workflow-engine integration
│   │   │   ├── email.ts          # inbound/outbound email
│   │   │   └── socket.ts         # Socket.io handlers
│   │   └── migrations/
│   ├── knexfile.ts
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx          # agent view
│   │   │   ├── ConversationView.tsx   # single conversation
│   │   │   ├── WorkflowSettings.tsx   # workflow editor
│   │   │   ├── AISettings.tsx         # AI actions config
│   │   │   ├── KnowledgeBase.tsx
│   │   │   ├── Analytics.tsx
│   │   │   └── BusinessSettings.tsx
│   │   ├── components/
│   │   │   ├── ChatMessage.tsx
│   │   │   ├── ConversationList.tsx
│   │   │   ├── AgentSidebar.tsx
│   │   │   └── CustomerInfo.tsx
│   │   └── services/
│   │       ├── api.ts
│   │       └── socket.ts
│   ├── vite.config.ts
│   └── package.json
├── widget/                        # embeddable chat widget
│   ├── src/
│   │   ├── widget.ts             # entry point, creates iframe
│   │   └── chat.tsx              # chat UI inside iframe
│   └── vite.config.ts            # builds to single JS file
└── package.json                   # workspace root
```

---

## Start with

Create the project, install dependencies, set up the database, implement auth, then build the agent dashboard with real-time conversations. Get a single end-to-end flow working first: customer sends message via API → conversation created → appears on agent dashboard → agent replies → customer sees reply. Then layer in the workflow engine and AI.
