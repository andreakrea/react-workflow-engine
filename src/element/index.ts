/**
 * <vise-workflow-editor> — the workflow editor as a standard custom element, for
 * Angular, Vue, Svelte or plain HTML. React and React Flow are bundled inside and
 * all styles live in a shadow root, so nothing leaks in or out. Theme it with the
 * same --vwe-* CSS variables (they pass through the shadow boundary).
 *
 *   import 'vise-workflow-engine/element';
 *   <vise-workflow-editor base-url="/api/workflows" lang="it"></vise-workflow-editor>
 *   el.blocks = blocks; el.headers = () => ({ Authorization: `Bearer ${token}` });
 *   el.addEventListener('saved', (e) => console.log(e.detail));
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Blocks, Hooks } from '../core/blocks';
import type { Workflow, WorkflowId } from '../core/types';
import type { ValidationIssue } from '../core/validate';
import { createHttpClient, type WorkflowClient } from '../react/client';
import { enLabels, itLabels, type EditorLabels } from '../react/labels';
import { WorkflowEditor, type WorkflowDraft } from '../react/WorkflowEditor';
import baseCss from '@xyflow/react/dist/base.css';
import editorCss from '../react/style.css';

const HOST_CSS = `
:host { display: block; position: relative; height: 100%; min-height: 420px; }
:host([hidden]) { display: none; }
.vwe-mount { height: 100%; }
.vwe-icon-html { display: contents; }
`;

const LABELS: Record<string, EditorLabels> = { en: enLabels, it: itLabels };

type Headers = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

/** Events: saved, change, error, deleted, workflow-id-change — all CustomEvents with `detail`. */
export interface WorkflowEditorEventMap {
  saved: CustomEvent<Workflow>;
  change: CustomEvent<{ draft: WorkflowDraft; issues: ValidationIssue[] }>;
  error: CustomEvent<unknown>;
  deleted: CustomEvent<WorkflowId>;
  'workflow-id-change': CustomEvent<WorkflowId | null>;
}

export class WorkflowEditorElement extends HTMLElement {
  static observedAttributes = ['base-url', 'workflow-id', 'theme', 'lang', 'read-only', 'heading', 'hide-attribution'];

  #root: Root | null = null;
  #mount: HTMLDivElement;
  #blocks: Blocks | null = null;
  #hooks: Hooks | undefined;
  #icons: Record<string, string> | undefined;
  #labels: Partial<EditorLabels> | undefined;
  #headers: Headers | undefined;
  #client: WorkflowClient | undefined;
  #httpClient: { key: string; client: WorkflowClient } | null = null;
  #value: WorkflowDraft | undefined;
  #iconNodes: Record<string, ReactNode> = {};

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `${baseCss}\n${editorCss}\n${HOST_CSS}`;
    this.#mount = document.createElement('div');
    this.#mount.className = 'vwe-mount';
    shadow.append(style, this.#mount);
  }

  // ── Properties (objects can't be attributes) ──────────────────────────────

