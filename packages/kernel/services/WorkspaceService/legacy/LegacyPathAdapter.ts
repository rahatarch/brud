import type { IWorkspaceService } from '../contracts/IWorkspaceService.js';
import { WorkspaceError, sanitizeWorkspaceText } from '../contracts/errors.js';
import type { WorkspaceViolationRule } from '../contracts/errors.js';

/**
 * Legacy path failure codes preserved at the boundary.
 *
 * These are the codes existing MCP clients and extension callers already
 * branch on; the adapter is the only place that translates kernel vocabulary
 * back into them.
 */
export type LegacyPathErrorCode =
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'VALIDATION_ERROR';

/** Temporary legacy-facing path bridge (rollout plan §3.3). */
export interface LegacyPathAdapter {
  /** Absolute or relative user input -> canonical kernel-relative path. */
  toKernelRelative(userPath: string, operationKind?: string): Promise<string>;

  /** Kernel-relative -> canonical absolute path for legacy results and UI. */
  toLegacyAbsolute(kernelRelativePath: string): string;
}

/** Non-throwing success value produced by {@link WorkspacePathAdapter.validate}. */
export interface LegacyPathSuccess {
  readonly ok: true;

  /** Canonical kernel-relative path (`''` for the workspace root). */
  readonly kernelRelative: string;

  /** Canonical absolute path. */
  readonly absolutePath: string;

  /** Canonical root that owns the path. */
  readonly root: string;

  /** Operation kind echoed back for downstream parity assertions. */
  readonly operationKind?: string;
}

/** Non-throwing failure value produced by {@link WorkspacePathAdapter.validate}. */
export interface LegacyPathFailure {
  readonly ok: false;

  /** Legacy error code the caller expects. */
  readonly code: LegacyPathErrorCode;

  /** Kernel rule that produced the failure. */
  readonly rule: WorkspaceViolationRule;

  /** Legacy-friendly message. */
  readonly friendly: string;

  /** Legacy-detailed message. */
  readonly details: string;

  /** Path supplied by the caller. */
  readonly path: string;

  /** Operation kind echoed back for downstream parity assertions. */
  readonly operationKind?: string;
}

/** Result of {@link WorkspacePathAdapter.validate}. */
export type LegacyPathValidation = LegacyPathSuccess | LegacyPathFailure;

const OUTSIDE_FRIENDLY = 'The path is outside the current workspace.';
const INVALID_FRIENDLY = 'The path is not valid.';

const OUTSIDE_RULES: ReadonlySet<WorkspaceViolationRule> = new Set<WorkspaceViolationRule>([
  'OUTSIDE_ROOT',
  'SIBLING_PREFIX',
  'SYMLINK_ESCAPE',
  'TRAVERSAL',
  'FILESYSTEM_ROOT',
  'UNKNOWN_ROOT',
  'UNVERIFIABLE_LINEAGE',
]);

/**
 * Legacy-facing path error carrying the pre-migration code vocabulary.
 *
 * The shape mirrors the legacy `BrudError` fields (`code`, `friendly`,
 * `details`, `path`) so an existing error mapper keeps working unchanged.
 */
export class LegacyPathError extends Error {
  /** Legacy error code. */
  readonly code: LegacyPathErrorCode;

  /** Kernel rule that produced the failure. */
  readonly rule: WorkspaceViolationRule;

  /** Legacy-friendly message. */
  readonly friendly: string;

  /** Legacy-detailed message. */
  readonly details: string;

  /** Path supplied by the caller. */
  readonly path: string;

  /** Operation kind the caller supplied, when any. */
  readonly operationKind?: string;

  /**
   * @param failure - Non-throwing failure value to promote to an exception.
   */
  constructor(failure: LegacyPathFailure) {
    super(failure.details);
    this.name = 'LegacyPathError';
    this.code = failure.code;
    this.rule = failure.rule;
    this.friendly = failure.friendly;
    this.details = failure.details;
    this.path = failure.path;

    if (failure.operationKind !== undefined) {
      this.operationKind = failure.operationKind;
    }
  }
}

