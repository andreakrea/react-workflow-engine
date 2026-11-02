import type { BlockKind } from '../core/blocks';
import type { ValidationIssue } from '../core/validate';

/** Every piece of text the editor shows. Pass a full set or override a few keys. */
export interface EditorLabels {
  untitled: string;
  workflowName: string;
  saving: string;
  loading: string;
  saved: string;
  unsaved: string;
  notSaved: (message: string) => string;
  add: string;
  undo: string;
  redo: string;
  save: string;
  workflows: string;
  close: string;
  problems: string;
  problemsHint: string;
  errors: (n: number) => string;
  warnings: (n: number) => string;
  issues: (n: number) => string;
  error: string;
  warning: string;
  emptyTitle: string;
  emptyText: string;
  kind: Record<BlockKind, string>;
  groups: Record<BlockKind, string>;
  unknownBlock: (type: string) => string;
  unknownBlockKicker: string;
  yes: string;
  no: string;
  label: string;
  settings: string;
  required: string;
  requiredHint: (label: string) => string;
  choose: string;
  deleteNode: string;
  id: string;
  hook: string;
  removeHook: string;
  enabled: string;
  runsOn: string;
  everyNode: string;
  selectedNodes: string;
  addNodesFirst: string;
  trigger: (trigger: string) => string;
  triggerShort: (trigger: string) => string;
  blocks: string;
  hooks: string;
  searchBlocks: string;
  noMatch: (query: string) => string;
  addHint: string;
  itemHint: (description?: string) => string;
  inThisWorkflow: string;
  noHooks: string;
  scopeAll: string;
  nodesCount: (n: number) => string;
  addHook: string;
  hasWarnings: string;
  enabledAria: (label: string) => string;
  newWorkflow: string;
  unsavedConfirm: string;
  keepEditing: string;
  discard: string;
  loadingWorkflows: string;
  noWorkflows: string;
  confirmDelete: (name: string) => string;
  cancel: string;
  delete: string;
  deleteNamed: (name: string) => string;
  /** Text of a validation issue. Default: the English message from the core. */
  issue: (issue: ValidationIssue) => string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const pick = (map: Record<string, string>) => (key: string) => map[key] ?? key.replace(/_/g, ' ');

export const enLabels: EditorLabels = {
  untitled: 'Untitled workflow',
  workflowName: 'Workflow name',
  saving: 'Saving…',
  loading: 'Loading…',
  saved: 'All changes saved',
  unsaved: 'Unsaved changes',
  notSaved: (m) => `Not saved: ${m}`,
  add: 'Add',
  undo: 'Undo',
  redo: 'Redo',
  save: 'Save',
  workflows: 'Workflows',
  close: 'Close',
  problems: 'Problems',
  problemsHint: 'Workflows with errors can be saved but not run.',
  errors: (n) => plural(n, 'error', 'errors'),
  warnings: (n) => plural(n, 'warning', 'warnings'),
  issues: (n) => plural(n, 'issue', 'issues'),
  error: 'Error',
  warning: 'Warning',
  emptyTitle: 'This workflow is empty',
  emptyText: 'Add a start block from the list on the left, then connect the next steps.',
  kind: { start: 'Start', step: 'Step', decision: 'Decision', end: 'End' },
  groups: { start: 'Start', step: 'Steps', decision: 'Decisions', end: 'End states' },
  unknownBlock: (t) => `Unknown block “${t}”`,
  unknownBlockKicker: 'Unknown block',
  yes: 'Yes',
  no: 'No',
  label: 'Label',
  settings: 'Settings',
  required: 'required',
  requiredHint: (l) => `${l} is required to run this workflow.`,
  choose: 'Choose…',
  deleteNode: 'Delete node',
  id: 'ID',
  hook: 'Hook',
  removeHook: 'Remove hook',
  enabled: 'Enabled',
  runsOn: 'Runs on',
  everyNode: 'Every node',
  selectedNodes: 'Selected nodes',
  addNodesFirst: 'Add nodes to the canvas first.',
  trigger: pick({ on_node_entry: 'When a node is entered', on_node_exit: 'When a node is left', on_transition: 'On every transition', on_message: 'On each message' }),
  triggerShort: pick({ on_node_entry: 'on entry', on_node_exit: 'on exit', on_transition: 'on move', on_message: 'on message' }),
  blocks: 'Blocks',
  hooks: 'Hooks',
  searchBlocks: 'Search blocks',
  noMatch: (q) => `No block matches “${q}”.`,
  addHint: 'Click a block to add it under the selected node, or drag it onto the canvas.',
  itemHint: (d) => `${d ? `${d} — ` : ''}click to add, or drag onto the canvas`,
  inThisWorkflow: 'In this workflow',
  noHooks: 'No hooks yet. Hooks run code at moments like entering a node, without being a step in the flow.',
  scopeAll: 'every node',
  nodesCount: (n) => plural(n, 'node', 'nodes'),
  addHook: 'Add a hook',
  hasWarnings: 'has warnings',
  enabledAria: (l) => `${l} enabled`,
  newWorkflow: 'New workflow',
  unsavedConfirm: 'You have unsaved changes. Discard them?',
  keepEditing: 'Keep editing',
  discard: 'Discard',
  loadingWorkflows: 'Loading workflows…',
  noWorkflows: 'No saved workflows yet. Build one and press Save.',
  confirmDelete: (n) => `Delete “${n}”? This can’t be undone.`,
  cancel: 'Cancel',
  delete: 'Delete',
  deleteNamed: (n) => `Delete ${n}`,
  issue: (i) => i.message,
};

const itIssue = (i: ValidationIssue): string => {
  const p = i.params ?? {};
  const branch = p.branchLabel || (p.branch === 'yes' ? 'Sì' : p.branch === 'no' ? 'No' : p.branch);
  switch (i.code) {
    case 'EMPTY': return 'Il workflow non ha nodi';
    case 'DUPLICATE_ID': return `ID nodo duplicato “${p.id}”`;
    case 'DANGLING_EDGE': return 'Un collegamento punta a un nodo che non esiste';
    case 'MULTIPLE_STARTS': return 'È ammesso un solo nodo di inizio';
    case 'NO_START': return 'Aggiungi un nodo di inizio';
    case 'UNKNOWN_BLOCK': return `“${p.type}” non è un blocco conosciuto`;
    case 'END_HAS_EXITS': return `“${p.label}” è un nodo finale ma ha collegamenti in uscita`;
    case 'DEAD_END': return `“${p.label}” non ha un passo successivo`;
    case 'UNKNOWN_BRANCH': return `“${p.label}” ha un collegamento sul ramo sconosciuto “${branch}”`;
    case 'DUPLICATE_BRANCH': return `“${p.label}” ha più di un collegamento “${branch}”`;
    case 'MISSING_BRANCH': return `“${p.label}” non ha un collegamento “${branch}”`;
    case 'MISSING_VARIABLE': return `“${p.label}”: ${p.variable} è obbligatorio`;
    case 'UNREACHABLE': return `“${p.label}” non si raggiunge mai`;
    case 'UNKNOWN_HOOK': return `“${p.type}” non è un hook conosciuto`;
    case 'HOOK_SCOPE': return `L’hook “${p.label}” è limitato a un nodo che non esiste`;
    default: return i.message;
  }
};

export const itLabels: EditorLabels = {
  untitled: 'Workflow senza titolo',
  workflowName: 'Nome del workflow',
  saving: 'Salvataggio…',
  loading: 'Caricamento…',
  saved: 'Tutte le modifiche sono salvate',
  unsaved: 'Modifiche non salvate',
  notSaved: (m) => `Non salvato: ${m}`,
  add: 'Aggiungi',
  undo: 'Annulla',
  redo: 'Ripeti',
  save: 'Salva',
  workflows: 'Workflow',
  close: 'Chiudi',
  problems: 'Problemi',
  problemsHint: 'I workflow con errori si possono salvare ma non avviare.',
  errors: (n) => plural(n, 'errore', 'errori'),
  warnings: (n) => plural(n, 'avviso', 'avvisi'),
  issues: (n) => plural(n, 'problema', 'problemi'),
  error: 'Errore',
  warning: 'Avviso',
  emptyTitle: 'Questo workflow è vuoto',
  emptyText: 'Aggiungi un blocco di inizio dall’elenco a sinistra, poi collega i passi successivi.',
  kind: { start: 'Inizio', step: 'Passo', decision: 'Decisione', end: 'Fine' },
  groups: { start: 'Inizio', step: 'Passi', decision: 'Decisioni', end: 'Stati finali' },
  unknownBlock: (t) => `Blocco sconosciuto “${t}”`,
  unknownBlockKicker: 'Blocco sconosciuto',
  yes: 'Sì',
  no: 'No',
  label: 'Etichetta',
  settings: 'Impostazioni',
  required: 'obbligatorio',
  requiredHint: (l) => `${l} è obbligatorio per avviare il workflow.`,
  choose: 'Scegli…',
  deleteNode: 'Elimina nodo',
  id: 'ID',
  hook: 'Hook',
  removeHook: 'Rimuovi hook',
  enabled: 'Attivo',
  runsOn: 'Si attiva su',
  everyNode: 'Tutti i nodi',
  selectedNodes: 'Nodi scelti',
  addNodesFirst: 'Prima aggiungi dei nodi al canvas.',
  trigger: pick({ on_node_entry: 'Quando si entra in un nodo', on_node_exit: 'Quando si esce da un nodo', on_transition: 'A ogni passaggio', on_message: 'A ogni messaggio' }),
  triggerShort: pick({ on_node_entry: 'all’ingresso', on_node_exit: 'all’uscita', on_transition: 'a ogni passaggio', on_message: 'a ogni messaggio' }),
  blocks: 'Blocchi',
  hooks: 'Hook',
  searchBlocks: 'Cerca blocchi',
  noMatch: (q) => `Nessun blocco corrisponde a “${q}”.`,
  addHint: 'Clicca un blocco per aggiungerlo sotto il nodo selezionato, oppure trascinalo nel canvas.',
  itemHint: (d) => `${d ? `${d} — ` : ''}clicca per aggiungere o trascina nel canvas`,
  inThisWorkflow: 'In questo workflow',
  noHooks: 'Nessun hook. Gli hook eseguono codice in momenti precisi, come l’ingresso in un nodo, senza essere un passo del flusso.',
  scopeAll: 'tutti i nodi',
  nodesCount: (n) => plural(n, 'nodo', 'nodi'),
  addHook: 'Aggiungi un hook',
  hasWarnings: 'ha avvisi',
  enabledAria: (l) => `${l} attivo`,
  newWorkflow: 'Nuovo workflow',
  unsavedConfirm: 'Hai modifiche non salvate. Vuoi scartarle?',
  keepEditing: 'Continua a modificare',
  discard: 'Scarta',
  loadingWorkflows: 'Caricamento dei workflow…',
  noWorkflows: 'Nessun workflow salvato. Creane uno e premi Salva.',
  confirmDelete: (n) => `Eliminare “${n}”? L’operazione non si può annullare.`,
  cancel: 'Annulla',
  delete: 'Elimina',
  deleteNamed: (n) => `Elimina ${n}`,
  issue: itIssue,
};
