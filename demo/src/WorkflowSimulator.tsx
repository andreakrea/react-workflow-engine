import { useState, useCallback } from 'react';

interface WorkflowNode {
  id: string;
  data: { label: string; type: string; className?: string; variables?: Record<string, any> };
  position: { x: number; y: number };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

interface WorkflowHook {
  id: string;
  type: string;
  label: string;
  trigger: string;
  scope: string | string[];
  enabled: boolean;
}

interface SavedWorkflow {
  id: number;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  hooks: WorkflowHook[];
}

interface LogEntry {
  time: string;
  type: 'transition' | 'hook' | 'action' | 'info' | 'error';
  message: string;
}

interface Ticket {
  id: number;
  label: string;
  currentNodeId: string | null;
  currentNodeType: string | null;
  workflowId: number | null;
  status: 'idle' | 'in-progress' | 'completed';
}

const STORAGE_KEY = 'vise-wfe-demo-workflows';

function loadWorkflows(): SavedWorkflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getInitialNode(workflow: SavedWorkflow): WorkflowNode | null {
  if (!workflow.nodes.length) return null;
  return (
    workflow.nodes.find((n) => n.data?.type === 'start') ||
    workflow.nodes.find((n) => n.data?.type === 'created') ||
    workflow.nodes[0]
  );
}

function getNextStates(workflow: SavedWorkflow, currentNodeId: string) {
  const currentNode = workflow.nodes.find((n) => n.id === currentNodeId);
  if (!currentNode) return [];
  return workflow.edges
    .filter((e) => e.source === currentNode.id)
    .map((edge) => {
      const target = workflow.nodes.find((n) => n.id === edge.target);
      return target
        ? { nodeId: target.id, nodeType: target.data?.type, label: target.data?.label, edge }
        : null;
    })
    .filter(Boolean) as { nodeId: string; nodeType: string; label: string; edge: WorkflowEdge }[];
}

function getApplicableHooks(workflow: SavedWorkflow, trigger: string, nodeId: string) {
  return (workflow.hooks || []).filter((hook) => {
    if (!hook.enabled) return false;
    if (hook.trigger !== trigger) return false;
    if (hook.scope === 'all') return true;
    if (Array.isArray(hook.scope)) return hook.scope.includes(nodeId);
    return false;
  });
}

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export default function WorkflowSimulator() {
  const [workflows] = useState<SavedWorkflow[]>(loadWorkflows);
  const [selectedWfId, setSelectedWfId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [nextTicketId, setNextTicketId] = useState(1);
  const [log, setLog] = useState<LogEntry[]>([]);

  const selectedWorkflow = workflows.find((w) => w.id === selectedWfId) || null;

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setLog((prev) => [...prev, { time: timestamp(), type, message }]);
  }, []);

  const fireHooks = useCallback(
    (workflow: SavedWorkflow, trigger: string, nodeId: string, ticketLabel: string) => {
      const hooks = getApplicableHooks(workflow, trigger, nodeId);
      hooks.forEach((hook) => {
        addLog('hook', `🪝 [${trigger}] "${hook.label}" fired for ${ticketLabel}`);
      });
    },
    [addLog]
  );

