/**
 * Path-rule adapter over the canonical lexical path engine.
 *
 * `PathValidator` extends `LexicalPathEngine` and translates thrown kernel
 * violations into the external `PathRuleViolationError` at the boundary.
 */
import { LexicalPathEngine } from '../../../ValidationService/engine/LexicalPathEngine.js';
import { PathViolationError } from '../../../ValidationService/contracts/errors.js';
import type { PathRule } from '../../../ValidationService/contracts/rules.js';
import type { ValidationFlavor } from '../../../ValidationService/contracts/IValidationService.js';
import { PathRuleViolationError, toExternalPathRule } from './errors.js';

export { assertSafeRelativePath, defaultPathFlavor } from '../../../ValidationService/engine/pathLexicon.js';
export { PathRuleViolationError } from './errors.js';
export type { ValidationFlavor as PathFlavor } from '../../../ValidationService/contracts/IValidationService.js';
export type { PathRule } from '../../../ValidationService/contracts/rules.js';
export type { PathViolationDetails, ExternalPathRule } from './errors.js';

/** Options for {@link PathValidator}. */
export interface PathValidatorOptions {
  readonly flavor?: ValidationFlavor;
}

export type PathResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: PathRuleViolationError };

export type PathResolutionSuccess = Extract<PathResolution, { readonly ok: true }>;

export type PathResolutionFailure = Extract<PathResolution, { readonly ok: false }>;

/**
 * Translates kernel path violations into the external error type.
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
   * Resolves a relative path, rethrowing kernel violations in the external shape.
   *
   * @param relativePath - Relative path text.
   */
  override resolve(relativePath: string): string {
    try {
      return super.resolve(relativePath);
    } catch (error: unknown) {
      throw this.toPathRuleViolation(error, relativePath);
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
      throw this.toPathRuleViolation(error, relativePath);
    }
  }

  /**
   * Non-throwing resolution with the external error type.
   *
   * @param relativePath - Relative path text.
   */
  override tryResolve(relativePath: string): PathResolution {
    try {
      return { ok: true, path: this.resolve(relativePath) };
    } catch (error: unknown) {
      if (error instanceof PathRuleViolationError) {
        return { ok: false, error };
      }

      throw error;
    }
  }

  private toPathRuleViolation(error: unknown, relativePath: string): unknown {
    if (error instanceof PathViolationError) {
      return new PathRuleViolationError({
        rule: toExternalPathRule(error.rule as PathRule),
        root: error.root,
        candidatePath: error.path.length > 0 ? error.path : relativePath,
        reason: error.reason,
      });
    }

    return error;
  }
}
