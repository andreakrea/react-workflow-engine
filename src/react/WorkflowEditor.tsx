import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
} from 'reactflow';
import type { Blocks, Hooks } from '../core/blocks';
import type { Workflow, WorkflowHook, WorkflowId, WorkflowInput } from '../core/types';
import { validateWorkflow, type ValidationIssue } from '../core/validate';
import type { WorkflowClient } from './client';
import { EditorContext, type EditorContextValue } from './context';
import { createBlockNode, createHook, fromFlow, toFlow, type BlockNodeData, type FlowNode } from './convert';
import { nodeTypes } from './nodes';
import { useHistory } from './useHistory';
import { DND_TYPE, HookInspector, NodeInspector, Sidebar, WorkflowList } from './panels';

/** The editable part of a workflow (what onChange emits and value accepts). */
export interface WorkflowDraft extends WorkflowInput {
  id?: WorkflowId;
}

export interface WorkflowEditorProps<Id extends WorkflowId = WorkflowId> {
  /** Block definitions — the same object you pass to createEngine. */
  blocks: Blocks;
  /** Hook definitions — the same object you pass to createEngine. */
  hooks?: Hooks;
  /** Icons by block or hook id (e.g. SVG components). Fallback: the definition's `icon`, then the label's initial. */
  icons?: Partial<Record<string, ReactNode>>;

  /** Loads and saves workflows (createHttpClient, createLocalClient, or your own). */
  client?: WorkflowClient;
  /** Workflow to open. Omit to start with a new draft. */
  workflowId?: Id | null;
  /** Called when the user opens, creates or saves a different workflow. */
  onWorkflowIdChange?: (id: Id | null) => void;

  /** Controlled mode: the draft to show. Use with onChange; no client required. */
  value?: WorkflowDraft;
  /** Called on every edit with the current draft. */
  onChange?: (draft: WorkflowDraft, issues: ValidationIssue[]) => void;

  onSaved?: (workflow: Workflow) => void;
  onDeleted?: (id: Id) => void;
  onError?: (error: unknown) => void;

  /** Breadcrumb before the workflow name, e.g. "Settings" or a link. */
  title?: ReactNode;
  /** Extra buttons in the header, before Save. */
  headerActions?: ReactNode;
  /** 'light' (default), 'dark', or 'system' to follow prefers-color-scheme. */
  theme?: 'light' | 'dark' | 'system';
  readOnly?: boolean;
  className?: string;
  style?: CSSProperties;
}

type Status = { kind: 'idle' | 'saving' | 'saved' | 'loading' } | { kind: 'error'; message: string };
type Selection = { kind: 'node' | 'hook'; id: string } | null;

/** Comparable snapshot of the persisted parts of the editor state. */
const signature = (name: string, description: string | null, nodes: FlowNode[], edges: Edge[], hooks: WorkflowHook[]) =>
  JSON.stringify({ name, description, ...fromFlow(nodes, edges, hooks) });

const emptyDraft = (blocks: Blocks): WorkflowDraft => {
  const startType = Object.keys(blocks).find((k) => blocks[k].kind === 'start');
  const nodes = startType ? fromFlow([createBlockNode(startType, blocks, { x: 0, y: 0 })], []).nodes : [];
  return { name: 'Untitled workflow', description: null, nodes, edges: [], hooks: [] };
};

const Icon = {
  list: <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  plus: <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  undo: <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M5.5 3.5L2.5 6.5l3 3M2.5 6.5H10a3.5 3.5 0 010 7H7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  redo: <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M10.5 3.5l3 3-3 3M13.5 6.5H6a3.5 3.5 0 000 7h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  chevron: <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4.5 6.5L8 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
};