  const handleSelectWorkflow = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value, 10);
    setSelectedWfId(isNaN(id) ? null : id);
    setTickets([]);
    setLog([]);
  };

  const handleCreateTicket = () => {
    if (!selectedWorkflow) return;
    const initial = getInitialNode(selectedWorkflow);
    if (!initial) {
      addLog('error', 'No initial node found in workflow');
      return;
    }
    const ticket: Ticket = {
      id: nextTicketId,
      label: `Ticket #${nextTicketId}`,
      currentNodeId: initial.id,
      currentNodeType: initial.data?.type,
      workflowId: selectedWorkflow.id,
      status: 'in-progress',
    };
    setTickets((prev) => [...prev, ticket]);
    setNextTicketId((n) => n + 1);
    addLog('info', `📋 ${ticket.label} created → enters "${initial.data?.label}"`);
    addLog('action', `⚡ Action "${initial.data?.type}" executed for ${ticket.label}`);
    const initVars = initial.data?.variables;
    if (initVars && Object.keys(initVars).length > 0) {
      const varStr = Object.entries(initVars).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
      addLog('info', `📋 Variables for ${ticket.label}: ${varStr}`);
    }
    fireHooks(selectedWorkflow, 'on_node_entry', initial.id, ticket.label);
  };

  const handleTransition = (ticketId: number, targetNodeId: string) => {
    if (!selectedWorkflow) return;
    const targetNode = selectedWorkflow.nodes.find((n) => n.id === targetNodeId);
    if (!targetNode) return;

    setTickets((prev) =>
      prev.map((t) => {
        if (t.id !== ticketId) return t;

        const fromNode = selectedWorkflow.nodes.find((n) => n.id === t.currentNodeId);
        const fromLabel = fromNode?.data?.label || t.currentNodeId;

        // on_node_exit hooks
        if (t.currentNodeId) {
          fireHooks(selectedWorkflow, 'on_node_exit', t.currentNodeId, t.label);
        }

        addLog(
          'transition',
          `➡️ ${t.label}: "${fromLabel}" → "${targetNode.data?.label}"`
        );

        // on_transition hooks
        fireHooks(selectedWorkflow, 'on_transition', targetNodeId, t.label);

        // on_node_entry hooks
        fireHooks(selectedWorkflow, 'on_node_entry', targetNodeId, t.label);

        // Execute action
        addLog('action', `⚡ Action "${targetNode.data?.type}" executed for ${t.label}`);

        // Log configured variables if present
        const vars = targetNode.data?.variables;
        if (vars && Object.keys(vars).length > 0) {
          const varStr = Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
          addLog('info', `📋 Variables for ${t.label}: ${varStr}`);
        }

        // Check if terminal
        const nextStates = getNextStates(selectedWorkflow, targetNodeId);
        const isTerminal = nextStates.length === 0;

        if (isTerminal) {
          addLog('info', `🏁 ${t.label} reached terminal node "${targetNode.data?.label}"`);
        }

        return {
          ...t,
          currentNodeId: targetNodeId,
          currentNodeType: targetNode.data?.type,
          status: isTerminal ? 'completed' : 'in-progress',
        };
      })
    );
  };

  const refreshWorkflows = () => {
    const fresh = loadWorkflows();
    // Preserve selection if still valid
    if (selectedWfId && !fresh.find((w) => w.id === selectedWfId)) {
      setSelectedWfId(null);
      setTickets([]);
    }
    // Force re-render with new data
    window.location.reload();
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-800">🎮 Workflow Simulator</h1>
        <select
          className="border rounded-lg px-3 py-2 text-sm bg-white"
          value={selectedWfId ?? ''}
          onChange={handleSelectWorkflow}
        >
          <option value="">— Select a workflow —</option>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.nodes.length} nodes)
            </option>
          ))}
        </select>
        <button
          onClick={refreshWorkflows}
          className="text-sm px-3 py-2 rounded-lg border hover:bg-gray-50"
          title="Reload workflows from editor"
        >
          🔄 Refresh
        </button>
        {selectedWorkflow && (
          <button
            onClick={handleCreateTicket}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            + Create Ticket
          </button>
        )}
      </div>

      {!selectedWorkflow ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
          <div className="text-center">
            <p className="text-4xl mb-4">📝</p>
            <p>Select a workflow to start simulating</p>
            <p className="text-sm mt-2">
              Build one in the <strong>Editor</strong> tab first, then come back here
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel — Tickets */}
          <div className="w-1/2 border-r overflow-y-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Active Tickets
            </h2>
            {tickets.length === 0 && (
              <p className="text-gray-400 text-sm">
                Click "Create Ticket" to spawn an entity that moves through the workflow
              </p>
            )}
            {tickets.map((ticket) => {
              const currentNode = selectedWorkflow.nodes.find(
                (n) => n.id === ticket.currentNodeId
              );
              const nextStates = ticket.currentNodeId
                ? getNextStates(selectedWorkflow, ticket.currentNodeId)
                : [];
              const isDecision = nextStates.length > 1;

              return (
                <div
                  key={ticket.id}
                  className={`bg-white rounded-xl border p-4 shadow-sm ${
                    ticket.status === 'completed' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-semibold text-gray-800">{ticket.label}</span>
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        ticket.status === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {ticket.status}
                    </span>
                  </div>

                  {/* Current node */}
                  <div className="mb-3">
                    <span className="text-xs text-gray-500">Current node:</span>
                    <div
                      className={`mt-1 px-3 py-2 rounded-lg border-2 text-sm font-medium ${
                        currentNode?.data?.className || 'bg-gray-100 border-gray-300'
                      }`}
                    >
                      {currentNode?.data?.label || ticket.currentNodeType || '—'}
                    </div>
                    {/* Show configured variables for current node */}
                    {currentNode?.data?.variables && Object.keys(currentNode.data.variables).length > 0 && (
                      <div className="mt-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
                        <span className="text-xs font-medium text-slate-500">⚙ Variables:</span>
                        <div className="mt-1 space-y-0.5">
                          {Object.entries(currentNode.data.variables).map(([key, val]) => (
                            <div key={key} className="text-xs text-slate-600">
                              <span className="font-medium">{key}:</span>{' '}
                              <span className="text-slate-800">{String(val)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Available transitions */}
                  {ticket.status === 'in-progress' && nextStates.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-500">
                        {isDecision ? 'Decision:' : 'Next:'}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {nextStates.map((ns) => {
                          const isYes =
                            ns.edge.sourceHandle === 'true' ||
                            ns.edge.sourceHandle === 'yes';
                          const isNo =
                            ns.edge.sourceHandle === 'false' ||
                            ns.edge.sourceHandle === 'no';
                          let btnClass =
                            'bg-gray-100 hover:bg-gray-200 text-gray-700 border-gray-300';
                          if (isDecision && isYes)
                            btnClass =
                              'bg-green-100 hover:bg-green-200 text-green-700 border-green-300';
                          if (isDecision && isNo)
                            btnClass =
                              'bg-red-100 hover:bg-red-200 text-red-700 border-red-300';

                          return (
                            <button
                              key={ns.nodeId}
                              onClick={() => handleTransition(ticket.id, ns.nodeId)}
                              className={`text-sm px-3 py-1.5 rounded-lg border transition ${btnClass}`}
                            >
                              {isDecision && isYes && '✓ YES → '}
                              {isDecision && isNo && '✗ NO → '}
                              {!isDecision && '→ '}
                              {ns.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {ticket.status === 'completed' && (
                    <p className="text-sm text-green-600 font-medium">
                      ✅ Workflow completed
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right panel — Event Log */}
          <div className="w-1/2 overflow-y-auto p-4 bg-gray-900 text-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                Event Log
              </h2>
              <button
                onClick={() => setLog([])}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Clear
              </button>
            </div>
            {log.length === 0 && (
              <p className="text-gray-600 text-sm">Events will appear here…</p>
            )}
            <div className="space-y-1 font-mono text-xs">
              {log.map((entry, i) => {
                let color = 'text-gray-400';
                if (entry.type === 'transition') color = 'text-blue-400';
                if (entry.type === 'hook') color = 'text-purple-400';
                if (entry.type === 'action') color = 'text-yellow-400';
                if (entry.type === 'info') color = 'text-green-400';
                if (entry.type === 'error') color = 'text-red-400';

                return (
                  <div key={i} className={color}>
                    <span className="text-gray-600">[{entry.time}]</span> {entry.message}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
