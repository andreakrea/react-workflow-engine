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
- **Workflow engine**: `npm install vise-workflow-engine` — this package provides:
  - `WorkflowEngine` — graph-based state machine (manages ticket states/transitions)
  - `WorkflowHooksDispatcher` — lifecycle hooks (on_message, on_transition, on_node_entry, on_node_exit)
  - `createWorkflowRouter` — Express CRUD routes for workflow management
  - `WorkflowEditor` — React drag-and-drop visual editor component
  - Import: backend from `vise-workflow-engine`, frontend from `vise-workflow-engine/frontend`

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

workflows (managed by vise-workflow-engine — already has its own migration)

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

```javascript
// server/src/workflow-setup.ts
const { WorkflowEngine, WorkflowHooksDispatcher, createWorkflowRouter, validateLicense } = require('vise-workflow-engine');

// Activate license
validateLicense('YOUR_KEY_HERE');

// Mount workflow CRUD routes
app.use(createWorkflowRouter(knex));

// When a new message arrives on a conversation:
async function handleIncomingMessage(conversationId, message) {
  const conversation = await getConversation(conversationId);
  const workflow = await getWorkflow(conversation.workflow_id);

  // Create engine instance with the workflow graph
  const engine = new WorkflowEngine(workflow, knex);

  // Get available transitions from current node
  const transitions = engine.getTransitions(conversation.current_node_id);

  // Dispatch hooks — triggers any AI actions bound to on_message
  const dispatcher = new WorkflowHooksDispatcher(workflow.hooks);
  await dispatcher.dispatch('on_message', {
    conversation,
    message,
    currentNode: conversation.current_node_id,
  });

  // AI decides if it should auto-reply or escalate
  // (based on workflow configuration)
}
```

```tsx
// client/src/pages/WorkflowSettings.tsx
import WorkflowEditor from 'vise-workflow-engine/frontend';
import 'vise-workflow-engine/frontend/style.css';

// Block types specific to customer care
const blockTypes = [
  { id: 'triage', label: 'Triage', icon: '📋', color: 'bg-yellow-100 border-yellow-300 text-yellow-900', description: 'AI classifies and routes the ticket', nodeType: 'standard' },
  { id: 'ai_response', label: 'AI Auto-Reply', icon: '🤖', color: 'bg-blue-100 border-blue-300 text-blue-900', description: 'AI handles the conversation', nodeType: 'standard' },
  { id: 'human_queue', label: 'Agent Queue', icon: '👤', color: 'bg-green-100 border-green-300 text-green-900', description: 'Waiting for human agent', nodeType: 'standard' },
  { id: 'in_progress', label: 'In Progress', icon: '🔄', color: 'bg-purple-100 border-purple-300 text-purple-900', description: 'Agent is handling the ticket', nodeType: 'standard' },
  { id: 'needs_approval', label: 'Needs Approval', icon: '✋', color: 'bg-orange-100 border-orange-300 text-orange-900', description: 'Requires manager approval', nodeType: 'decision' },
  { id: 'resolved', label: 'Resolved', icon: '✅', color: 'bg-emerald-100 border-emerald-300 text-emerald-900', description: 'Issue resolved', nodeType: 'terminal' },
  { id: 'closed', label: 'Closed', icon: '🔒', color: 'bg-gray-100 border-gray-300 text-gray-900', description: 'Ticket closed', nodeType: 'terminal' },
];

const hookTypes = [
  { id: 'on_new_message', label: 'New Message Handler', icon: '💬', color: 'bg-cyan-100 border-cyan-300', description: 'Runs AI analysis on every new message', nodeType: 'hook', trigger: 'on_message' },
  { id: 'on_escalation', label: 'Escalation Hook', icon: '🚨', color: 'bg-red-100 border-red-300', description: 'Notifies manager when ticket is escalated', nodeType: 'hook', trigger: 'on_transition' },
  { id: 'on_resolve', label: 'Resolution Hook', icon: '📊', color: 'bg-green-100 border-green-300', description: 'Sends satisfaction survey on resolve', nodeType: 'hook', trigger: 'on_node_entry' },
];

function WorkflowSettings() {
  return (
    <WorkflowEditor
      apiUrl="/api"
      blockTypes={blockTypes}
      hookTypes={hookTypes}
      licenseKey="YOUR_KEY"
      title="Support Workflow Designer"
    />
  );
}
```

---

## Important Implementation Notes

- Every API route must be scoped to the authenticated business (`WHERE business_id = ?`) — never expose data across businesses
- Rate limit the AI endpoints per business based on their plan
- Store OpenAI API keys per business (they bring their own) OR use a shared key and track usage
- The chat widget must be lightweight (<50KB gzipped), load asynchronously, and not block the host page
- Use database transactions when transitioning workflow state + creating messages + dispatching hooks
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
