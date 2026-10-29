import type { PlatformPath } from 'node:path';
import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import type { PathRule } from '../contracts/rules.js';
import type { ValidationFlavor } from '../contracts/IValidationService.js';
import { PathViolationError } from '../contracts/errors.js';
import { isProtectedWritePath } from '../../BrudFileSystem/security/protectedPaths.js';
import {
  DRIVE_QUALIFIER_PATTERN,
  NULL_BYTE_PATTERN,
  UNC_PATTERN,
  classifyPath,
  classifyRelativePath,
  defaultPathFlavor,
  pathApiFor,
} from './pathLexicon.js';

export { PathViolationError } from '../contracts/errors.js';

/** Options for a {@link LexicalPathEngine} instance. */
export interface LexicalPathEngineOptions {
  /** Path flavor. Defaults to the host platform. */
  readonly flavor?: ValidationFlavor;
}

/** Non-throwing lexical resolution result. */
export type LexicalResolution =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: PathViolationError };

/** Named rule predicates evaluated for a relative candidate. */
export type RelativePathRuleName =
  | 'PATH.NULL_BYTE'
  | 'PATH.UNC_OR_DEVICE'
  | 'PATH.DRIVE_QUALIFIED'
  | 'PATH.ABSOLUTE'
  | 'PATH.PARENT_SEGMENT'
  | 'PATH.WIN_TRAILING_DOT_OR_SPACE'
  | 'PATH.WIN_TRAILING_ALIAS_TRAVERSAL'
  | 'PATH.WIN_RESERVED_DEVICE'
  | 'PATH.WIN_ALT_DATA_STREAM';

/** One evaluated rule and whether the candidate violates it. */
export interface RelativePathRuleOutcome {
  readonly rule: RelativePathRuleName;
  readonly violated: boolean;
}

function violation(rule: PathRule, root: string, candidatePath: string, reason: string): PathViolationError {
  return new PathViolationError(rule, candidatePath, reason, root);
}

/**
 * Canonical lexical path validator.
 *
 * Migrated from `BrudFileSystem/validation/PathValidator/PathValidator.ts`
 * with no behavioral change for V-1..V-11 consumers: it stays synchronous,
 * driver-free for the lexical path, and takes the storage driver as an
 * argument (never a module-level import) for realpath containment.
 *
 * New in this engine:
 *
 * - `classify()` returns every rule verdict for a candidate instead of only
 *   the first throw, which the orchestrator needs for the 68-rule matrix.
 * - `isMutableTarget()` applies the A10 denylist to any relative path so
 *   directory kinds are covered too.
 *
 * The class no longer owns the regexes: `pathLexicon.ts` is the single owner.
 */
export class LexicalPathEngine {
  private readonly api: PlatformPath;

  private readonly rootPath: string;

  private readonly pathFlavor: ValidationFlavor;

  /**
   * @param root - Absolute root the engine resolves against.
   * @param options - Flavor override.
   * @throws {Error} When the root is empty, relative, or null-byte-bearing.
   */
  constructor(root: string, options?: LexicalPathEngineOptions) {
    this.pathFlavor = options?.flavor ?? defaultPathFlavor();
    this.api = pathApiFor(this.pathFlavor);

    if (root.length === 0 || NULL_BYTE_PATTERN.test(root)) {
      throw new Error('Root path must be a non-empty absolute path without null bytes');
    }

    if (!this.api.isAbsolute(root)) {
      throw new Error(`Root path must be absolute for the "${this.pathFlavor}" flavor: "${root}"`);
    }

    this.rootPath = this.api.resolve(root);
  }

  /** Normalized root this engine resolves against. */
  get root(): string {
    return this.rootPath;
  }

  /** Path flavor. */
  get flavor(): ValidationFlavor {
    return this.pathFlavor;
  }

  /**
   * Resolves a relative path lexically and proves it stays inside the root.
   *
   * @param relativePath - Relative path text.
   * @throws {PathViolationError} When a lexical rule is violated.
   */
  resolve(relativePath: string): string {
    const violationResult = classifyRelativePath(relativePath, this.pathFlavor);

    if (violationResult !== null) {
      throw violation(violationResult.rule, this.rootPath, relativePath, violationResult.reason);
    }

    if (relativePath === '' || relativePath === '.') {
      return this.rootPath;
    }

    const absolutePath = this.api.resolve(this.rootPath, relativePath);
    this.assertWithinBoundary(absolutePath, relativePath);

    return absolutePath;
  }

  /** Alias of {@link resolve}. */
  assertValid(relativePath: string): string {
    return this.resolve(relativePath);
  }

  /** Alias of {@link resolve}. */
  validate(relativePath: string): string {
    return this.resolve(relativePath);
  }

  /**
   * Meets the `PathValidator` contract used by `ScopedPartitionFacade`.
   *
   * @deprecated Use {@link assertValid}; retained for the Phase 5 flip.
   * @param relativePath - Relative path text.
   */
  assertSafeRelativePath(relativePath: string): string {
    const flavor = this.pathFlavor;
    const violationResult = classifyRelativePath(relativePath, flavor);

    if (violationResult !== null) {
      throw violation(violationResult.rule, this.rootPath, relativePath, violationResult.reason);
    }

    return relativePath;
  }

  /**
   * Resolves without throwing.
   *
   * @param relativePath - Relative path text.
   */
  tryResolve(relativePath: string): LexicalResolution {
    try {
      return { ok: true, path: this.resolve(relativePath) };
    } catch (error: unknown) {
      if (error instanceof PathViolationError) {
        return { ok: false, error };
      }

      throw error;
    }
  }

