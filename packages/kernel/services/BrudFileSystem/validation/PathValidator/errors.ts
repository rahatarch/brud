export type PathViolationRule =
  | 'NULL_BYTE'
  | 'TRAVERSAL'
  | 'RESERVED_DEVICE'
  | 'ALTERNATE_DATA_STREAM'
  | 'SYMLINK_ESCAPE'
  | 'OUTSIDE_ROOT';

export interface PathViolationDetails {
  readonly rule: PathViolationRule;
  readonly root: string;
  readonly candidatePath: string;
  readonly reason: string;
}

export class PathTraversalViolationError extends Error {
  public readonly code = 'PATH_TRAVERSAL_DETECTED' as const;

  public readonly rule: PathViolationRule;

  public readonly root: string;

  public readonly candidatePath: string;

  public readonly reason: string;

  public readonly path: string;

  constructor(details: PathViolationDetails) {
    super(`Path traversal detected for "${details.candidatePath}": ${details.reason}`);
    this.name = 'PathTraversalViolationError';
    this.rule = details.rule;
    this.root = details.root;
    this.candidatePath = details.candidatePath;
    this.reason = details.reason;
    this.path = details.candidatePath;
  }
}
