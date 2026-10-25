/**
 * Violated workspace rule.
 *
 * The names mirror the kernel `PathViolationRule` vocabulary so downstream
 * telemetry can aggregate workspace and filesystem violations together.
 * `SIBLING_PREFIX`, `AMBIGUOUS_ROOT`, `FILESYSTEM_ROOT`, `UNKNOWN_ROOT`, and
 * `UNVERIFIABLE_LINEAGE` are workspace concerns and have no filesystem
 * counterpart.
 *
 * `UNVERIFIABLE_LINEAGE` is the fail-closed outcome when an ancestor cannot be
 * inspected or realpath-resolved for a reason other than absence (permission
 * boundaries, link loops, unreadable parents). It is never downgraded to a
 * lexical fallback.
 */
export type WorkspaceViolationRule =
  | 'NULL_BYTE'
  | 'TRAVERSAL'
  | 'RESERVED_DEVICE'
  | 'ALTERNATE_DATA_STREAM'
  | 'OUTSIDE_ROOT'
  | 'SIBLING_PREFIX'
  | 'SYMLINK_ESCAPE'
  | 'AMBIGUOUS_ROOT'
  | 'FILESYSTEM_ROOT'
  | 'UNKNOWN_ROOT'
  | 'UNVERIFIABLE_LINEAGE'
  | 'INVALID_INPUT';

const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/g;

/** Absolute-path shape shared by the POSIX and Windows flavors. */
const ABSOLUTE_CANDIDATE_PATTERN = /^(?:[\\/]|[A-Za-z]:[\\/])/u;

/**
 * Neutralizes caller-supplied text before it reaches a message or log sink.
 *
 * Line breaks become the two-character escapes `\\r` / `\\n` so an adversarial
 * path such as `file.txt\nATTACK` cannot split an audit log into separate
 * physical lines. Null bytes and the remaining non-printable control
 * characters are removed.
 *
 * @param value - Text to sanitize.
 * @returns A single-line string free of control characters.
 */
export function sanitizeWorkspaceText(value: string): string {
  return value
    .replace(/\r/gu, '\\r')
    .replace(/\n/gu, '\\n')
    .replace(CONTROL_CHARACTER_PATTERN, '');
}

/** Stable, machine-readable workspace failure codes. */
export type WorkspaceErrorCode =
  | 'WORKSPACE_PATH_VIOLATION'
  | 'WORKSPACE_CONFIGURATION_INVALID'
  | 'WORKSPACE_NOT_INITIALIZED';

/** Context shared by every typed workspace failure. */
export interface WorkspaceErrorContext {
  readonly rule?: WorkspaceViolationRule;
  readonly root?: string;
  readonly candidatePath?: string;
  readonly reason?: string;
}

/**
 * Base class for every workspace domain failure.
 *
 * `candidatePath` echoes the caller's own input (it is the value the caller
 * already holds) and `root` is a canonical root the caller is allowed to know.
 * No other host path is embedded, so errors stay safe to serialize.
 *
 * Every caller-supplied string is sanitized before it is stored or
 * interpolated, so messages can never contain raw newlines or null bytes.
 */
export abstract class WorkspaceError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: WorkspaceErrorCode;

  /** Violated rule, when the failure is rule-specific. */
  public readonly rule?: WorkspaceViolationRule;

  /** Canonical root the failure is attributed to, when known. */
  public readonly root?: string;

  /** Caller-supplied path the failure is attributed to, when known. */
  public readonly candidatePath?: string;

  /** Human-readable explanation of the failure. */
  public readonly reason?: string;

  /**
   * @param message - Human-readable failure description.
   * @param context - Optional rule, root, candidate, and reason.
   */
  protected constructor(message: string, context?: WorkspaceErrorContext) {
    super(message);
    this.name = 'WorkspaceError';

    if (context?.rule !== undefined) {
      this.rule = context.rule;
    }

    if (context?.root !== undefined) {
      this.root = context.root;
    }

    if (context?.candidatePath !== undefined) {
      this.candidatePath = sanitizeWorkspaceText(context.candidatePath);
    }

    if (context?.reason !== undefined) {
      this.reason = sanitizeWorkspaceText(context.reason);
    }
  }
}

/** Raised when a path is malformed or escapes the workspace boundary. */
export class WorkspaceViolationError extends WorkspaceError {
  public readonly code = 'WORKSPACE_PATH_VIOLATION' as const;

  /**
   * Builds a violation.
   *
   * `root` is only published when the candidate the caller supplied was
   * already absolute: a caller that passed a relative path never learns the
   * host's canonical root through a thrown error.
   *
   * @param rule - Violated rule.
   * @param candidatePath - Path supplied by the caller.
   * @param reason - Human-readable explanation.
   * @param root - Canonical root the failure is attributed to, when known.
   */
  constructor(
    rule: WorkspaceViolationRule,
    candidatePath: string,
    reason: string,
    root?: string,
  ) {
    const safeCandidate = sanitizeWorkspaceText(candidatePath);
    const safeReason = sanitizeWorkspaceText(reason);
    const disclosedRoot = root !== undefined && ABSOLUTE_CANDIDATE_PATTERN.test(safeCandidate)
      ? root
      : undefined;

    super(
      `Workspace path violation (${rule}) for "${safeCandidate}": ${safeReason}`,
      {
        rule,
        candidatePath: safeCandidate,
        reason: safeReason,
        ...(disclosedRoot === undefined ? {} : { root: disclosedRoot }),
      },
    );
    this.name = 'WorkspaceViolationError';
  }
}

/** Raised when the declared root registry cannot be used. */
export class WorkspaceConfigurationError extends WorkspaceError {
  public readonly code = 'WORKSPACE_CONFIGURATION_INVALID' as const;

  /**
   * @param reason - Human-readable configuration failure.
   * @param rule - Configuration rule that failed.
   */
  constructor(reason: string, rule: WorkspaceViolationRule) {
    const safeReason = sanitizeWorkspaceText(reason);

    super(`Invalid workspace configuration: ${safeReason}`, { rule, reason: safeReason });
    this.name = 'WorkspaceConfigurationError';
  }
}

/** Raised when the service is used before its roots were registered. */
export class WorkspaceNotInitializedError extends WorkspaceError {
  public readonly code = 'WORKSPACE_NOT_INITIALIZED' as const;

  constructor() {
    super('Workspace service is not initialized: no workspace root is registered');
    this.name = 'WorkspaceNotInitializedError';
  }
}
