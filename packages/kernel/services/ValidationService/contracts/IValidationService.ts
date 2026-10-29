import type { ValidationDecision } from './errors.js';
import type { ValidationRule } from './rules.js';

/** Path flavor validation evaluates against. */
export type ValidationFlavor = 'posix' | 'win32';

/**
 * Operation classification used by path validation.
 *
 * Only mutating kinds reach the A10 protected-path gate; read kinds may still
 * observe protected paths through the owning service.
 */
export type OperationAccess = 'read' | 'mutate' | 'delete' | 'catalog';

/** Frozen policy ingested from the boot settings snapshot. */
export interface ValidationPolicy {
  readonly workspaceBoundaryEnabled: boolean;
  readonly commandValidationEnabled: boolean;
  readonly toolAllowList: Readonly<Record<string, boolean>>;
  readonly readConcurrency: number;
  readonly readMaxBatchFiles: number;
  readonly readMaxAggregateBytes: number;
  readonly schemaVersion: 1;
}

/**
 * Result of a successful path validation.
 *
 * `absolutePath` is canonical through the workspace authority when the
 * workspace boundary is enabled; when it is disabled the result is the
 * lexical resolution against the primary root.
 */
export interface ValidatedPath {
  /** Canonical absolute path. */
  readonly absolutePath: string;
  /** Caller-supplied path, echoed unchanged. */
  readonly path: string;
  /** Owning canonical root. */
  readonly root: string;
  /** Kernel-relative path, `''` for the root itself. */
  readonly relativePath: string;
  /** Operation kind echoed from the request, when supplied. */
  readonly operationKind?: string;
}

/** Narrowed, fully validated view of a path request. */
export type PathValidationOutcome =
  | { readonly ok: true; readonly location: ValidatedPath }
  | { readonly ok: false; readonly decision: Extract<ValidationDecision, { readonly ok: false }> };

/** Environment facts the command scanner needs. */
export interface ValidationEnvironment {
  /** User home directory used to expand `~`. */
  readonly homeDirectory: string;
  /** Path flavor for cwd resolution. */
  readonly flavor: ValidationFlavor;
}

/**
 * Path containment and translation authority.
 *
 * The kernel workspace service satisfies this structurally; tests may supply
 * a fake. Implementations must be internally consistent: `roots` is the
 * registered registry, every `resolve` result is canonical, and
 * `toKernelPath` mirrors `resolve`.
 */
export interface ValidationWorkspacePort {
  /** Registered roots, primary first. */
  readonly roots: readonly string[];
  /** Root relative paths resolve against. */
  readonly primaryRoot: string;
  /** Canonicalizes and proves containment. */
  resolve(userPath: string): Promise<{
    readonly root: string;
    readonly absolutePath: string;
    readonly relativePath: string;
  }>;
  /** Translates a relative kernel path under a root into an absolute path. */
  toAbsolutePath(kernelPath: string, rootHint?: string): string;
}

/**
 * Stable validation gate used by every tool transport and plugin.
 *
 * All three methods are decision-producing and never throw for invalid input.
 * Driver faults (a storage backend that fails unexpectedly) propagate as
 * exceptions; rule violations never do.
 */
export interface IValidationService {
  /**
   * Validates a path for an operation kind.
   *
   * Lexical integrity rules are always applied. Workspace containment is
   * applied while `workspaceBoundaryEnabled` is frozen `true`. Read kinds
   * skip the A10 protected-path gate; every mutating kind is denied.
   *
   * @param input - Absolute or workspace-relative path.
   * @param operationKind - Operation kind (one of the 21 catalogued kinds).
   */
  validatePath(input: string, operationKind?: string): Promise<ValidationDecision>;

  /**
   * Validates a shell command and its working directory.
   *
   * Command rules are applied only while `commandValidationEnabled` is frozen
   * `true`; there is no per-call override. `cwd` is optional and, when given,
   * must be inside the workspace.
   *
   * @param command - Shell command text.
   * @param cwd - Working directory for `cd` chain evaluation.
   */
  validateCommand(command: string, cwd?: string): ValidationDecision;

  /**
   * Validates an operation payload against the 21-kind constraint matrix.
   *
   * @param kind - Operation kind.
   * @param input - Operation payload.
   */
  validateInput(kind: string, input: unknown): ValidationDecision;

  /**
   * Returns the frozen policy this instance was constructed with.
   */
  getPolicy(): ValidationPolicy;

  /**
   * Reports the retryability/actionability flags of a rule.
   *
   * @param rule - Rule id.
   */
  describeRule(rule: ValidationRule): RuleTraits;
}

/** Actionability and retryability metadata for a rule. */
export interface RuleTraits {
  /** A user/host can fix the input. */
  readonly actionable: boolean;

  /** The same input may succeed later without change. */
  readonly retryable: boolean;
}