  /** Block definitions — the same object you pass to createEngine. Required. */
  get blocks() { return this.#blocks; }
  set blocks(v: Blocks | null) { this.#blocks = v; this.#render(); }

  get hooks() { return this.#hooks; }
  set hooks(v: Hooks | undefined) { this.#hooks = v; this.#render(); }

  /** Icons by block or hook id, as SVG markup strings (trusted, from your own code). */
  get icons() { return this.#icons; }
  set icons(v: Record<string, string> | undefined) {
    this.#icons = v;
    this.#iconNodes = Object.fromEntries(
      Object.entries(v ?? {}).map(([id, svg]) => [id, createElement('span', { className: 'vwe-icon-html', dangerouslySetInnerHTML: { __html: svg } })]),
    );
    this.#render();
  }

  /** Overrides on top of the `lang` attribute's labels. */
  get labels() { return this.#labels; }
  set labels(v: Partial<EditorLabels> | undefined) { this.#labels = v; this.#render(); }

  /** Headers for every API request (object or function, may be async) — e.g. auth. */
  get headers() { return this.#headers; }
  set headers(v: Headers | undefined) { this.#headers = v; this.#render(); }

  /** A custom WorkflowClient instead of base-url. */
  get client() { return this.#client; }
  set client(v: WorkflowClient | undefined) { this.#client = v; this.#render(); }

  /** Controlled mode: the draft to show; listen to `change`. */
  get value() { return this.#value; }
  set value(v: WorkflowDraft | undefined) { this.#value = v; this.#render(); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connectedCallback() {
    // Frameworks may set properties before the element is defined (e.g. when this
    // module is lazy-loaded). Those land as plain own properties that hide the
    // setters below: re-apply them through the setters.
    for (const key of ['blocks', 'hooks', 'icons', 'labels', 'headers', 'client', 'value'] as const) {
      if (Object.prototype.hasOwnProperty.call(this, key)) {
        const value = (this as Record<string, unknown>)[key];
        delete (this as Record<string, unknown>)[key];
        (this as Record<string, unknown>)[key] = value;
      }
    }
    this.#root ??= createRoot(this.#mount);
    this.#render();
  }

  disconnectedCallback() {
    // Defer: the element may only be moving in the DOM.
    queueMicrotask(() => {
      if (!this.isConnected && this.#root) {
        this.#root.unmount();
        this.#root = null;
      }
    });
  }

  attributeChangedCallback() {
    this.#render();
  }

  #emit(name: keyof WorkflowEditorEventMap, detail: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #resolveClient(): WorkflowClient | undefined {
    if (this.#client) return this.#client;
    const baseUrl = this.getAttribute('base-url');
    if (!baseUrl) return undefined;
    // Keep one client per base URL; headers are read on every request.
    if (this.#httpClient?.key !== baseUrl) {
      this.#httpClient = {
        key: baseUrl,
        client: createHttpClient({
          baseUrl,
          headers: async () => {
            const h = this.#headers;
            return (typeof h === 'function' ? await h() : h) ?? {};
          },
        }),
      };
    }
    return this.#httpClient.client;
  }

  #render() {
    if (!this.#root) return;
    if (!this.#blocks) {
      this.#root.render(null);
      return;
    }
    const lang = this.getAttribute('lang') ?? 'en';
    const theme = this.getAttribute('theme');
    const workflowId = this.getAttribute('workflow-id');
    this.#root.render(
      createElement(WorkflowEditor, {
        blocks: this.#blocks,
        hooks: this.#hooks,
        icons: this.#iconNodes,
        client: this.#resolveClient(),
        value: this.#value,
        workflowId: workflowId === null || workflowId === '' ? null : workflowId,
        theme: theme === 'dark' || theme === 'system' ? theme : 'light',
        labels: { ...(LABELS[lang] ?? enLabels), ...this.#labels },
        readOnly: this.hasAttribute('read-only'),
        hideAttribution: this.hasAttribute('hide-attribution'),
        title: this.getAttribute('heading') ?? undefined,
        onSaved: (w) => this.#emit('saved', w),
        onChange: (draft, issues) => this.#emit('change', { draft, issues }),
        onError: (e) => this.#emit('error', e),
        onDeleted: (id) => this.#emit('deleted', id),
        onWorkflowIdChange: (id) => this.#emit('workflow-id-change', id),
      }),
    );
  }
}

/** Registers the element (done automatically on import with the default tag). */
export function defineWorkflowEditor(tag = 'vise-workflow-editor'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, class extends WorkflowEditorElement {});
  }
}

defineWorkflowEditor();

declare global {
  interface HTMLElementTagNameMap {
    'vise-workflow-editor': WorkflowEditorElement;
  }
}

// Shared config helpers, so element users need a single import.
export { defineBlocks, defineHooks, v } from '../core/blocks';
export type { Blocks, Hooks, BlockDef, HookDef } from '../core/blocks';
export { enLabels, itLabels } from '../react/labels';
export type { EditorLabels } from '../react/labels';
export { createHttpClient, createLocalClient, WorkflowClientError } from '../react/client';
export type { WorkflowClient, HttpClientOptions } from '../react/client';
export type { WorkflowDraft } from '../react/WorkflowEditor';
