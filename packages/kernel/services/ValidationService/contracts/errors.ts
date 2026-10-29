import type {
  InputRule,
  PathRule,
  ValidationRule,
  CommandRule,
} from './rules.js';

/**
 * Machine-readable kernel codes.
 *
 * The kernel never emits a legacy code directly (rollout plan Appendix C);
 * the facade maps these onto the legacy vocabulary. Every code is stable and
 * may be persisted, so values must not be renamed without a migration.
 */
export type ValidationCode =
  | 'PATH_TRAVERSAL_DETECTED'
  | 'WORKSPACE_PATH_VIOLATION'
  | 'WORKSPACE_CONFIGURATION_INVALID'
  | 'NO_WORKSPACE'
  | 'CWD_ESCAPE'
  | 'INVALID_CWD'
  | 'DYNAMIC_PATH'
  | 'DANGEROUS_COMMAND'
  | 'TERMINAL_UNAVAILABLE'
  | 'UNKNOWN_OPERATION'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_DISABLED'
  | 'MISSING_FIELD'
  | 'MISSING_INDEX'
  | 'INVALID_FIELD'
  | 'INVALID_LINE_RANGE'
  | 'PARSE_ERROR'
  | 'NO_VALID_OPERATIONS'
  | 'NO_EXTRACT_OPERATIONS'
  | 'PREVIEW_NOT_AVAILABLE'
  | 'NO_PREVIEW'
  | 'SEARCH_NOT_FOUND'
  | 'MULTIPLE_MATCHES'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'CANNOT_WRITE_DIRECTORY'
  | 'CANNOT_DELETE_DIRECTORY'
  | 'FILE_NOT_FOUND'
  | 'FILE_ALREADY_EXISTS'
  | 'DIRECTORY_NOT_FOUND'
  | 'DIRECTORY_ALREADY_EXISTS'
  | 'DELETE_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'INVALID_REVERT_REQUEST'
  | 'READ_ONLY_VIOLATION'
  | 'UNEXPECTED_ERROR'
  | 'E_METADATA_WRONG_CASE'
  | 'E_DUPLICATE_SESSION_METADATA'
  | 'E_DUPLICATE_OPERATION_METADATA'
  | 'E_METADATA_FIELD_CASE'
  | 'E_METADATA_UNKNOWN_FIELD'
  | 'E_SESSION_METADATA_POSITION'
  | 'E_OPERATION_METADATA_POSITION'
  | 'E_METADATA_UNCLOSED';

/**
 * Non-throwing decision returned by every validation entry point.
 *
 * `ok: true` carries no payload so callers cannot infer authority from a
 * partially populated failure. Failures always carry a code, the violated
 * rule, the legacy-compatible friendly text and the details template.
 */
export type ValidationDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: ValidationCode;
      readonly rule: ValidationRule;
      /**
       * Facade-level code a legacy caller sees for this failure.
       *
       * Normally identical to `code`; path and workspace failures differ
       * because Appendix C maps the structured kernel code onto the legacy
       * vocabulary (`PATH_OUTSIDE_WORKSPACE`, `VALIDATION_ERROR`,
       * `NO_WORKSPACE`) at the boundary.
       */
      readonly legacyCode: string;
      readonly friendly: string;
      readonly details: string;
      readonly path?: string;
      readonly operationKind?: string;
      readonly command?: string;
      /** The caller can fix the input without waiting. */
      readonly actionable: boolean;
      /** The same input may succeed later without change. */
      readonly retryable: boolean;
      /** Structured, path-free extras such as `patternIndex` or `limit`. */
      readonly metadata?: Readonly<Record<string, string | number | boolean>>;
    };

/** Successful decision singleton. */
export const VALIDATION_OK: ValidationDecision = Object.freeze({ ok: true });

/** Inputs accepted by {@link validationFailure}. */
export interface ValidationFailureDetails {
  readonly code: ValidationCode;
  readonly rule: ValidationRule;
  readonly legacyCode: string;
  readonly friendly: string;
  readonly details: string;
  readonly path?: string;
  readonly operationKind?: string;
  readonly command?: string;
  readonly actionable: boolean;
  readonly retryable: boolean;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Builds a frozen failure decision.
 *
 * @param details - Code, rule, legacy code, messages and flags.
 */
export function validationFailure(details: ValidationFailureDetails): ValidationDecision {
  return Object.freeze({
    ok: false as const,
    code: details.code,
    rule: details.rule,
    legacyCode: details.legacyCode,
    friendly: details.friendly,
    details: details.details,
    actionable: details.actionable,
    retryable: details.retryable,
    ...(details.path === undefined ? {} : { path: details.path }),
    ...(details.operationKind === undefined ? {} : { operationKind: details.operationKind }),
    ...(details.command === undefined ? {} : { command: details.command }),
    ...(details.metadata === undefined ? {} : { metadata: details.metadata }),
  });
}

/**
 * Narrows a decision to its failure arm.
 *
 * @param decision - Decision to narrow.
 */
export function isValidationFailure(
  decision: ValidationDecision,
): decision is Extract<ValidationDecision, { readonly ok: false }> {
  return !decision.ok;
}

/** Raised by storage gates that need an exception instead of a decision. */
export type ValidationExceptionCode =
  | 'PATH_TRAVERSAL_DETECTED'
  | 'WORKSPACE_PATH_VIOLATION';

/**
 * Base class for driver-level validation exceptions.
 *
 * `ValidationService` never rethrows these from its public methods: it
 * converts them into {@link ValidationDecision} failures. They exist for the
 * low-level engines (`LexicalPathEngine`, `PolicyGateEngine`) which are also
 * called directly by storage gates.
 */
export abstract class ValidationViolationError extends Error {
  public abstract readonly code: ValidationExceptionCode;

