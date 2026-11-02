import { memo, type CSSProperties, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { colorOf, getBranches, type BlockColor, type BlockDef, type BlockKind } from '../core/blocks';
import { useEditorContext } from './context';
import type { BlockNodeData } from './convert';

export const KIND_LABEL: Record<BlockKind, string> = { start: 'Start', step: 'Step', decision: 'Decision', end: 'End' };

/** Icon chip: a custom icon from the `icons` prop, the definition's icon string, or the label's initial. */
export function IconChip({ id, icon, label, color, size = 'md' }: { id: string; icon?: string; label: string; color?: BlockColor; size?: 'sm' | 'md' }) {
  const { icons } = useEditorContext();
  const c = colorOf(color);
  const content: ReactNode = icons[id] ?? icon ?? label.trim().charAt(0).toUpperCase();
  return (
    <span className={`vwe-chip vwe-chip--${size}`} style={{ '--vwe-chip': c.bg, '--vwe-chip-text': c.text } as CSSProperties} aria-hidden>
      {content}
    </span>
  );
}

function summary(def: BlockDef | undefined, values: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [name, spec] of Object.entries(def?.variables ?? {})) {
    const val = values[name];
    if (val === undefined || val === '' || val === null) continue;
    rows.push([spec.label ?? name, spec.kind === 'boolean' ? (val ? 'Yes' : 'No') : String(val)]);
  }
  return rows.slice(0, 3);
}

export const BlockNode = memo(function BlockNode({ id, data, selected }: NodeProps<BlockNodeData>) {
  const { blocks, issuesByNode } = useEditorContext();
  const def = blocks[data.type];
  const kind = def?.kind ?? 'step';
  const issues = issuesByNode.get(id) ?? [];
  const errors = issues.filter((i) => i.level === 'error').length;
  const branches = getBranches(def);
  const rows = summary(def, data.variables ?? {});
  const label = data.label || def?.label || data.type;
  const subtitle = !def ? `Unknown block “${data.type}”` : data.label ? def.label : KIND_LABEL[kind];

  return (
    <div
      className={`vwe-node vwe-node--${kind}${selected ? ' is-selected' : ''}${errors ? ' has-error' : issues.length ? ' has-warning' : ''}${def ? '' : ' is-unknown'}`}
      style={branches.length > 2 ? { width: branches.length * 84 } : undefined}
    >
      {kind !== 'start' && <Handle type="target" position={Position.Top} className="vwe-handle" />}
      <div className="vwe-node__head">
        <IconChip id={data.type} icon={def?.icon} label={label} color={def?.color} />
        <div className="vwe-node__text">
          <div className="vwe-node__label">{label}</div>
          {subtitle !== label && <div className="vwe-node__sub">{subtitle}</div>}
        </div>
        {issues.length > 0 && (
          <span
            className={`vwe-node__flag vwe-node__flag--${errors ? 'error' : 'warning'}`}
            title={issues.map((i) => i.message).join('\n')}
            aria-label={`${issues.length} issue${issues.length > 1 ? 's' : ''}`}
          >
            {issues.length}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <dl className="vwe-node__rows">
          {rows.map(([k, val]) => (
            <div key={k} className="vwe-node__row">
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
      )}

      {kind === 'decision' ? (
        <div className="vwe-node__ports">
          {branches.map((b) => (
            <div key={b.id} className="vwe-port">
              <span className="vwe-port__label">{b.label ?? b.id}</span>
              <Handle
                type="source"
                id={b.id}
                position={Position.Bottom}
                className="vwe-handle vwe-handle--port"
                style={b.color ? ({ '--vwe-port': b.color } as CSSProperties) : undefined}
              />
            </div>
          ))}
        </div>
      ) : kind !== 'end' ? (
        <Handle type="source" position={Position.Bottom} className="vwe-handle vwe-handle--out" />
      ) : null}
    </div>
  );
});

export const nodeTypes = { block: BlockNode };