/**
 * Translates between legacy absolute paths and kernel-relative descriptors.
 *
 * **Temporary boundary component.** The kernel never imports this module;
 * it exists for the legacy bridge and host adapters until Phase 11 and must
 * not be reached by a plugin. Work item 7 of §5.2 places it in the bridge
 * layer; it lives beside the workspace service for now because the adapter
 * package has not been migrated yet.
 *
 * Normative algorithm (§3.3):
 * 1. Reject NUL immediately as `VALIDATION_ERROR` / `NULL_BYTE`.
 * 2. Normalize separators for the host platform; never decode percent escapes.
 * 3. Absolute input is canonicalized through the workspace service and must be
 *    contained by a registered root, otherwise `PATH_OUTSIDE_WORKSPACE`.
 * 4. Relative input resolves against the primary root.
 * 5. `..` is rejected after canonicalization; the root prefix is stripped.
 * 6. The result uses `'/'` separators and is `''` for the root itself.
 */
export class WorkspacePathAdapter implements LegacyPathAdapter {
  private readonly workspace: IWorkspaceService;

  /**
   * @param workspace - Canonical workspace authority to translate through.
   */
  constructor(workspace: IWorkspaceService) {
    this.workspace = workspace;
  }

  async toKernelRelative(userPath: string, operationKind?: string): Promise<string> {
    const result = await this.validate(userPath, operationKind);

    if (!result.ok) {
      throw new LegacyPathError(result);
    }

    return result.kernelRelative;
  }

  toLegacyAbsolute(kernelRelativePath: string): string {
    try {
      return this.workspace.toAbsolutePath(kernelRelativePath);
    } catch (error: unknown) {
      throw new LegacyPathError(
        this.failureFromError(error, kernelRelativePath, undefined),
      );
    }
  }

  /**
   * Non-throwing translation used by the parity matrix and the legacy bridge.
   *
   * @param userPath - Absolute or relative user path.
   * @param operationKind - Legacy operation kind, echoed back for parity assertions.
   * @returns A success value or a legacy-coded failure value.
   */
  async validate(userPath: string, operationKind?: string): Promise<LegacyPathValidation> {
    if (typeof userPath !== 'string') {
      return this.failure(
        'INVALID_INPUT',
        '',
        'path must be a string',
        operationKind,
      );
    }

    if (userPath.includes('\0')) {
      return this.failure('NULL_BYTE', userPath, 'path contains a null byte', operationKind);
    }

    try {
      const location = await this.workspace.resolve(userPath);

      return {
        ok: true,
        kernelRelative: location.relativePath,
        absolutePath: location.absolutePath,
        root: location.root,
        ...(operationKind === undefined ? {} : { operationKind }),
      };
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) {
        return this.failureFromError(error, userPath, operationKind);
      }

      throw error;
    }
  }

  private failureFromError(
    error: unknown,
    userPath: string,
    operationKind: string | undefined,
  ): LegacyPathFailure {
    if (error instanceof WorkspaceError) {
      const rule = error.rule ?? 'INVALID_INPUT';

      return this.failure(rule, userPath, error.reason ?? error.message, operationKind);
    }

    return this.failure('INVALID_INPUT', userPath, 'path could not be translated', operationKind);
  }

  private failure(
    rule: WorkspaceViolationRule,
    userPath: string,
    reason: string,
    operationKind?: string,
  ): LegacyPathFailure {
    const code = this.codeFor(rule);
    const outside = code === 'PATH_OUTSIDE_WORKSPACE';
    const safePath = sanitizeWorkspaceText(userPath);
    const safeReason = sanitizeWorkspaceText(reason);

    return {
      ok: false,
      code,
      rule,
      friendly: outside ? OUTSIDE_FRIENDLY : INVALID_FRIENDLY,
      details: outside
        ? `The path "${safePath}" is outside the current workspace. File operations are restricted to files and folders inside the workspace. (${safeReason})`
        : `The path "${safePath}" is not valid: ${safeReason}`,
      path: userPath,
      ...(operationKind === undefined ? {} : { operationKind }),
    };
  }

  private codeFor(rule: WorkspaceViolationRule): LegacyPathErrorCode {
    if (OUTSIDE_RULES.has(rule)) {
      return 'PATH_OUTSIDE_WORKSPACE';
    }

    return 'VALIDATION_ERROR';
  }
}

/**
 * Builds the legacy path adapter for a workspace authority.
 *
 * @param workspace - Canonical workspace authority to translate through.
 * @returns A `LegacyPathAdapter` with a non-throwing `validate` helper.
 */
export function createLegacyPathAdapter(workspace: IWorkspaceService): WorkspacePathAdapter {
  return new WorkspacePathAdapter(workspace);
}