  /**
   * Violated rule id.
   *
   * Typed as `string` because the legacy adapter re-exposes the pre-Phase-3
   * six-member vocabulary on this property, so `assert.equal(error.rule,
   * 'TRAVERSAL')` keeps compiling and passing unchanged. Every kernel engine
   * sets it to a {@link ValidationRule}.
   */
  public rule: string;

  /** Caller-supplied path. */
  public readonly path: string;

  /** Human-readable explanation. */
  public readonly reason: string;

  /**
   * @param message - Full message.
   * @param rule - Violated rule.
   * @param path - Caller-supplied path.
   * @param reason - Explanation.
   */
  protected constructor(
    message: string,
    rule: ValidationRule,
    path: string,
    reason: string,
  ) {
    super(message);
    this.name = 'ValidationViolationError';
    this.rule = rule;
    this.path = path;
    this.reason = reason;
  }
}

/** Raised when a lexical path rule is violated. */
export class PathViolationError extends ValidationViolationError {
  public readonly code = 'PATH_TRAVERSAL_DETECTED' as const;

  /** Canonical root the violation is attributed to. */
  public readonly root: string;

  /**
   * @param rule - Path rule that failed.
   * @param candidatePath - Caller-supplied path.
   * @param reason - Explanation.
   * @param root - Canonical root, when known.
   */
  constructor(rule: PathRule, candidatePath: string, reason: string, root = '') {
    super(`Path violation (${rule}) for "${candidatePath}": ${reason}`, rule, candidatePath, reason);
    this.name = 'PathViolationError';
    this.root = root;
  }
}

/** Raised when a mutation targets a protected path or the workspace root. */
export class ProtectedPathDeniedError extends ValidationViolationError {
  public readonly code = 'WORKSPACE_PATH_VIOLATION' as const;

  /** Canonical root the violation is attributed to. */
  public readonly root: string;

  /**
   * @param rule - `PATH_PROTECTED_DENY` or `PATH_ROOT_NOT_MUTABLE`.
   * @param candidatePath - Caller-supplied path.
   * @param reason - Explanation.
   * @param root - Canonical root, when known.
   */
  constructor(
    rule: Extract<PathRule, 'PATH.PROTECTED_DENY' | 'PATH.ROOT_NOT_MUTABLE'>,
    candidatePath: string,
    reason: string,
    root = '',
  ) {
    super(`Protected path (${rule}) "${candidatePath}": ${reason}`, rule, candidatePath, reason);
    this.name = 'ProtectedPathDeniedError';
    this.root = root;
  }
}

/** Raised when a kind is not one of the closed 21-kind vocabulary. */
export class UnknownOperationKindError extends ValidationViolationError {
  public readonly code = 'WORKSPACE_PATH_VIOLATION' as const;

  /**
   * @param kind - Unrecognised kind.
   */
  constructor(kind: string) {
    super(`Unknown operation kind "${kind}"`, 'INPUT.UNKNOWN_OPERATION', '', kind);
    this.name = 'UnknownOperationKindError';
  }
}

/** Raised when an input rule is violated during `validateInput`. */
export class InputValidationError extends ValidationViolationError {
  public readonly code = 'WORKSPACE_PATH_VIOLATION' as const;

  /** Structured rule, narrowed to the input family. */
  public readonly inputRule: InputRule;

  /**
   * @param rule - Input rule that failed.
   * @param reason - Explanation.
   */
  constructor(rule: InputRule, reason: string) {
    super(`Input violation (${rule}): ${reason}`, rule, '', reason);
    this.name = 'InputValidationError';
    this.inputRule = rule;
  }
}

/** Raised when a command is blocked. */
export class CommandBlockedError extends ValidationViolationError {
  public readonly code = 'WORKSPACE_PATH_VIOLATION' as const;

  /** Structured rule, narrowed to the command family. */
  public readonly commandRule: CommandRule;

  /** Index of the pattern that matched, when applicable. */
  public readonly patternIndex: number | undefined;

  /**
   * @param rule - Command rule that failed.
   * @param command - Blocked command.
   * @param reason - Explanation.
   * @param patternIndex - Matching pattern index.
   */
  constructor(rule: CommandRule, command: string, reason: string, patternIndex?: number) {
    super(`Command blocked (${rule}): ${reason}`, rule, command, reason);
    this.name = 'CommandBlockedError';
    this.commandRule = rule;
    this.patternIndex = patternIndex;
  }
}
