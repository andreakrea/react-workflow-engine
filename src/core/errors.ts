export type WorkflowErrorCode =
  | 'WORKFLOW_NOT_FOUND'
  | 'SUBJECT_NOT_FOUND'
  | 'NO_WORKFLOW'
  | 'NO_START_NODE'
  | 'NODE_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'AMBIGUOUS_TRANSITION'
  | 'MAX_STEPS'
  | 'INVALID_WORKFLOW'
  | 'ACTION_FAILED'
  | 'LICENSE';

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: WorkflowErrorCode, message: string, details?: Record<string, unknown>, options?: { cause?: unknown }) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Works across bundles (instanceof does not when a class is duplicated). */
export function isWorkflowError(err: unknown): err is WorkflowError {
  return !!err && typeof err === 'object' && (err as Error).name === 'WorkflowError' && 'code' in err;
}
