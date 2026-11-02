import { createContext, useContext, type ReactNode } from 'react';
import type { Blocks, Hooks } from '../core/blocks';
import type { ValidationIssue } from '../core/validate';
import { enLabels, type EditorLabels } from './labels';

export interface EditorContextValue {
  blocks: Blocks;
  hooks: Hooks;
  icons: Partial<Record<string, ReactNode>>;
  issuesByNode: Map<string, ValidationIssue[]>;
  readOnly: boolean;
  labels: EditorLabels;
}

export const EditorContext = createContext<EditorContextValue>({
  blocks: {},
  hooks: {},
  icons: {},
  issuesByNode: new Map(),
  readOnly: false,
  labels: enLabels,
});

export const useEditorContext = () => useContext(EditorContext);
