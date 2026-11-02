import { useEffect, useId, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { BlockDef, BlockKind, VariableSpec, VariableSpecs } from '../core/blocks';
import type { Workflow, WorkflowHook, WorkflowId } from '../core/types';
import type { ValidationIssue } from '../core/validate';
import { useEditorContext } from './context';
import type { BlockNodeData, FlowNode } from './convert';
import { IconChip } from './nodes';

export const DND_TYPE = 'application/x-vise-workflow-block';

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
  const { labels: L } = useEditorContext();
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
        {spec.required && <span className="vwe-required"> {L.required}</span>}
      </label>
      {spec.kind === 'text' ? (
        <textarea {...common} className="vwe-input" rows={3} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      ) : spec.kind === 'number' ? (
        <NumberInput {...common} invalid={missing} value={value} onChange={onChange} />
      ) : spec.kind === 'select' ? (
        <select {...common} className="vwe-input vwe-select" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          {(!spec.required || value === undefined) && <option value="">{L.choose}</option>}
          {(spec.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input {...common} className="vwe-input" type="text" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />
      )}
      {(missing || spec.description) && (
        <p id={helpId} className={`vwe-help${missing ? ' vwe-help--error' : ''}`}>
          {missing ? L.requiredHint(label) : spec.description}
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
  const { labels: L } = useEditorContext();
  return (
    <aside className="vwe-inspector" aria-label={`${title} · ${L.settings}`}>
      <div className="vwe-inspector__head">
        {chip}
        <div className="vwe-inspector__titles">
          <div className="vwe-inspector__kicker">{kicker}</div>
          <h2 className="vwe-inspector__title">{title}</h2>
        </div>
        <button type="button" className="vwe-icon-btn" onClick={onClose} aria-label={L.close}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="vwe-inspector__body">{children}</div>
      <div className="vwe-inspector__foot">{footer}</div>
    </aside>
  );
}

function IssueList({ issues }: { issues: ValidationIssue[] }) {
  const { labels: L } = useEditorContext();
  if (!issues.length) return null;
  return (
    <ul className="vwe-issues">
      {issues.map((i, k) => (
        <li key={k} className={`vwe-issue vwe-issue--${i.level}`}>
          <span className="vwe-issue__tag">{i.level === 'error' ? L.error : L.warning}</span>
          {L.issue(i)}
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
  const { blocks, readOnly, labels: L } = useEditorContext();
  const labelId = useId();
  const d = node.data;
  const def: BlockDef | undefined = blocks[d.type];
  const title = d.label || def?.label || d.type;
  return (
    <InspectorShell
      kicker={def ? `${L.kind[def.kind]}${d.label ? ` · ${def.label}` : ''}` : L.unknownBlockKicker}
      title={title}
      chip={<IconChip id={d.type} icon={def?.icon} label={title} color={def?.color} />}
      onClose={onClose}
      footer={
        <>
          <span className="vwe-meta">{L.id} {node.id}</span>
          {!readOnly && <button type="button" className="vwe-btn vwe-btn--ghost-danger" onClick={() => onDelete(node.id)}>{L.deleteNode}</button>}
        </>
      }
    >
      {def?.description && <p className="vwe-muted">{def.description}</p>}
      <IssueList issues={issues} />
      <div className="vwe-field">
        <label className="vwe-label" htmlFor={labelId}>{L.label}</label>
        <input id={labelId} className="vwe-input" value={d.label ?? ''} placeholder={def?.label ?? d.type} disabled={readOnly} onChange={(e) => onChange(node.id, { label: e.target.value || undefined })} />
      </div>
      {def?.variables && Object.keys(def.variables).length > 0 && (
        <section className="vwe-group">
          <h3 className="vwe-group__title">{L.settings}</h3>
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
  const { blocks, hooks, readOnly, labels: L } = useEditorContext();
  const def = hooks[hook.type];
  const title = hook.label || def?.label || hook.type;
  const set = (patch: Partial<WorkflowHook>) => onChange({ ...hook, ...patch });
  const scope = Array.isArray(hook.scope) ? hook.scope : null;
  return (
    <InspectorShell
      kicker={`${L.hook} · ${L.trigger(hook.trigger)}`}
      title={title}
      chip={<IconChip id={hook.type} icon={def?.icon} label={title} color={def?.color} />}
      onClose={onClose}
      footer={
        <>
          <span className="vwe-meta">{L.id} {hook.id}</span>
          {!readOnly && <button type="button" className="vwe-btn vwe-btn--ghost-danger" onClick={() => onDelete(hook.id)}>{L.removeHook}</button>}
        </>
      }
    >
      {def?.description && <p className="vwe-muted">{def.description}</p>}
      <IssueList issues={issues} />
      <Switch checked={hook.enabled !== false} disabled={readOnly} onChange={(v) => set({ enabled: v })} label={L.enabled} />
      <fieldset className="vwe-group" disabled={readOnly}>
        <legend className="vwe-group__title">{L.runsOn}</legend>
        <div className="vwe-segmented" role="radiogroup">
          <label className={`vwe-segmented__item${!scope ? ' is-active' : ''}`}>
            <input type="radio" checked={!scope} onChange={() => set({ scope: 'all' })} /> {L.everyNode}
          </label>
          <label className={`vwe-segmented__item${scope ? ' is-active' : ''}`}>
            <input type="radio" checked={!!scope} onChange={() => set({ scope: [] })} /> {L.selectedNodes}
          </label>
        </div>
        {scope && (
          <div className="vwe-checklist">
            {nodes.length === 0 && <p className="vwe-muted">{L.addNodesFirst}</p>}
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
          <h3 className="vwe-group__title">{L.settings}</h3>
          <Fields specs={def.config} values={hook.config ?? {}} disabled={readOnly} onChange={(k, v) => set({ config: { ...hook.config, [k]: v } })} />
        </section>
      )}
    </InspectorShell>
  );
}

// ─── Sidebar (left panel) ─────────────────────────────────────────────────────

const KIND_ORDER: BlockKind[] = ['start', 'step', 'decision', 'end'];

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
  const { blocks, hooks, readOnly, labels: L } = useEditorContext();
  const [tab, setTab] = useState<'blocks' | 'hooks'>('blocks');
  const [query, setQuery] = useState('');
  const searchId = useId();
  const hookDefs = Object.entries(hooks);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (id: string, d: BlockDef) => !q || [id, d.label, d.description ?? ''].some((s) => s.toLowerCase().includes(q));
    return KIND_ORDER.map((kind) => ({ title: L.groups[kind], items: Object.entries(blocks).filter(([id, d]) => d.kind === kind && match(id, d)) })).filter((g) => g.items.length);
  }, [blocks, query, L]);

  const drag = (e: DragEvent, type: string) => {
    e.dataTransfer.setData(DND_TYPE, JSON.stringify({ kind: 'block', type }));
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <nav className="vwe-sidebar" aria-label={`${L.blocks} / ${L.hooks}`}>
      {hookDefs.length > 0 && (
        <div className="vwe-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'blocks'} className={`vwe-tab${tab === 'blocks' ? ' is-active' : ''}`} onClick={() => setTab('blocks')}>{L.blocks}</button>
          <button type="button" role="tab" aria-selected={tab === 'hooks'} className={`vwe-tab${tab === 'hooks' ? ' is-active' : ''}`} onClick={() => setTab('hooks')}>
            {L.hooks}{hooksInUse.length > 0 && <span className="vwe-count">{hooksInUse.length}</span>}
          </button>
        </div>
      )}

      {tab === 'blocks' ? (
        <>
          <label htmlFor={searchId} className="vwe-sr-only">{L.searchBlocks}</label>
          <input id={searchId} className="vwe-input vwe-search" type="search" placeholder={L.searchBlocks} value={query} onChange={(e) => setQuery(e.target.value)} />
          {groups.length === 0 && <p className="vwe-muted vwe-pad-y">{L.noMatch(query)}</p>}
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
                      title={L.itemHint(d.description)}
                    >
                      <IconChip id={type} icon={d.icon} label={d.label} color={d.color} size="sm" />
                      <span className="vwe-item__label">{d.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!readOnly && <p className="vwe-hint">{L.addHint}</p>}
        </>
      ) : (
        <>
          <section className="vwe-sidebar__group">
            <h3 className="vwe-sidebar__title">{L.inThisWorkflow}</h3>
            {hooksInUse.length === 0 ? (
              <p className="vwe-muted">{L.noHooks}</p>
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
                          <span className="vwe-item__label">{label}{flagged && <span className="vwe-dot" aria-label={L.hasWarnings} />}</span>
                          <span className="vwe-hookrow__sub">{L.triggerShort(h.trigger)} · {h.scope === 'all' ? L.scopeAll : L.nodesCount(h.scope.length)}</span>
                        </span>
                      </button>
                      <label className="vwe-switch vwe-switch--bare">
                        <input type="checkbox" role="switch" aria-label={L.enabledAria(label)} checked={h.enabled !== false} disabled={readOnly} onChange={(e) => onToggleHook(h.id, e.target.checked)} />
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
              <h3 className="vwe-sidebar__title">{L.addHook}</h3>
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
  const { labels: L } = useEditorContext();
  const [confirmDelete, setConfirmDelete] = useState<WorkflowId | null>(null);
  const [pending, setPending] = useState<{ open: WorkflowId } | { new: true } | null>(null);
  const go = (action: { open: WorkflowId } | { new: true }) => {
    if (dirty) return setPending(action);
    if ('open' in action) onOpen(action.open);
    else onNew();
  };
  return (
    <div className="vwe-popover vwe-popover--list" role="dialog" aria-label={L.workflows}>
      <div className="vwe-popover__head">
        <strong>{L.workflows}</strong>
        <div className="vwe-row">
          <button type="button" className="vwe-btn vwe-btn--sm" onClick={() => go({ new: true })}>{L.newWorkflow}</button>
          <button type="button" className="vwe-icon-btn" onClick={onClose} aria-label={L.close}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
      {pending && (
        <div className="vwe-confirm">
          <span>{L.unsavedConfirm}</span>
          <div className="vwe-row">
            <button type="button" className="vwe-btn vwe-btn--sm" onClick={() => setPending(null)}>{L.keepEditing}</button>
            <button type="button" className="vwe-btn vwe-btn--sm vwe-btn--danger" onClick={() => { const p = pending; setPending(null); if ('open' in p) onOpen(p.open); else onNew(); }}>{L.discard}</button>
          </div>
        </div>
      )}
      {workflows === null ? (
        <p className="vwe-muted vwe-pad">{L.loadingWorkflows}</p>
      ) : workflows.length === 0 ? (
        <p className="vwe-muted vwe-pad">{L.noWorkflows}</p>
      ) : (
        <ul className="vwe-list">
          {workflows.map((w) => (
            <li key={String(w.id)} className={`vwe-list__item${String(w.id) === String(currentId) ? ' is-current' : ''}`}>
              {confirmDelete === w.id ? (
                <div className="vwe-confirm vwe-confirm--inline">
                  <span>{L.confirmDelete(w.name)}</span>
                  <div className="vwe-row">
                    <button type="button" className="vwe-btn vwe-btn--sm" onClick={() => setConfirmDelete(null)}>{L.cancel}</button>
                    <button type="button" className="vwe-btn vwe-btn--sm vwe-btn--danger" onClick={() => { setConfirmDelete(null); onDelete(w.id); }}>{L.delete}</button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" className="vwe-list__open" onClick={() => go({ open: w.id })}>
                    <span className="vwe-list__name">{w.name}</span>
                    <span className="vwe-list__meta">
                      {L.nodesCount(w.nodes?.length ?? 0)}{w.updated_at ? ` · ${new Date(w.updated_at).toLocaleDateString()}` : ''}
                    </span>
                  </button>
                  <button type="button" className="vwe-icon-btn" aria-label={L.deleteNamed(w.name)} onClick={() => setConfirmDelete(w.id)}>
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