function Editor(props: WorkflowEditorProps) {
  const { blocks, hooks: hookDefs = {}, client, readOnly = false } = props;
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<BlockNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [hookList, setHookList] = useState<WorkflowHook[]>([]);
  const [name, setName] = useState('Untitled workflow');
  const [description, setDescription] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<WorkflowId | null>(props.workflowId ?? props.value?.id ?? null);
  const [selection, setSelection] = useState<Selection>(null);
  const [savedSig, setSavedSig] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [listOpen, setListOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [list, setList] = useState<Workflow[] | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<WorkflowDraft | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const historyRef = useRef<ReturnType<typeof useHistory> | null>(null);

  const reportError = useCallback((error: unknown) => {
    setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    propsRef.current.onError?.(error);
  }, []);

  const loadDraft = useCallback(
    (draft: WorkflowDraft) => {
      const flow = toFlow(draft, blocks);
      const loaded = signature(draft.name, draft.description ?? null, flow.nodes, flow.edges, flow.hooks);
      setSavedSig(loaded);
      historyRef.current?.reset(loaded);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setHookList(flow.hooks);
      setName(draft.name);
      setDescription(draft.description ?? null);
      setCurrentId(draft.id ?? null);
      setSelection(null);
      requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1.1 }));
    },
    [blocks, rf, setEdges, setNodes],
  );

  // ── Loading ───────────────────────────────────────────────────────────────

  const open = useCallback(
    async (id: WorkflowId | null) => {
      setListOpen(false);
      if (id == null || !client) {
        loadDraft(emptyDraft(blocks));
        if (id == null) propsRef.current.onWorkflowIdChange?.(null);
        return;
      }
      setStatus({ kind: 'loading' });
      try {
        loadDraft(await client.get(id));
        setStatus({ kind: 'idle' });
        if (String(id) !== String(propsRef.current.workflowId)) propsRef.current.onWorkflowIdChange?.(id);
      } catch (e) {
        reportError(e);
      }
    },
    [blocks, client, loadDraft, reportError],
  );

  useEffect(() => {
    if (props.value) return;
    void open(props.workflowId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workflowId]);

  useEffect(() => {
    if (props.value && props.value !== lastEmitted.current) loadDraft(props.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);

  const refreshList = useCallback(async () => {
    if (!client) return;
    try {
      setList(await client.list());
    } catch (e) {
      reportError(e);
    }
  }, [client, reportError]);

  useEffect(() => {
    if (listOpen) void refreshList();
  }, [listOpen, refreshList]);

  // ── Derived draft + validation ────────────────────────────────────────────

  const draft = useMemo<WorkflowDraft>(
    () => ({ ...(currentId != null ? { id: currentId } : {}), name, description, ...fromFlow(nodes, edges, hookList) }),
    [currentId, name, description, nodes, edges, hookList],
  );
  const sig = useMemo(() => signature(name, description, nodes, edges, hookList), [name, description, nodes, edges, hookList]);
  const restore = useCallback(
    (snapshot: string) => {
      const d = JSON.parse(snapshot) as WorkflowDraft;
      const flow = toFlow(d, blocks);
      setNodes(flow.nodes);
      setEdges(flow.edges);
      setHookList(flow.hooks);
      setName(d.name);
      setDescription(d.description ?? null);
      setSelection((sel) => (sel && (sel.kind === 'node' ? flow.nodes : flow.hooks).some((x) => x.id === sel.id) ? sel : null));
    },
    [blocks, setEdges, setNodes],
  );
  const history = useHistory(sig, restore);
  historyRef.current = history;
  // Dirty = differs from what was last loaded or saved, so selecting or undoing an edit doesn't count.
  const dirty = sig !== savedSig;
  const issues = useMemo(() => validateWorkflow(draft, { blocks, hooks: hookDefs }), [draft, blocks, hookDefs]);
  const issuesByNode = useMemo(() => {
    const map = new Map<string, ValidationIssue[]>();
    for (const i of issues) {
      const key = i.nodeId ?? i.hookId;
      if (key) map.set(key, [...(map.get(key) ?? []), i]);
    }
    return map;
  }, [issues]);
  const errorCount = issues.filter((i) => i.level === 'error').length;

  useEffect(() => {
    if (!dirty || !propsRef.current.onChange) return;
    lastEmitted.current = draft;
    propsRef.current.onChange(draft, issues);
  }, [draft, issues, dirty]);

  // ── Editing ───────────────────────────────────────────────────────────────

  const touch = useCallback(() => {
    setStatus((s) => (s.kind === 'saved' || s.kind === 'error' ? { kind: 'idle' } : s));
  }, []);

  const select = useCallback(
    (next: Selection) => {
      setSelection(next);
      setNodes((ns) => ns.map((n) => (n.selected === (next?.kind === 'node' && next.id === n.id) ? n : { ...n, selected: next?.kind === 'node' && next.id === n.id })));
    },
    [setNodes],
  );

  /**
   * Dropped blocks go where they were dropped. Clicked blocks go under the
   * selected node — connected to it when it has a free output — or into a free
   * spot in the middle of the view.
   */
  const addBlock = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      if (readOnly) return;
      const anchor = selection?.kind === 'node' ? nodes.find((n) => n.id === selection.id) : undefined;
      const anchorKind = anchor ? (blocks[anchor.data.type]?.kind ?? 'step') : null;
      const canChain = !!anchor && (anchorKind === 'start' || anchorKind === 'step') && !edges.some((e) => e.source === anchor.id);

      let pos = position;
      if (!pos && canChain) pos = { x: anchor!.position.x, y: anchor!.position.y + 130 };
      if (!pos) {
        const el = canvasRef.current?.getBoundingClientRect();
        pos = rf.screenToFlowPosition(el ? { x: el.left + el.width / 2, y: el.top + el.height / 3 } : { x: 0, y: 0 });
        pos = { x: pos.x - 110, y: pos.y };
      }
      if (!position) {
        while (nodes.some((n) => Math.abs(n.position.x - pos!.x) < 200 && Math.abs(n.position.y - pos!.y) < 80)) pos = { x: pos.x, y: pos.y + 100 };
      }

      const node = createBlockNode(type, blocks, pos);
      historyRef.current?.checkpoint();
      setNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }]);
      if (!position && canChain) setEdges((es) => addEdge({ id: `e_${anchor!.id}_out_${node.id}`, source: anchor!.id, target: node.id, sourceHandle: null, targetHandle: null }, es));
      if (!position) rf.setCenter(pos.x + 110, pos.y + 40, { zoom: rf.getZoom(), duration: 200 });
      setSelection({ kind: 'node', id: node.id });
      setSheetOpen(false);
      touch();
    },
    [blocks, edges, nodes, readOnly, rf, selection, setEdges, setNodes, touch],
  );

  const addHook = useCallback(
    (type: string) => {
      const hook = createHook(type, hookDefs);
      historyRef.current?.checkpoint();
      setHookList((hs) => [...hs, hook]);
      select({ kind: 'hook', id: hook.id });
      touch();
    },
    [hookDefs, select, touch],
  );

  const updateHook = useCallback(
    (hook: WorkflowHook) => {
      setHookList((hs) => hs.map((h) => (h.id === hook.id ? hook : h)));
      touch();
    },
    [touch],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DND_TYPE);
      if (!raw) return;
      const { type } = JSON.parse(raw) as { type: string };
      addBlock(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    },
    [addBlock, rf],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (readOnly || !c.source || !c.target || c.source === c.target) return;
      historyRef.current?.checkpoint();
      setEdges((es) => {
        // A decision branch leads to exactly one node: reconnecting replaces it.
        const kept = c.sourceHandle ? es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle)) : es;
        return addEdge({ ...c, id: `e_${c.source}_${c.sourceHandle ?? 'out'}_${c.target}` }, kept);
      });
      touch();
    },
    [readOnly, setEdges, touch],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<BlockNodeData>) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
      touch();
    },
    [setNodes, touch],
  );

  const forgetNodes = useCallback((ids: string[]) => {
    setHookList((hs) => hs.map((h) => (Array.isArray(h.scope) && h.scope.some((x) => ids.includes(x)) ? { ...h, scope: h.scope.filter((x) => !ids.includes(x)) } : h)));
  }, []);

  const deleteNode = useCallback(
    (id: string) => {
      historyRef.current?.checkpoint();
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      forgetNodes([id]);
      setSelection(null);
      touch();
    },
    [forgetNodes, setEdges, setNodes, touch],
  );

  // ── Saving ────────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!client || readOnly) return;
    setStatus({ kind: 'saving' });
    const { id: _id, ...body } = draft;
    try {
      const saved = currentId != null ? await client.update(currentId, body) : await client.create(body);
      setCurrentId(saved.id);
      setSavedSig(sig);
      setStatus({ kind: 'saved' });
      if (String(saved.id) !== String(currentId)) propsRef.current.onWorkflowIdChange?.(saved.id);
      propsRef.current.onSaved?.(saved);
      if (listOpen) void refreshList();
    } catch (e) {
      reportError(e);
    }
  }, [client, currentId, draft, listOpen, readOnly, refreshList, reportError, sig]);

  const remove = useCallback(
    async (id: WorkflowId) => {
      if (!client) return;
      try {
        await client.remove(id);
        propsRef.current.onDeleted?.(id);
        if (String(id) === String(currentId)) await open(null);
        void refreshList();
      } catch (e) {
        reportError(e);
      }
    },
    [client, currentId, open, refreshList, reportError],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 's' && client && dirty) {
        e.preventDefault();
        void save();
      }
      // Leave text fields to the browser's own undo.
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (mod && !typing && !readOnly && (key === 'z' || key === 'y')) {
        e.preventDefault();
        if (key === 'y' || e.shiftKey) history.redo();
        else history.undo();
      }
      if (e.key === 'Escape') {
        setListOpen(false);
        setIssuesOpen(false);
        setSheetOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client, dirty, history, readOnly, save]);

  // ── Rendering helpers ─────────────────────────────────────────────────────

  const selectedNode = selection?.kind === 'node' ? nodes.find((n) => n.id === selection.id) : undefined;
  const selectedHook = selection?.kind === 'hook' ? hookList.find((h) => h.id === selection.id) : undefined;
  const ctx: EditorContextValue = useMemo(
    () => ({ blocks, hooks: hookDefs, icons: props.icons ?? {}, issuesByNode, readOnly }),
    [blocks, hookDefs, props.icons, issuesByNode, readOnly],
  );

  const statusText =
    status.kind === 'saving' ? 'Saving…'
    : status.kind === 'loading' ? 'Loading…'
    : status.kind === 'error' ? `Not saved: ${status.message}`
    : status.kind === 'saved' && !dirty ? 'All changes saved'
    : dirty ? 'Unsaved changes'
    : '';

  const focusIssue = (i: ValidationIssue) => {
    setIssuesOpen(false);
    if (i.hookId) return select({ kind: 'hook', id: i.hookId });
    if (!i.nodeId) return;
    select({ kind: 'node', id: i.nodeId });
    const n = rf.getNode(i.nodeId);
    if (n) rf.setCenter(n.position.x + 110, n.position.y + 40, { zoom: Math.max(rf.getZoom(), 1), duration: 250 });
  };

  return (
    <EditorContext.Provider value={ctx}>
      <div className={`vwe-root${props.className ? ` ${props.className}` : ''}`} data-theme={props.theme ?? 'light'} style={props.style}>
        <header className="vwe-bar">
          <div className="vwe-bar__left">
            {props.title && (
              <>
                <span className="vwe-crumb">{props.title}</span>
                <span className="vwe-crumb-sep" aria-hidden>/</span>
              </>
            )}
            <input
              className="vwe-name"
              aria-label="Workflow name"
              value={name}
              disabled={readOnly}
              onChange={(e) => {
                setName(e.target.value);
                touch();
              }}
            />
            <span className={`vwe-status${status.kind === 'error' ? ' is-error' : dirty ? ' is-dirty' : ''}`} role="status">{statusText}</span>
          </div>
          <div className="vwe-bar__right">
            {!readOnly && (
              <div className="vwe-btn-group">
                <button type="button" className="vwe-icon-btn" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">{Icon.undo}</button>
                <button type="button" className="vwe-icon-btn" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">{Icon.redo}</button>
              </div>
            )}
            {!readOnly && (
              <button type="button" className="vwe-btn vwe-only-mobile" aria-expanded={sheetOpen} onClick={() => setSheetOpen((o) => !o)}>
                {Icon.plus} Add
              </button>
            )}
            {issues.length > 0 && (
              <button type="button" className={`vwe-pill${errorCount ? ' is-error' : ' is-warning'}`} aria-expanded={issuesOpen} onClick={() => setIssuesOpen((o) => !o)}>
                <span className="vwe-pill__label">Problems</span>
                <span className="vwe-pill__value">{errorCount ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : `${issues.length} warning${issues.length > 1 ? 's' : ''}`}</span>
                {Icon.chevron}
              </button>
            )}
            {client && (
              <button type="button" className="vwe-btn" aria-expanded={listOpen} onClick={() => setListOpen((o) => !o)}>
                {Icon.list}
                <span className="vwe-hide-mobile">Workflows</span>
              </button>
            )}
            {props.headerActions}
            {client && !readOnly && (
              <button type="button" className="vwe-btn vwe-btn--primary" disabled={!dirty || status.kind === 'saving'} onClick={() => void save()}>
                Save
              </button>
            )}
          </div>
          {listOpen && (
            <WorkflowList
              workflows={list}
              currentId={currentId}
              dirty={dirty}
              onOpen={(id) => void open(id)}
              onNew={() => void open(null)}
              onDelete={(id) => void remove(id)}
              onClose={() => setListOpen(false)}
            />
          )}
          {issuesOpen && issues.length > 0 && (
            <div className="vwe-popover vwe-popover--issues" role="dialog" aria-label="Problems">
              <div className="vwe-popover__head">
                <strong>Problems</strong>
                <span className="vwe-muted">Workflows with errors can be saved but not run.</span>
              </div>
              <ul className="vwe-issues vwe-pad">
                {issues.map((i, k) => (
                  <li key={k} className={`vwe-issue vwe-issue--${i.level}`}>
                    <span className="vwe-issue__tag">{i.level === 'error' ? 'Error' : 'Warning'}</span>
                    {i.nodeId || i.hookId ? (
                      <button type="button" className="vwe-link" onClick={() => focusIssue(i)}>{i.message}</button>
                    ) : (
                      i.message
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </header>

        <div className="vwe-body">
          <div className={`vwe-sheet vwe-sheet--left${sheetOpen ? ' is-open' : ''}`}>
            <Sidebar
              hooksInUse={hookList}
              selectedHookId={selection?.kind === 'hook' ? selection.id : null}
              issuesByNode={issuesByNode}
              onAddBlock={(type) => addBlock(type)}
              onAddHook={(type) => {
                addHook(type);
                setSheetOpen(false);
              }}
              onSelectHook={(id) => {
                select({ kind: 'hook', id });
                setSheetOpen(false);
              }}
              onToggleHook={(id, enabled) => {
                const h = hookList.find((x) => x.id === id);
                if (h) updateHook({ ...h, enabled });
              }}
            />
          </div>
          <div ref={canvasRef} className="vwe-canvas" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                if (changes.some((c) => c.type === 'remove')) historyRef.current?.checkpoint();
                onNodesChange(changes);
                const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
                if (removed.length) {
                  forgetNodes(removed);
                  if (selection?.kind === 'node' && removed.includes(selection.id)) setSelection(null);
                }
                if (changes.some((c) => c.type === 'position' || c.type === 'remove')) touch();
              }}
              onEdgesChange={(changes) => {
                if (changes.some((c) => c.type === 'remove')) historyRef.current?.checkpoint();
                onEdgesChange(changes);
                if (changes.some((c) => c.type === 'remove')) touch();
              }}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelection({ kind: 'node', id: n.id })}
              onPaneClick={() => setSelection(null)}
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              elementsSelectable
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }, type: 'smoothstep' }}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--vwe-dots)" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeBorderRadius={6} maskColor="var(--vwe-minimap-mask)" style={{ width: 168, height: 112 }} />
            </ReactFlow>
            {nodes.length === 0 && !readOnly && (
              <div className="vwe-empty">
                <strong>This workflow is empty</strong>
                <span>Add a start block from the list on the left, then connect the next steps.</span>
              </div>
            )}
          </div>
          {selectedNode && (
            <div className="vwe-sheet vwe-sheet--right is-open">
              <NodeInspector node={selectedNode} issues={issuesByNode.get(selectedNode.id) ?? []} onChange={updateNode} onDelete={deleteNode} onClose={() => select(null)} />
            </div>
          )}
          {selectedHook && (
            <div className="vwe-sheet vwe-sheet--right is-open">
              <HookInspector
                hook={selectedHook}
                nodes={nodes}
                issues={issuesByNode.get(selectedHook.id) ?? []}
                onChange={updateHook}
                onDelete={(id) => {
                  historyRef.current?.checkpoint();
                  setHookList((hs) => hs.filter((h) => h.id !== id));
                  setSelection(null);
                  touch();
                }}
                onClose={() => select(null)}
              />
            </div>
          )}
          {sheetOpen && <button type="button" className="vwe-scrim vwe-only-mobile" aria-label="Close" onClick={() => setSheetOpen(false)} />}
        </div>
      </div>
    </EditorContext.Provider>
  );
}

/**
 * Drag-and-drop workflow editor. Fills its parent — give the parent a height.
 *
 *   <div style={{ height: 600 }}>
 *     <WorkflowEditor blocks={blocks} hooks={hooks} client={createHttpClient({ baseUrl: '/api/workflows' })} />
 *   </div>
 */
export function WorkflowEditor<Id extends WorkflowId = WorkflowId>(props: WorkflowEditorProps<Id>) {
  return (
    <ReactFlowProvider>
      <Editor {...(props as unknown as WorkflowEditorProps)} />
    </ReactFlowProvider>
  );
}
