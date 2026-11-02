import type { HookTrigger } from './types';

// ─── Variable specs ───────────────────────────────────────────────────────────

export type VariableKind = 'string' | 'text' | 'number' | 'boolean' | 'select';

export interface VariableSpec<T = unknown, R extends boolean = boolean> {
  readonly kind: VariableKind;
  readonly label?: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly required: R;
  readonly default?: T;
  readonly options?: readonly string[];
  /** Phantom field carrying the value type. Never set at runtime. */
  readonly __type?: T;
}

interface VariableOptions<T> {
  label?: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: T;
}

type IsRequired<O> = O extends { required: true } ? true : O extends { default: {} } ? true : false;

function spec<T, const O extends VariableOptions<T>>(kind: VariableKind, opts: O | undefined, extra: { options?: readonly string[] } = {}) {
  const o = (opts ?? {}) as VariableOptions<T>;
  return { kind, ...o, ...extra, required: !!(o.required || o.default !== undefined) } as unknown as VariableSpec<T, IsRequired<O>>;
}

/**
 * Variable specs. Values are configured per node in the editor and passed to
 * the block's action as typed `variables`. Specs are plain JSON-safe objects.
 *
 *   variables: {
 *     to: v.string({ label: 'Recipient', required: true }),   // string
 *     retries: v.number({ default: 3 }),                       // number
 *     cc: v.string(),                                          // string | undefined
 *     tone: v.select(['formal', 'casual']),                    // 'formal' | 'casual' | undefined
 *   }
 */
export const v = {
  string: <const O extends VariableOptions<string> = {}>(opts?: O) => spec<string, O>('string', opts),
  text: <const O extends VariableOptions<string> = {}>(opts?: O) => spec<string, O>('text', opts),
  number: <const O extends VariableOptions<number> = {}>(opts?: O) => spec<number, O>('number', opts),
  boolean: <const O extends VariableOptions<boolean> = {}>(opts?: O) => spec<boolean, O>('boolean', opts),
  select: <const Opt extends readonly string[], const O extends VariableOptions<Opt[number]> = {}>(options: Opt, opts?: O) =>
    spec<Opt[number], O>('select', opts, { options }),
};

export type VariableSpecs = Record<string, VariableSpec<any, boolean>>;

export type InferVariables<V extends VariableSpecs | undefined> = V extends VariableSpecs
  ? { [K in keyof V]: V[K] extends VariableSpec<infer T, true> ? T : V[K] extends VariableSpec<infer T, boolean> ? T | undefined : never }
  : Record<string, never>;

// ─── Block & hook definitions ─────────────────────────────────────────────────

export type BlockKind = 'start' | 'step' | 'decision' | 'end';

export type BlockColor = string | { bg: string; border?: string; text?: string };

export interface BranchDef {
  id: string;
  label?: string;
  color?: string;
}

export interface BlockDef {
  kind: BlockKind;
  label: string;
  icon?: string;
  /** Any CSS colour (the background), or { bg, border, text }. */
  color?: BlockColor;
  description?: string;
  variables?: VariableSpecs;
  /** Decision outputs. Defaults to ['yes', 'no']. */
  branches?: readonly (string | BranchDef)[];
}

export interface HookDef {
  trigger: HookTrigger;
  label: string;
  icon?: string;
  color?: BlockColor;
  description?: string;
  /** Per-hook settings, edited in the editor and passed to the handler as `config`. */
  config?: VariableSpecs;
}

export type Blocks = Record<string, BlockDef>;
export type Hooks = Record<string, HookDef>;

/** Identity helper that preserves literal types for inference. */
export function defineBlocks<const B extends Blocks>(blocks: B): B {
  return blocks;
}

export function defineHooks<const H extends Hooks>(hooks: H): H {
  return hooks;
}

export const DEFAULT_BRANCHES: readonly BranchDef[] = [
  { id: 'yes', label: 'Yes', color: '#16a34a' },
  { id: 'no', label: 'No', color: '#dc2626' },
];

export function getBranches(block: BlockDef | undefined): BranchDef[] {
  if (!block || block.kind !== 'decision') return [];
  const list = block.branches?.length ? block.branches : DEFAULT_BRANCHES;
  return list.map((b) => (typeof b === 'string' ? { id: b, label: b } : b));
}

export type BranchIds<B> = B extends { branches: readonly (infer X)[] }
  ? X extends string ? X : X extends { id: infer I extends string } ? I : never
  : 'yes' | 'no';

export function defaultVariableValues(specs: VariableSpecs | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs ?? {})) {
    if (spec.default !== undefined) out[name] = spec.default;
    else if (spec.kind === 'boolean') out[name] = false;
    else if (spec.kind === 'select' && spec.required) out[name] = spec.options?.[0];
  }
  return out;
}

export function colorOf(color: BlockColor | undefined): { bg: string; border: string; text: string } {
  if (!color) return { bg: '#f1f5f9', border: '#cbd5e1', text: '#0f172a' };
  if (typeof color === 'string') return { bg: color, border: 'rgba(15,23,42,.18)', text: '#0f172a' };
  return { bg: color.bg, border: color.border ?? 'rgba(15,23,42,.18)', text: color.text ?? '#0f172a' };
}