  /**
   * Reports containment without throwing.
   *
   * @param relativePath - Relative path text.
   */
  isContained(relativePath: string): boolean {
    return this.tryResolve(relativePath).ok;
  }

  /**
   * Enumerates every lexical rule verdict for a candidate.
   *
   * Windows-only segment rules report `violated: false` on POSIX because they
   * are not part of that flavor's rule set.
   *
   * @param relativePath - Candidate relative path.
   */
  classify(relativePath: string): readonly RelativePathRuleOutcome[] {
    const first = classifyRelativePath(relativePath, this.pathFlavor);
    const flavor = this.pathFlavor;
    const segments = relativePath.split(/[\\/]/u);
    const hasParent = segments.some((segment) => segment === '..');

    return [
      { rule: 'PATH.NULL_BYTE', violated: NULL_BYTE_PATTERN.test(relativePath) },
      { rule: 'PATH.UNC_OR_DEVICE', violated: UNC_PATTERN.test(relativePath) },
      { rule: 'PATH.DRIVE_QUALIFIED', violated: DRIVE_QUALIFIER_PATTERN.test(relativePath) },
      { rule: 'PATH.ABSOLUTE', violated: this.api.isAbsolute(relativePath) },
      { rule: 'PATH.PARENT_SEGMENT', violated: flavor === 'win32' ? false : hasParent },
      { rule: 'PATH.WIN_TRAILING_DOT_OR_SPACE', violated: first?.rule === 'PATH.WIN_TRAILING_DOT_OR_SPACE' },
      { rule: 'PATH.WIN_TRAILING_ALIAS_TRAVERSAL', violated: first?.rule === 'PATH.WIN_TRAILING_ALIAS_TRAVERSAL' },
      { rule: 'PATH.WIN_RESERVED_DEVICE', violated: first?.rule === 'PATH.WIN_RESERVED_DEVICE' },
      { rule: 'PATH.WIN_ALT_DATA_STREAM', violated: first?.rule === 'PATH.WIN_ALT_DATA_STREAM' },
    ];
  }

  /**
   * Canonicalizes the nearest existing ancestor and proves symlink containment.
   *
   * @param relativePath - Relative path text.
   * @param driver - Storage driver used for `exists`, `lstat`, and `realpath`.
   * @throws {PathViolationError} On a lexical violation or `PATH.SYMLINK_ESCAPE`.
   */
  async resolveContained(relativePath: string, driver: IStorageDriver): Promise<string> {
    const lexicalPath = this.assertValid(relativePath);
    const realRoot = await driver.realpath(this.rootPath);
    const realCandidate = await this.resolveNearestExistingRealPath(driver, lexicalPath, relativePath);

    if (!this.isWithinRealBoundary(realRoot, realCandidate)) {
      throw violation(
        'PATH.SYMLINK_ESCAPE',
        this.rootPath,
        relativePath,
        'resolved real path escapes the workspace boundary through a symbolic link',
      );
    }

    return realCandidate;
  }

  /**
   * Reports whether a relative path may be mutated under the A10 denylist.
   *
   * Covers file and directory kinds alike: `.brud/settings.json`,
   * `.brud/history/**` and `.git/**` are never mutable, and the workspace root
   * itself (`''` / `'.'`) is not a mutable target.
   *
   * @param relativePath - Kernel-relative path.
   */
  isMutableTarget(relativePath: string): boolean {
    if (relativePath === '' || relativePath === '.') {
      return false;
    }

    return !isProtectedWritePath(relativePath);
  }

  /**
   * Reports whether a candidate is inside the root without throwing.
   *
   * Absolute candidates are compared segment-aware; relative candidates go
   * through the lexical rules and a lexical resolve.
   *
   * @param candidate - Absolute or relative candidate.
   */
  contains(candidate: string): boolean {
    const classification = classifyPath(candidate, this.pathFlavor);

    if (classification.kind === 'ambiguous-absolute') {
      return false;
    }

    if (classification.kind === 'absolute') {
      return this.isWithinRealBoundary(this.rootPath, classification.normalized);
    }

    return this.isContained(candidate);
  }

  private async resolveNearestExistingRealPath(
    driver: IStorageDriver,
    target: string,
    candidatePath: string,
  ): Promise<string> {
    const missingSegments: string[] = [];
    let current = target;

    for (;;) {
      if (await driver.exists(current)) {
        const realCurrent = await driver.realpath(current);

        if (missingSegments.length === 0) {
          return realCurrent;
        }

        return this.api.resolve(realCurrent, ...missingSegments.slice().reverse());
      }

      const entry = await driver.lstat(current);

      if (entry?.isSymbolicLink === true) {
        throw violation(
          'PATH.SYMLINK_ESCAPE',
          this.rootPath,
          candidatePath,
          'symbolic link target does not exist or cannot be resolved',
        );
      }

      const parent = this.api.dirname(current);

      if (parent === current) {
        return target;
      }

      missingSegments.push(this.api.basename(current));
      current = parent;
    }
  }

  private isWithinRealBoundary(realRoot: string, realCandidate: string): boolean {
    const relativePath = this.api.relative(realRoot, realCandidate);

    return relativePath === ''
      || (
        relativePath !== '..'
        && !relativePath.startsWith(`..${this.api.sep}`)
        && !this.api.isAbsolute(relativePath)
      );
  }

  private assertWithinBoundary(absolutePath: string, originalPath: string): void {
    if (this.isWithinRealBoundary(this.rootPath, absolutePath)) {
      return;
    }

    throw violation(
      'PATH.OUTSIDE_ROOT',
      this.rootPath,
      originalPath,
      'resolved path escapes the workspace boundary',
    );
  }
}
