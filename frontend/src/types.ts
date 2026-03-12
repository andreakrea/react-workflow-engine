/**
 * Describes one entry in the block palette (workflow step or lifecycle hook).
 */
export interface BlockType {
  /** Unique identifier — stored as node.data.type in the graph */
  id: string;
  /** Human-readable label shown in the palette and on the canvas node */
  label: string;
  /** Emoji or icon string */
  icon: string;
  /** Tailwind CSS class string for background/border/text color */
  color: string;
  /** Short description shown under the label in the palette */
  description: string;
  /**
   * Determines which custom ReactFlow node component is used:
   *   standard  — single input + single output handle
   *   decision  — single input + two outputs (YES/NO)
   *   terminal  — single input, no output (end state)
   *   hook      — no handles (floating lifecycle hook)
   */
  nodeType: 'standard' | 'decision' | 'terminal' | 'hook';
  /** Only required for hook blocks — the lifecycle trigger type */
  trigger?: 'on_message' | 'on_transition' | 'on_node_entry' | 'on_node_exit';
}

/**
 * Props accepted by the WorkflowEditor component.
 */
export interface WorkflowEditorProps {
  /**
   * Base URL of the API that exposes the workflow CRUD endpoints.
   * e.g. "http://localhost:3002"  or  "/api"
   * The component will call:
   *   GET    {apiUrl}/api/workflows
   *   POST   {apiUrl}/api/workflows
   *   PUT    {apiUrl}/api/workflows/:id
   *   DELETE {apiUrl}/api/workflows/:id
   */
  apiUrl: string;

  /**
   * List of workflow step blocks shown in the top section of the palette.
   * Drag them onto the canvas to build the workflow graph.
   */
  blockTypes: BlockType[];

  /**
   * List of lifecycle hook blocks shown in the bottom section of the palette.
   * Hooks are stored separately in the workflow's `hooks` array (not as graph edges).
   */
  hookTypes: BlockType[];

  /**
   * If provided, a "← Back" button is shown in the header that calls this
   * function when clicked. Omit it to hide the button entirely.
   */
  onBack?: () => void;

  /**
   * Title shown in the editor header. Defaults to "Workflow Editor".
   */
  title?: string;

  /**
   * License key for vise-workflow-engine.
   * Get one at https://github.com/andreakrea/react-workflow-engine
   */
  licenseKey?: string;
}
