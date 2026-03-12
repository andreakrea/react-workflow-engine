/**
 * In-memory mock API that intercepts fetch calls to /api/workflows.
 * Allows the WorkflowEditor to work without a real backend.
 * Workflows are persisted in localStorage so they survive page reloads.
 */

interface Workflow {
  id: number;
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
  hooks: unknown[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const STORAGE_KEY = 'vise-wfe-demo-workflows';

let nextId = 1;

function loadWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Workflow[];
    if (list.length > 0) {
      nextId = Math.max(...list.map((w) => w.id)) + 1;
    }
    return list;
  } catch {
    return [];
  }
}

function saveWorkflows(workflows: Workflow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
}

let workflows = loadWorkflows();

function parseJsonField(value: unknown): unknown[] {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  }
  return (value as unknown[]) ?? [];
}

const originalFetch = window.fetch.bind(window);

window.fetch = async function mockedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();

  // Only intercept /api/workflows requests
  const match = url.match(/\/api\/workflows(?:\/(\d+))?$/);
  if (!match) return originalFetch(input, init);

  const id = match[1] ? parseInt(match[1], 10) : null;

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  // GET /api/workflows
  if (method === 'GET' && id === null) {
    const sorted = [...workflows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    return json({ success: true, workflows: sorted });
  }

  // GET /api/workflows/:id
  if (method === 'GET' && id !== null) {
    const wf = workflows.find((w) => w.id === id);
    if (!wf) return json({ success: false, error: 'Not found' }, 404);
    return json({ success: true, workflow: wf });
  }

  // POST /api/workflows
  if (method === 'POST') {
    const body = JSON.parse(init?.body as string);
    const now = new Date().toISOString();
    const workflow: Workflow = {
      id: nextId++,
      name: body.name ?? 'Untitled',
      description: body.description ?? '',
      nodes: parseJsonField(body.nodes),
      edges: parseJsonField(body.edges),
      hooks: parseJsonField(body.hooks),
      created_by: body.created_by ?? null,
      created_at: now,
      updated_at: now,
    };
    workflows.push(workflow);
    saveWorkflows(workflows);
    return json({ success: true, message: 'Workflow created', workflow });
  }

  // PUT /api/workflows/:id
  if (method === 'PUT' && id !== null) {
    const idx = workflows.findIndex((w) => w.id === id);
    if (idx === -1) return json({ success: false, error: 'Not found' }, 404);
    const body = JSON.parse(init?.body as string);
    const wf = workflows[idx];
    if (body.name !== undefined) wf.name = body.name;
    if (body.description !== undefined) wf.description = body.description;
    if (body.nodes !== undefined) wf.nodes = parseJsonField(body.nodes);
    if (body.edges !== undefined) wf.edges = parseJsonField(body.edges);
    if (body.hooks !== undefined) wf.hooks = parseJsonField(body.hooks);
    wf.updated_at = new Date().toISOString();
    saveWorkflows(workflows);
    return json({ success: true, message: 'Workflow updated', workflow: wf });
  }

  // DELETE /api/workflows/:id
  if (method === 'DELETE' && id !== null) {
    const idx = workflows.findIndex((w) => w.id === id);
    if (idx === -1) return json({ success: false, error: 'Not found' }, 404);
    workflows.splice(idx, 1);
    saveWorkflows(workflows);
    return json({ success: true, message: 'Workflow deleted' });
  }

  return originalFetch(input, init);
};
