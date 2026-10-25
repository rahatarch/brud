import type { PlatformPath } from 'node:path';
import type {
  IWorkspacePathPort,
  WorkspacePathEntry,
} from '../contracts/IWorkspaceService.js';
import { WorkspaceViolationError } from '../contracts/errors.js';
import type { WorkspaceViolationRule } from '../contracts/errors.js';

/** Successful canonicalization of a path, existing or not. */
export interface CanonicalPathSuccess {
  readonly ok: true;

  /** Canonical form of the nearest existing ancestor plus the missing tail. */
  readonly canonical: string;

  /** `true` when the target itself exists, so the canonical form is complete. */
  readonly existed: boolean;

  /** `true` when `realpath` failed and the lexical path was kept instead. */
  readonly degraded: boolean;
}

/** Failure to canonicalize because a symbolic link cannot be resolved. */
export interface CanonicalPathFailure {
  readonly ok: false;
  readonly reason: 'DANGLING_SYMLINK';
}

/** Result of {@link canonicalizeNearestExisting}. */
export type CanonicalPathOutcome = CanonicalPathSuccess | CanonicalPathFailure;

/** Reads the `code` discriminant from a thrown filesystem error. */
function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as { readonly code?: unknown }).code;

  return typeof code === 'string' ? code : undefined;
}

/**
 * Builds a fail-closed error for an ancestor that cannot be inspected.
 *
 * Only absence (`ENOENT`) may be read as "does not exist". Permission
 * boundaries (`EACCES`, `EPERM`), link loops (`ELOOP`), non-directory
 * ancestors (`ENOTDIR`), and unknown failures all mean the lineage is
 * unverifiable, so the path is rejected instead of being resolved lexically.
 *
 * @param target - Absolute path that could not be inspected.
 * @param code - Errno code reported by the port, when any.
 */
function inspectionViolation(target: string, code: string | undefined): WorkspaceViolationError {
  const rule: WorkspaceViolationRule = code === 'ELOOP'
    ? 'SYMLINK_ESCAPE'
    : 'UNVERIFIABLE_LINEAGE';
  const detail = code === undefined ? 'an unknown filesystem failure' : `"${code}"`;
  const reason = code === 'ELOOP'
    ? 'the path crosses a symbolic link loop and cannot be verified'
    : `the workspace ancestry could not be inspected (${detail})`;

  return new WorkspaceViolationError(rule, target, reason);
}

/**
 * Canonicalizes a path through the nearest existing ancestor.
 *
 * Non-existent create targets must stay resolvable, so the walk ascends until
 * an entry exists, resolves that entry through `realpath`, and re-appends the
 * missing segments. A dangling symbolic link is reported as a failure because
 * its target cannot be verified.
 *
 * Ancestor inspection is fail-closed: only `ENOENT` counts as absence, so an
 * unreadable or looping ancestor throws instead of degrading to a lexical
 * path.
 *
 * @param port - Filesystem port used for `lstat` and `realpath`.
 * @param api - Path implementation matching the active flavor.
 * @param target - Absolute path to canonicalize.
 * @returns The canonical path, or a dangling-symlink failure.
 * @throws {WorkspaceViolationError} When an ancestor cannot be verified.
 */
export async function canonicalizeNearestExisting(
  port: IWorkspacePathPort,
  api: PlatformPath,
  target: string,
): Promise<CanonicalPathOutcome> {
  const missingSegments: string[] = [];
  let current = target;

  for (;;) {
    const entry = await lstatOrNull(port, current);

    if (entry !== null) {
      try {
        const real = await port.realpath(current);

        return {
          ok: true,
          canonical: missingSegments.length === 0
            ? real
            : api.resolve(real, ...missingSegments.slice().reverse()),
          existed: missingSegments.length === 0,
          degraded: false,
        };
      } catch (error: unknown) {
        const code = errorCodeOf(error);

        if (code === 'ENOENT') {
          if (entry.isSymbolicLink) {
            return { ok: false, reason: 'DANGLING_SYMLINK' };
          }

          return { ok: true, canonical: target, existed: false, degraded: true };
        }

        throw inspectionViolation(target, code);
      }
    }

    const parent = api.dirname(current);

    if (parent === current) {
      return { ok: true, canonical: target, existed: false, degraded: true };
    }

    missingSegments.push(api.basename(current));
    current = parent;
  }
}

