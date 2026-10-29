/**
 * Deprecated re-export of the canonical lexical path engine.
 *
 * Phase 3 moved path validation to
 * `ValidationService/engine/LexicalPathEngine.ts` (rollout plan W-1). This
 * module keeps the pre-Phase-3 class name, constructor, methods and error
 * shape so `ScopedPartitionFacade`, `WorkspaceService/model/pathRules.ts` and
 * `PathValidator.test.ts` keep working unchanged; it is removed in Phase 5.
 *
 * There is exactly one implementation: {@link PathValidator} extends
 * `LexicalPathEngine` and only translates the thrown error class at the
 * boundary.
 */
import { LexicalPathEngine } from '../../../ValidationService/engine/LexicalPathEngine.js';
import { PathViolationError } from '../../../ValidationService/contracts/errors.js';
import type { PathRule } from '../../../ValidationService/contracts/rules.js';
import type { ValidationFlavor } from '../../../ValidationService/contracts/IValidationService.js';
import { PathTraversalViolationError, toLegacyRule } from './errors.js';

export { assertSafeRelativePath, defaultPathFlavor } from '../../../ValidationService/engine/pathLexicon.js';
export { PathTraversalViolationError } from './errors.js';
export type { ValidationFlavor as PathFlavor } from '../../../ValidationService/contracts/IValidationService.js';
export type { PathRule } from '../../../ValidationService/contracts/rules.js';
export type { PathViolationDetails, PathViolationRule } from './errors.js';

/** Options for {@link PathValidator}. */
export interface PathValidatorOptions {
  readonly flavor?: ValidationFlavor;
}

/** @deprecated Use `LexicalResolution` from `ValidationService/engine`. */
export type PathResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: PathTraversalViolationError };

/** @deprecated Use `LexicalResolution` from `ValidationService/engine`. */
export type PathResolutionSuccess = Extract<PathResolution, { readonly ok: true }>;

/** @deprecated Use `LexicalResolution` from `ValidationService/engine`. */
export type PathResolutionFailure = Extract<PathResolution, { readonly ok: false }>;

/**
 * @deprecated Use `LexicalPathEngine` from `ValidationService/engine`.
 */
export class PathValidator extends LexicalPathEngine {
  /**
   * @param root - Absolute root.
   * @param options - Flavor override.
   */
  constructor(root: string, options?: PathValidatorOptions) {
    super(root, options);
  }

  /**
   * Resolves a relative path, rethrowing kernel violations in the legacy shape.
   *
   * @param relativePath - Relative path text.
   */
  override resolve(relativePath: string): string {
    try {
      return super.resolve(relativePath);
    } catch (error: unknown) {
      throw this.toLegacy(error, relativePath);
    }
  }

  /**
   * Canonicalizes through the nearest existing ancestor.
   *
   * @param relativePath - Relative path text.
   * @param driver - Storage driver.
   */
  override async resolveContained(
    relativePath: string,
    driver: Parameters<LexicalPathEngine['resolveContained']>[1],
  ): Promise<string> {
    try {
      return await super.resolveContained(relativePath, driver);
    } catch (error: unknown) {
      throw this.toLegacy(error, relativePath);
    }
  }

  /**
   * Non-throwing resolution with the legacy error type.
   *
   * @param relativePath - Relative path text.
   */
  override tryResolve(relativePath: string): PathResolution {
    try {
      return { ok: true, path: this.resolve(relativePath) };
    } catch (error: unknown) {
      if (error instanceof PathTraversalViolationError) {
        return { ok: false, error };
      }

      throw error;
    }
  }

  private toLegacy(error: unknown, relativePath: string): unknown {
    if (error instanceof PathViolationError) {
      return new PathTraversalViolationError({
        rule: toLegacyRule(error.rule as PathRule),
        root: error.root,
        candidatePath: error.path.length > 0 ? error.path : relativePath,
        reason: error.reason,
      });
    }

    return error;
  }
}
