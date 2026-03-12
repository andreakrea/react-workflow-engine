import { useCallback, useRef, useState, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  ReactFlowProvider,
  BackgroundVariant,
  Handle,
  Position,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { WorkflowEditorProps, BlockType } from './types';

// ─── Custom ReactFlow node components ────────────────────────────────────────

function DecisionNode({ data }: NodeProps) {
  return (
    <div className={`${data.className} relative min-w-[180px]`}>
      <Handle
        type="target"
        position={Position.Top}
        id="input"
        className="w-3 h-3 !bg-slate-400 border-2 border-white"
      />
      <div className="px-4 py-3 text-center">{data.label}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        style={{ left: '35%' }}
        className="w-3 h-3 !bg-green-500 border-2 border-white"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        style={{ left: '65%' }}
        className="w-3 h-3 !bg-red-500 border-2 border-white"
      />
      <div className="absolute bottom-[-20px] left-[calc(35%-1rem)] text-xs font-semibold text-green-600">
        ✓ YES
      </div>
      <div className="absolute bottom-[-20px] left-[calc(65%-1rem)] text-xs font-semibold text-red-600">
        ✗ NO
      </div>
    </div>
  );
}

function StandardNode({ data }: NodeProps) {
  return (
    <div className={`${data.className} relative min-w-[180px]`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-slate-400 border-2 border-white"
      />
      <div className="px-4 py-3 text-center">{data.label}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-blue-500 border-2 border-white"
      />
    </div>
  );
}

function TerminalNode({ data }: NodeProps) {
  return (
    <div className={`${data.className} relative min-w-[180px]`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-slate-400 border-2 border-white"
      />
      <div className="px-4 py-3 text-center">{data.label}</div>
    </div>
  );
}

function HookNode({ data }: NodeProps) {
  return (
    <div className="relative min-w-[200px] border-2 border-dashed border-purple-400 bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg shadow-lg">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">{data.icon || '🪝'}</span>
          <div className="text-xs font-bold text-purple-600 uppercase tracking-wide">Hook</div>
        </div>
        <div className="text-sm font-semibold text-slate-800 mb-1">{data.label}</div>
        <div className="text-xs text-purple-600 font-medium">
          Trigger: {data.trigger || 'on_message'}
        </div>
        {data.scope && data.scope !== 'all' && (
          <div className="text-xs text-slate-500 mt-1">
            Scope: {Array.isArray(data.scope) ? data.scope.join(', ') : data.scope}
          </div>
        )}
      </div>
      <div className="absolute top-2 right-2">
        <div
          className={`w-2 h-2 rounded-full ${data.enabled !== false ? 'bg-green-500' : 'bg-gray-400'}`}
          title={data.enabled !== false ? 'Enabled' : 'Disabled'}
        />
      </div>
    </div>
  );
}

const nodeTypes = {
  decision: DecisionNode,
  standard: StandardNode,
  terminal: TerminalNode,
  hook: HookNode,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getNextNodeId(existingNodes: Node[]): number {
  const ids = existingNodes
    .map(n => {
      const m = n.id.match(/node_(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(id => !isNaN(id));
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

// ─── Canvas (inner component, receives all props) ─────────────────────────────

interface CanvasProps extends WorkflowEditorProps {}

function WorkflowCanvas({ apiUrl, blockTypes, hookTypes, onBack, title }: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const [savedWorkflows, setSavedWorkflows] = useState<any[]>([]);
  const [showWorkflowList, setShowWorkflowList] = useState(false);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<number | null>(null);

  // nodeId counter — module-level is not safe in an exported component, so use a ref
  const nodeIdRef = useRef(1);

  useEffect(() => {
    loadWorkflows();
  }, []);

  // ── API helpers ─────────────────────────────────────────────────────────────

  function apiRoute(path: string) {
    return `${apiUrl.replace(/\/$/, '')}${path}`;
  }

  // ── Reconstruct hook nodes from the stored hooks[] config ───────────────────

  function buildHookNodes(hooks: any[], startIndex: number): Node[] {
    return (hooks || []).map((hook: any, i: number) => ({
      id: hook.id || `hook_${startIndex + i + 1000}`,
      type: 'hook',
      position: hook.position || { x: 50, y: 50 + i * 150 },
      data: {
        label: hook.label || hookTypes.find(ht => ht.id === hook.type)?.label || hook.type,
        type: hook.type,
        icon: hookTypes.find(ht => ht.id === hook.type)?.icon || '🪝',
        trigger: hook.trigger,
        scope: hook.scope,
        enabled: hook.enabled,
        config: hook.config || {},
        className: 'bg-purple-50 border-purple-300 text-purple-900 border-2 rounded-lg shadow-md',
      },
    }));
  }

  // ── Load / save ─────────────────────────────────────────────────────────────

  const loadWorkflows = async () => {
    try {
      const res = await fetch(apiRoute('/api/workflows'));
      const data = await res.json();
      if (!data.success) return;

      setSavedWorkflows(data.workflows);

      // Auto-load first workflow on mount
      if (data.workflows.length > 0 && currentWorkflowId === null) {
        const first = data.workflows[0];
        const workflowNodes: Node[] = first.nodes || [];
        const hookNodes = buildHookNodes(first.hooks || [], 0);
        const combined = [...workflowNodes, ...hookNodes];
        setNodes(combined);
        setEdges(first.edges || []);
        setCurrentWorkflowId(first.id);
        nodeIdRef.current = getNextNodeId(combined);
      }
    } catch (err) {
      console.error('WorkflowEditor: error loading workflows', err);
    }
  };

  const loadWorkflow = (workflow: any) => {
    const workflowNodes: Node[] = workflow.nodes || [];
    const hookNodes = buildHookNodes(workflow.hooks || [], 0);
    const combined = [...workflowNodes, ...hookNodes];
    setNodes(combined);
    setEdges(workflow.edges || []);
    setCurrentWorkflowId(workflow.id);
    setShowWorkflowList(false);
    nodeIdRef.current = getNextNodeId(combined);
  };

  const deleteWorkflow = async (workflowId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this workflow?')) return;
    try {
      const res = await fetch(apiRoute(`/api/workflows/${workflowId}`), { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert('Workflow deleted.');
        loadWorkflows();
      } else {
        alert(`Failed: ${data.error}`);
      }
    } catch (err) {
      console.error('WorkflowEditor: error deleting workflow', err);
    }
  };

  const clearWorkflow = () => {
    setNodes([]);
    setEdges([]);
    setCurrentWorkflowId(null);
    nodeIdRef.current = 1;
  };

  const saveWorkflow = async () => {
    const workflowNodes = nodes.filter(n => !n.id.startsWith('hook_'));
    const hookNodes = nodes.filter(n => n.id.startsWith('hook_'));

    const hooks = hookNodes.map(n => ({
      id: n.id,
      type: n.data.type,
      label: n.data.label,
      trigger: n.data.trigger || 'on_message',
      scope: n.data.scope || 'all',
      enabled: n.data.enabled !== false,
      config: n.data.config || {},
    }));

    if (currentWorkflowId) {
      try {
        const res = await fetch(apiRoute(`/api/workflows/${currentWorkflowId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodes: workflowNodes, edges, hooks }),
        });
        const data = await res.json();
        if (data.success) {
          alert('Workflow updated!');
          loadWorkflows();
        } else {
          alert(`Failed: ${data.error}`);
        }
      } catch (err) {
        console.error('WorkflowEditor: error updating workflow', err);
      }
    } else {
      try {
        const res = await fetch(apiRoute('/api/workflows'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Workflow ${new Date().toISOString()}`,
            description: '',
            nodes: workflowNodes,
            edges,
            hooks,
          }),
        });
        const data = await res.json();
        if (data.success) {
          alert('Workflow saved!');
          setCurrentWorkflowId(data.workflow.id);
          loadWorkflows();
        } else {
          alert(`Failed: ${data.error}`);
        }
      } catch (err) {
        console.error('WorkflowEditor: error saving workflow', err);
      }
    }
  };

  // ── ReactFlow callbacks ───────────────────────────────────────────────────

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges(eds => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const type = e.dataTransfer.getData('application/reactflow');
      const blockData: BlockType = JSON.parse(e.dataTransfer.getData('application/blockdata'));

      if (!type || !reactFlowInstance) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      if (blockData.nodeType === 'hook') {
        const newNode: Node = {
          id: `hook_${nodeIdRef.current++}`,
          type: 'hook',
          position,
          data: {
            label: blockData.label,
            type: blockData.id,
            icon: blockData.icon,
            trigger: blockData.trigger || 'on_message',
            scope: 'all',
            enabled: true,
            className: `${blockData.color} border-2 rounded-lg shadow-md`,
          },
        };
        setNodes(nds => [...nds, newNode]);
      } else {
        const newNode: Node = {
          id: `node_${nodeIdRef.current++}`,
          type: blockData.nodeType || 'standard',
          position,
          data: {
            label: `${blockData.icon} ${blockData.label}`,
            type: blockData.id,
            className: `${blockData.color} border-2 rounded-lg shadow-md`,
          },
        };
        setNodes(nds => [...nds, newNode]);
      }
    },
    [reactFlowInstance]
  );

  const onDragStart = (e: React.DragEvent, block: BlockType) => {
    e.dataTransfer.setData('application/reactflow', 'default');
    e.dataTransfer.setData('application/blockdata', JSON.stringify(block));
    e.dataTransfer.effectAllowed = 'move';
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-full px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {onBack && (
                <>
                  <button
                    onClick={onBack}
                    className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    Back
                  </button>
                  <div className="h-6 w-px bg-slate-300" />
                </>
              )}
              <h1 className="text-xl font-bold text-slate-900">{title || 'Workflow Editor'}</h1>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowWorkflowList(v => !v)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                {showWorkflowList ? 'Hide' : 'Load'} Workflows
              </button>
              <button
                onClick={clearWorkflow}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Clear
              </button>
              <button
                onClick={saveWorkflow}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
              >
                {currentWorkflowId ? 'Update Workflow' : 'Save Workflow'}
              </button>
            </div>
          </div>

          {currentWorkflowId && (
            <div className="mt-2 text-xs text-slate-600">
              Editing:{' '}
              {savedWorkflows.find(w => w.id === currentWorkflowId)?.name ||
                `Workflow #${currentWorkflowId}`}
            </div>
          )}
        </div>
      </div>

      {/* Workflow list dropdown */}
      {showWorkflowList && (
        <div className="absolute top-20 right-6 z-50 w-96 bg-white border border-slate-200 rounded-lg shadow-xl max-h-96 overflow-y-auto">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h3 className="font-semibold text-slate-900">
              Saved Workflows ({savedWorkflows.length})
            </h3>
          </div>
          <div className="p-2">
            {savedWorkflows.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">No saved workflows yet</div>
            ) : (
              <div className="space-y-2">
                {savedWorkflows.map(workflow => (
                  <div
                    key={workflow.id}
                    className={`p-3 hover:bg-slate-50 rounded-lg cursor-pointer border transition-colors group ${
                      workflow.id === currentWorkflowId
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200'
                    }`}
                    onClick={() => loadWorkflow(workflow)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-slate-900 text-sm truncate">
                            {workflow.name}
                          </div>
                          {workflow.id === currentWorkflowId && (
                            <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {workflow.nodes?.length || 0} nodes · {workflow.edges?.length || 0} edges
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {new Date(workflow.created_at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={e => deleteWorkflow(workflow.id, e)}
                        className="ml-2 p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete workflow"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex h-[calc(100vh-73px)]">
        {/* Palette */}
        <div className="w-80 bg-white border-r border-slate-200 overflow-y-auto shadow-lg">
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Workflow Blocks</h2>
              <p className="text-xs text-slate-600 mb-4">Drag blocks to canvas to build your workflow</p>
            </div>

            <div className="space-y-3 mb-8">
              {blockTypes.map(block => (
                <div
                  key={block.id}
                  draggable
                  onDragStart={e => onDragStart(e, block)}
                  className={`${block.color} border-2 rounded-lg p-4 cursor-move hover:shadow-lg transition-all hover:scale-105 active:scale-95`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{block.icon}</span>
                    <span className="font-semibold">{block.label}</span>
                  </div>
                  <p className="text-xs opacity-75">{block.description}</p>
                </div>
              ))}
            </div>

            {hookTypes.length > 0 && (
              <div className="border-t border-slate-200 pt-6">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
                    <span>🪝</span>
                    <span>Lifecycle Hooks</span>
                  </h2>
                  <p className="text-xs text-slate-600">
                    Hooks run independently at specific lifecycle triggers
                  </p>
                </div>
                <div className="space-y-3">
                  {hookTypes.map(hook => (
                    <div
                      key={hook.id}
                      draggable
                      onDragStart={e => onDragStart(e, hook)}
                      className="border-2 border-dashed border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 cursor-move hover:shadow-lg transition-all hover:scale-105 active:scale-95"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-2xl">{hook.icon}</span>
                        <span className="font-semibold text-sm text-purple-900">{hook.label}</span>
                      </div>
                      <p className="text-xs text-purple-700 mb-2">{hook.description}</p>
                      <div className="text-xs text-purple-600 font-medium">
                        Trigger: {hook.trigger}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setReactFlowInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            className="bg-slate-50"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
            <Controls className="bg-white border border-slate-300 rounded-lg shadow-lg" />
            <MiniMap
              className="bg-white border border-slate-300 rounded-lg shadow-lg"
              nodeColor={node => {
                const block = blockTypes.find(b => b.id === node.data?.type);
                if (!block) return '#e2e8f0';
                // Extract first bg- class color name for MiniMap
                const match = block.color.match(/bg-(\w+)-\d+/);
                return match ? match[0] : '#e2e8f0';
              }}
            />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}

// ─── Public export (wrapped in ReactFlowProvider) ─────────────────────────────

export default function WorkflowEditor(props: WorkflowEditorProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas {...props} />
    </ReactFlowProvider>
  );
}