async function lstatOrNull(
  port: IWorkspacePathPort,
  absolutePath: string,
): Promise<WorkspacePathEntry | null> {
  try {
    return await port.lstat(absolutePath);
  } catch (error: unknown) {
    const code = errorCodeOf(error);

    if (code === 'ENOENT') {
      return null;
    }

    throw inspectionViolation(absolutePath, code);
  }
}

interface CacheEntry {
  readonly canonical: string;
  readonly isSymbolicLink: boolean;
  readonly mtimeMs?: number;
}

/**
 * Batch-scoped canonicalization cache.
 *
 * Mirrors the legacy `PathCache` contract: the root and every existing path
 * are memoized for the life of the batch, non-existent paths never are, so a
 * create target is re-resolved on every call and `realpath` results are never
 * stale for a file that appears mid-batch.
 *
 * A memoized entry is revalidated before it is served. Positive existence
 * cached for the whole batch would otherwise leave a TOCTOU window in which an
 * in-workspace file is swapped for an escaping symlink mid-batch, so every hit
 * re-stats the canonical target (and its immediate parent) and checks that the
 * node mode and `mtimeMs` are unchanged. A swapped node invalidates the entry
 * and forces a full `realpath` verification.
 */
export class CanonicalizationCache {
  private readonly entries = new Map<string, CacheEntry>();

  private hitCount = 0;

  private missCount = 0;

  /** Canonicalizations served from this cache. */
  get hits(): number {
    return this.hitCount;
  }

  /** Canonicalizations that reached the filesystem port. */
  get misses(): number {
    return this.missCount;
  }

  /** Number of memoized paths. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Canonicalizes a path, memoizing only existing targets.
   *
   * @param port - Filesystem port used for `lstat` and `realpath`.
   * @param api - Path implementation matching the active flavor.
   * @param target - Absolute path to canonicalize.
   * @throws {WorkspaceViolationError} When an ancestor cannot be verified.
   */
  async canonicalize(
    port: IWorkspacePathPort,
    api: PlatformPath,
    target: string,
  ): Promise<CanonicalPathOutcome> {
    const cached = this.entries.get(target);

    if (cached !== undefined) {
      if (await this.revalidate(port, api, cached)) {
        this.hitCount += 1;

        return { ok: true, canonical: cached.canonical, existed: true, degraded: false };
      }

      this.entries.delete(target);
    }

    this.missCount += 1;
    const outcome = await canonicalizeNearestExisting(port, api, target);

    if (outcome.ok && outcome.existed && !outcome.degraded) {
      const current = await lstatOrNull(port, outcome.canonical);

      if (current !== null) {
        this.entries.set(target, {
          canonical: outcome.canonical,
          isSymbolicLink: current.isSymbolicLink,
          ...(current.mtimeMs === undefined ? {} : { mtimeMs: current.mtimeMs }),
        });
      }
    }

    return outcome;
  }

  /** Drops every memoized entry, keeping the counters. */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Confirms that a memoized target still describes the same filesystem node.
   *
   * @param port - Filesystem port used for `lstat`.
   * @param api - Path implementation matching the active flavor.
   * @param entry - Memoized canonicalization.
   * @returns `true` when the entry is still safe to serve from cache.
   */
  private async revalidate(
    port: IWorkspacePathPort,
    api: PlatformPath,
    entry: CacheEntry,
  ): Promise<boolean> {
    const current = await lstatOrNull(port, entry.canonical);

    if (current === null || current.isSymbolicLink) {
      return false;
    }

    if (
      entry.mtimeMs !== undefined
      && current.mtimeMs !== undefined
      && entry.mtimeMs !== current.mtimeMs
    ) {
      return false;
    }

    const parent = api.dirname(entry.canonical);

    if (parent !== entry.canonical) {
      const parentEntry = await lstatOrNull(port, parent);

      if (parentEntry === null || parentEntry.isSymbolicLink) {
        return false;
      }
    }

    return true;
  }
}
