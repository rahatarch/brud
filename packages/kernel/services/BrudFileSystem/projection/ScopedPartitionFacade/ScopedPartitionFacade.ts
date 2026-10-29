import type { DirectoryEntry, FileStats } from '../../../../drivers/contracts/index.js';
import type { IBrudFileSystem } from '../../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { assertNotProtectedPath } from '../../security/protectedPaths.js';
// Path rules come from the canonical validation engine; `validation/
// PathValidator` is now only a deprecated alias for the same implementation.
// The facade keeps the legacy `PathTraversalViolationError` at its boundary,
// which every existing caller narrows on.
import { PathViolationError } from '../../../ValidationService/contracts/errors.js';
import {
  assertSafeRelativePath as assertCanonicalRelativePath,
  defaultPathFlavor,
} from '../../../ValidationService/engine/pathLexicon.js';
import type { PathRule } from '../../../ValidationService/contracts/rules.js';
import type { ValidationFlavor as PathFlavor } from '../../../ValidationService/contracts/IValidationService.js';
import { PathTraversalViolationError, toLegacyRule } from '../../validation/PathValidator/errors.js';

/**
 * Applies the canonical lexical rules and rethrows in the legacy shape.
 *
 * @param candidate - Relative path text.
 * @param flavor - Path flavor.
 */
function assertSafeRelativePath(candidate: string, flavor: PathFlavor): string {
  try {
    return assertCanonicalRelativePath(candidate, flavor);
  } catch (error: unknown) {
    if (error instanceof PathViolationError) {
      throw new PathTraversalViolationError({
        rule: toLegacyRule(error.rule as PathRule),
        root: '',
        candidatePath: candidate,
        reason: error.reason,
      });
    }

    throw error;
  }
}

/**
 * Mutating members of the facade contract.
 *
 * Every one of them is routed through {@link ScopedPartitionFacade.toMutableScopedPath},
 * which is where a read-only projection is enforced.
 */
export type PartitionMutationKind = 'writeAtomic' | 'createFile' | 'deleteFile';

/**
 * Failure raised when a mutation targets a read-only projection.
 *
 * It carries the structured `INPUT.READ_ONLY_PROJECTION` rule next to the
 * legacy `VALIDATION_ERROR` code, so callers can narrow on either the rule or
 * the code without reaching into the service.
 */
export class ReadOnlyProjectionViolationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  readonly rule = 'INPUT.READ_ONLY_PROJECTION';

  readonly operationKind: PartitionMutationKind;

  readonly path: string;

  constructor(operationKind: PartitionMutationKind, projectionPath: string) {
    super(
      `"${operationKind}" cannot mutate a read-only projection ("${projectionPath}"). `
      + 'The projection is pinned read-only and rejects every write or delete.',
    );
    this.name = 'ReadOnlyProjectionViolationError';
    this.operationKind = operationKind;
    this.path = projectionPath;
  }
}

export interface ScopedPartitionFacadeOptions {
  readonly flavor?: PathFlavor;
  /**
   * Pins the projection read-only.
   *
   * A read-only facade serves every read member unchanged and rejects
   * `writeAtomic`, `createFile` and `deleteFile` with a
   * {@link ReadOnlyProjectionViolationError} before the scoped path reaches the
   * underlying service, so `INPUT.READ_ONLY_PROJECTION` has a live emission
   * site in the write-routing layer.
   */
  readonly readOnly?: boolean;
}

function normalizePartitionPrefix(prefix: string, flavor: PathFlavor): string {
  const safePrefix = assertSafeRelativePath(prefix, flavor);
  const segments = safePrefix
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.length === 0) {
    throw new PathTraversalViolationError({
      rule: 'TRAVERSAL',
      root: '',
      candidatePath: prefix,
      reason: 'partition prefix must not resolve to the workspace root',
    });
  }

  return segments.join('/');
}

export class ScopedPartitionFacade implements IBrudFileSystem {
  private readonly service: IBrudFileSystem;

  private readonly scopePrefix: string;

  private readonly pathFlavor: PathFlavor;

  private readonly readOnly: boolean;

  constructor(
    service: IBrudFileSystem,
    partitionPrefix: string,
    options?: ScopedPartitionFacadeOptions,
  ) {
    this.service = service;
    this.pathFlavor = options?.flavor ?? defaultPathFlavor();
    this.readOnly = options?.readOnly === true;
    this.scopePrefix = normalizePartitionPrefix(partitionPrefix, this.pathFlavor);
  }

  get partitionPrefix(): string {
    return this.scopePrefix;
  }

  /** Whether this projection rejects every mutation. */
  get isReadOnly(): boolean {
    return this.readOnly;
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    return this.service.readFile(this.toScopedPath(relativePath));
  }

  async readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    return this.service.readText(this.toScopedPath(relativePath), encoding);
  }

  async writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    const scopedPath = this.toMutableScopedPath(relativePath, 'writeAtomic');

    await this.service.writeAtomic(scopedPath, data);
  }

  async createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    const scopedPath = this.toMutableScopedPath(relativePath, 'createFile');

    await this.service.createFile(scopedPath, data, options);
  }

  async deleteFile(relativePath: string): Promise<void> {
    const scopedPath = this.toMutableScopedPath(relativePath, 'deleteFile');

    await this.service.deleteFile(scopedPath);
  }

  async readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    return this.service.readDirectory(this.toScopedPath(relativeDirectoryPath));
  }

  async stat(relativePath: string): Promise<FileStats | null> {
    return this.service.stat(this.toScopedPath(relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    return this.service.exists(this.toScopedPath(relativePath));
  }

  private toScopedPath(relativePath: string): string {
    const safePath = assertSafeRelativePath(relativePath, this.pathFlavor);

    if (safePath === '' || safePath === '.') {
      return this.scopePrefix;
    }

    return `${this.scopePrefix}/${safePath}`;
  }

  /**
   * Resolves a mutation target, enforcing the read-only projection first.
   *
   * The read-only verdict short-circuits before lexical resolution, so a
   * read-only facade reports the projection rule even for a path that would
   * also be rejected as unsafe.
   *
   * @param relativePath - Partition-relative target.
   * @param operationKind - Mutating member being called.
   */
  private toMutableScopedPath(relativePath: string, operationKind: PartitionMutationKind): string {
    if (this.readOnly) {
      throw new ReadOnlyProjectionViolationError(
        operationKind,
        typeof relativePath === 'string' ? relativePath : String(relativePath),
      );
    }

    const scopedPath = this.toScopedPath(relativePath);

    assertNotProtectedPath(scopedPath);

    return scopedPath;
  }
}
