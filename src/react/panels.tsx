import { useEffect, useId, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { BlockDef, BlockKind, VariableSpec, VariableSpecs } from '../core/blocks';
import type { Workflow, WorkflowHook, WorkflowId } from '../core/types';
import type { ValidationIssue } from '../core/validate';
import { useEditorContext } from './context';
import type { BlockNodeData, FlowNode } from './convert';
import { IconChip, KIND_LABEL } from './nodes';

export const DND_TYPE = 'application/x-vise-workflow-block';

const TRIGGER_LABEL: Record<string, string> = {
  on_node_entry: 'When a node is entered',
  on_node_exit: 'When a node is left',
  on_transition: 'On every transition',
  on_message: 'On each message',
};
const TRIGGER_SHORT: Record<string, string> = { on_node_entry: 'on entry', on_node_exit: 'on exit', on_transition: 'on move', on_message: 'on message' };
export const triggerLabel = (t: string) => TRIGGER_LABEL[t] ?? t.replace(/_/g, ' ');
const triggerShort = (t: string) => TRIGGER_SHORT[t] ?? t.replace(/_/g, ' ');

// ─── Fields ───────────────────────────────────────────────────────────────────

function NumberInput({ id, value, onChange, disabled, placeholder, invalid }: { id: string; value: unknown; onChange: (v: number | undefined) => void; disabled?: boolean; placeholder?: string; invalid?: boolean }) {
  const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
  useEffect(() => {
    if (Number(text) !== value && !(text === '' && value === undefined)) setText(value === undefined || value === null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      className="vwe-input vwe-input--num"
      type="number"
      step="any"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === '') onChange(undefined);
        else if (!Number.isNaN(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
      }}
    />
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className="vwe-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="vwe-switch__track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

function Field({ name, spec, value, onChange, disabled }: { name: string; spec: VariableSpec; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const id = useId();
  const helpId = useId();
  const label = spec.label ?? name;
  const missing = spec.required && (value === undefined || value === null || value === '');
  const common = { id, disabled, placeholder: spec.placeholder, 'aria-invalid': missing || undefined, 'aria-describedby': spec.description || missing ? helpId : undefined };

  if (spec.kind === 'boolean') {
    return (
      <div className="vwe-field">
        <Switch checked={!!value} onChange={onChange} label={label} disabled={disabled} />
        {spec.description && <p className="vwe-help">{spec.description}</p>}
      </div>
    );
  }

  return (
    <div className="vwe-field">
      <label htmlFor={id} className="vwe-label">
        {label}
        {spec.required && <span className="vwe-required"> required</span>}
      </label>
      {spec.kind === 'text' ? (
        <textarea {...common} className="vwe-input" rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : spec.kind === 'number' ? (
        <NumberInput {...common} invalid={missing} value={value} onChange={onChange} />
      ) : spec.kind === 'select' ? (
        <select {...common} className="vwe-input vwe-select" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          {(!spec.required || value === undefined) && <option value="">Choose…</option>}
          {(spec.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input {...common} className="vwe-input" type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {(missing || spec.description) && (
        <p id={helpId} className={`vwe-help${missing ? ' vwe-help--error' : ''}`}>
          {missing ? `${label} is required to run this workflow.` : spec.description}
        </p>
      )}
    </div>
  );
}

function Fields({ specs, values, onChange, disabled }: { specs?: VariableSpecs; values: Record<string, unknown>; onChange: (name: string, v: unknown) => void; disabled?: boolean }) {
  return (
    <>
      {Object.entries(specs ?? {}).map(([name, spec]) => (
        <Field key={name} name={name} spec={spec} value={values[name]} onChange={(v) => onChange(name, v)} disabled={disabled} />
      ))}
    </>
  );
}

// ─── Inspector (right panel) ──────────────────────────────────────────────────

function InspectorShell({ kicker, title, chip, onClose, children, footer }: { kicker: string; title: string; chip: ReactNode; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  return (
    <aside className="vwe-inspector" aria-label={`${title} settings`}>
      <div className="vwe-inspector__head">
        {chip}
        <div className="vwe-inspector__titles">
          <div className="vwe-inspector__kicker">{kicker}</div>
          <h2 className="vwe-inspector__title">{title}</h2>
        </div>
        <button type="button" className="vwe-icon-btn" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="vwe-inspector__body">{children}</div>
      <div className="vwe-inspector__foot">{footer}</div>
    </aside>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="vwe-issues">
      {issues.map((i, k) => (
        <li key={k} className={`vwe-issue vwe-issue--${i.level}`}>
          <span className="vwe-issue__tag">{i.level === 'error' ? 'Error' : 'Warning'}</span>
          {i.message}
        </li>
      ))}
    </ul>
  );
}

export function NodeInspector({ node, issues, onChange, onDelete, onClose }: {
  node: FlowNode;
  issues: ValidationIssue[];
  onChange: (id: string, patch: Partial<BlockNodeData>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { blocks, readOnly } = useEditorContext();
  const labelId = useId();
  const d = node.data;
  const def: BlockDef | undefined = blocks[d.type];
  const title = d.label || def?.label || d.type;
  return (
    <InspectorShell
      kicker={def ? `${KIND_LABEL[def.kind]}${d.label ? ` · ${def.label}` : ''}` : 'Unknown block'}
      title={title}
      chip={<IconChip id={d.type} icon={def?.icon} label={title} color={def?.color} />}
      onClose={onClose}
      footer={
        <>
          <span className="vwe-meta">ID {node.id}</span>
          {!readOnly && <button type="button" className="vwe-btn vwe-btn--ghost-danger" onClick={() => onDelete(node.id)}>Delete node</button>}
        </>
      }
    >
      {def?.description && <p className="vwe-muted">{def.description}</p>}
      <IssueList issues={issues} />
      <div className="vwe-field">
        <label className="vwe-label" htmlFor={labelId}>Label</label>
        <input id={labelId} className="vwe-input" value={d.label ?? ''} placeholder={def?.label ?? d.type} disabled={readOnly} onChange={(e) => onChange(node.id, { label: e.target.value || undefined })} />
      </div>
      {def?.variables && Object.keys(def.variables).length > 0 && (
        <section className="vwe-group">
          <h3 className="vwe-group__title">Settings</h3>
          <Fields specs={def.variables} values={d.variables ?? {}} disabled={readOnly} onChange={(k, v) => onChange(node.id, { variables: { ...d.variables, [k]: v } })} />
        </section>
      )}
    </InspectorShell>
  );
}

export function HookInspector({ hook, nodes, issues, onChange, onDelete, onClose }: {
  hook: WorkflowHook;
  nodes: FlowNode[];
  issues: ValidationIssue[];
  onChange: (hook: WorkflowHook) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { blocks, hooks, readOnly } = useEditorContext();
  const def = hooks[hook.type];
  const title = hook.label || def?.label || hook.type;
  const set = (patch: Partial<WorkflowHook>) => onChange({ ...hook, ...patch });
  const scope = Array.isArray(hook.scope) ? hook.scope : null;
  return (
    <InspectorShell
      kicker={`Hook · ${triggerLabel(hook.trigger)}`}
      title={title}
      chip={<IconChip id={hook.type} icon={def?.icon} label={title} color={def?.color} />}
      onClose={onClose}
      footer={
        <>
          <span className="vwe-meta">ID {hook.id}</span>
          {!readOnly && <button type="button" className="vwe-btn vwe-btn--ghost-danger" onClick={() => onDelete(hook.id)}>Remove hook</button>}
        </>
      }
    >
      {def?.description && <p className="vwe-muted">{def.description}</p>}
      <IssueList issues={issues} />
      <Switch checked={hook.enabled !== false} disabled={readOnly} onChange={(v) => set({ enabled: v })} label="Enabled" />
      <fieldset className="vwe-group" disabled={readOnly}>
        <legend className="vwe-group__title">Runs on</legend>
        <div className="vwe-segmented" role="radiogroup">
          <label className={`vwe-segmented__item${!scope ? ' is-active' : ''}`}>
            <input type="radio" checked={!scope} onChange={() => set({ scope: 'all' })} /> Every node
          </label>
          <label className={`vwe-segmented__item${scope ? ' is-active' : ''}`}>
            <input type="radio" checked={!!scope} onChange={() => set({ scope: [] })} /> Selected nodes
          </label>
        </div>
        {scope && (
          <div className="vwe-checklist">
            {nodes.length === 0 && <p className="vwe-muted">Add nodes to the canvas first.</p>}
            {nodes.map((n) => {
              const checked = scope.includes(n.id);
              return (
                <label key={n.id} className="vwe-check">
                  <input type="checkbox" checked={checked} onChange={() => set({ scope: checked ? scope.filter((x) => x !== n.id) : [...scope, n.id] })} />
                  <span>{n.data.label || blocks[n.data.type]?.label || n.data.type}</span>
                </label>
              );
            })}
          </div>
        )}
      </fieldset>
      {def?.config && Object.keys(def.config).length > 0 && (
        <section className="vwe-group">
          <h3 className="vwe-group__title">Settings</h3>
          <Fields specs={def.config} values={hook.config ?? {}} disabled={readOnly} onChange={(k, v) => set({ config: { ...hook.config, [k]: v } })} />
        </section>
      )}
    </InspectorShell>
  );
}

// ─── Sidebar (left panel) ─────────────────────────────────────────────────────

const KIND_ORDER: Array<[BlockKind, string]> = [
  ['start', 'Start'],
  ['step', 'Steps'],
  ['decision', 'Decisions'],
  ['end', 'End states'],
];

export interface SidebarProps {
  hooksInUse: WorkflowHook[];
  selectedHookId: string | null;
  issuesByNode: Map<string, ValidationIssue[]>;
  onAddBlock: (type: string) => void;
  onAddHook: (type: string) => void;
  onSelectHook: (id: string) => void;
  onToggleHook: (id: string, enabled: boolean) => void;
}

export function Sidebar({ hooksInUse, selectedHookId, issuesByNode, onAddBlock, onAddHook, onSelectHook, onToggleHook }: SidebarProps) {
  const { blocks, hooks, readOnly } = useEditorContext();
  const [tab, setTab] = useState<'blocks' | 'hooks'>('blocks');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const hookDefs = Object.entries(hooks);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (id: string, d: BlockDef) => !q || [id, d.label, d.description ?? ''].some((s) => s.toLowerCase().includes(q));
    return KIND_ORDER.map(([kind, title]) => ({ title, items: Object.entries(blocks).filter(([id, d]) => d.kind === kind && match(id, d)) })).filter((g) => g.items.length);
  }, [blocks, query]);

  const drag = (e: DragEvent, type: string) => {
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'block', type }));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <nav className="vwe-sidebar" aria-label="Blocks and hooks">
      {hookDefs.length > 0 && (
        <div className="vwe-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'blocks'} className={`vwe-tab${tab === 'blocks' ? ' is-active' : ''}`} onClick={() => setTab('blocks')}>Blocks</button>
          <button type="button" role="tab" aria-selected={tab === 'hooks'} className={`vwe-tab${tab === 'hooks' ? ' is-active' : ''}`} onClick={() => setTab('hooks')}>
            Hooks{hooksInUse.length > 0 && <span className="vwe-count">{hooksInUse.length}</span>}
          </button>
        </div>
      )}

      {tab === 'blocks' ? (
        <>
          <label htmlFor={searchId} className="vwe-sr-only">Search blocks</label>
          <input id={searchId} className="vwe-input vwe-search" type="search" placeholder="Search blocks" value={query} onChange={(e) => setQuery(e.target.value)} />
          {groups.length === 0 && <p className="vwe-muted vwe-pad-y">No block matches “{query}”.</p>}
          {groups.map((g) => (
            <section key={g.title} className="vwe-sidebar__group">
              <h3 className="vwe-sidebar__title">{g.title}</h3>
              <ul className="vwe-items">
                {g.items.map(([type, d]) => (
                  <li key={type}>
                    <button
                      type="button"
                      className="vwe-item"
                      draggable={!readOnly}
                      disabled={readOnly}
                      onDragStart={(e) => drag(e, type)}
                      onClick={() => onAddBlock(type)}
                      title={d.description ? `${d.description} — click to add, or drag onto the canvas` : 'Click to add, or drag onto the canvas'}
                    >
                      <IconChip id={type} icon={d.icon} label={d.label} color={d.color} size="sm" />
                      <span className="vwe-item__label">{d.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!readOnly && <p className="vwe-hint">Click a block to add it under the selected node, or drag it onto the canvas.</p>}
        </>
      ) : (
        <>
          <section className="vwe-sidebar__group">
            <h3 className="vwe-sidebar__title">In this workflow</h3>
            {hooksInUse.length === 0 ? (
              <p className="vwe-muted">No hooks yet. Hooks run code at moments like entering a node, without being a step in the flow.</p>
            ) : (
              <ul className="vwe-items">
                {hooksInUse.map((h) => {
                  const def = hooks[h.type];
                  const label = h.label || def?.label || h.type;
                  const flagged = issuesByNode.has(h.id);
                  return (
                    <li key={h.id} className={`vwe-hookrow${selectedHookId === h.id ? ' is-selected' : ''}${h.enabled === false ? ' is-off' : ''}`}>
                      <button type="button" className="vwe-hookrow__main" onClick={() => onSelectHook(h.id)}>
                        <IconChip id={h.type} icon={def?.icon} label={label} color={def?.color} size="sm" />
                        <span className="vwe-hookrow__text">
                          <span className="vwe-item__label">{label}{flagged && <span className="vwe-dot" aria-label="has warnings" />}</span>
                          <span className="vwe-hookrow__sub">{triggerShort(h.trigger)} · {h.scope === 'all' ? 'every node' : `${h.scope.length} node${h.scope.length === 1 ? '' : 's'}`}</span>
                        </span>
                      </button>
                      <label className="vwe-switch vwe-switch--bare" title={h.enabled === false ? 'Enable' : 'Disable'}>
                        <input type="checkbox" role="switch" aria-label={`${label} enabled`} checked={h.enabled !== false} disabled={readOnly} onChange={(e) => onToggleHook(h.id, e.target.checked)} />
                        <span className="vwe-switch__track" aria-hidden />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {!readOnly && (
            <section className="vwe-sidebar__group">
              <h3 className="vwe-sidebar__title">Add a hook</h3>
              <ul className="vwe-items">
                {hookDefs.map(([type, d]) => (
                  <li key={type}>
                    <button type="button" className="vwe-item" onClick={() => onAddHook(type)} title={d.description}>
                      <IconChip id={type} icon={d.icon} label={d.label} color={d.color} size="sm" />
                      <span className="vwe-item__label">{d.label}</span>
                      <span className="vwe-item__plus" aria-hidden>+</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </nav>
  );
}

// ─── Workflow list ────────────────────────────────────────────────────────────

export interface WorkflowListProps {
  workflows: Workflow[] | null;
  currentId: WorkflowId | null;
  dirty: boolean;
  onOpen: (id: WorkflowId) => void;
  onNew: () => void;
  onDelete: (id: WorkflowId) => void;
  onClose: () => void;
}

export function WorkflowList({ workflows, currentId, dirty, onOpen, onNew, onDelete, onClose }: WorkflowListProps) {
  const [confirmDelete, setConfirmDelete] = useState<WorkflowId | null>(null);
  const [pending, setPending] = useState<{ open: WorkflowId } | { new: true } | null>(null);
  const go = (action: { open: WorkflowId } | { new: true }) => {
    if (dirty) return setPending(action);
    if ('open' in action) onOpen(action.open);
    else onNew();
  };
  return (
    <div className="vwe-popover vwe-popover--list" role="dialog" aria-label="Workflows">
      <div className="vwe-popover__head">
        <strong>Workflows</strong>
        <div className="vwe-row">
          <button type="button" className="vwe-btn vwe-btn--sm" onClick={() => go({ new: true })}>New workflow</button>
          <button type="button" className="vwe-icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
      {pending && (
        <div className="vwe-confirm">
          <span>You have unsaved changes. Discard them?</span>
          <div className="vwe-row">
            <button type="button" className="vwe-btn vwe-btn--sm" onClick={() => setPending(null)}>Keep editing</button>
            <button type="button" className="vwe-btn vwe-btn--sm vwe-btn--danger" onClick={() => { const p = pending; setPending(null); if ('open' in p) onOpen(p.open); else onNew(); }}>Discard</button>
          </div>
        </div>
      )}
      {workflows === null ? (
        <p className="vwe-muted vwe-pad">Loading workflows…</p>
      ) : workflows.length === 0 ? (
        <p className="vwe-muted vwe-pad">No saved workflows yet. Build one and press Save.</p>
      ) : (
        <ul className="vwe-list">
          {workflows.map((w) => (
            <li key={String(w.id)} className={`vwe-list__item${String(w.id) === String(currentId) ? ' is-current' : ''}`}>
              {confirmDelete === w.id ? (
                <div className="vwe-confirm vwe-confirm--inline">
                  <span>Delete “{w.name}”? This can’t be undone.</span>
                  <div className="vwe-row">
                    <button type="button" className="vwe-btn vwe-btn--sm" onClick={() => setConfirmDelete(null)}>Cancel</button>
                    <button type="button" className="vwe-btn vwe-btn--sm vwe-btn--danger" onClick={() => { setConfirmDelete(null); onDelete(w.id); }}>Delete</button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="vwe-list__open" onClick={() => go({ open: w.id })}>
                    <span className="vwe-list__name">{w.name}</span>
                    <span className="vwe-list__meta">
                      {w.nodes?.length ?? 0} nodes{w.updated_at ? ` · ${new Date(w.updated_at).toLocaleDateString()}` : ''}
                    </span>
                  </button>
                  <button type="button" className="vwe-icon-btn" aria-label={`Delete ${w.name}`} onClick={() => setConfirmDelete(w.id)}>
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8.5h5l.5-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
