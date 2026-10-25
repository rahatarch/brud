/**
 * Path flavor a workspace authority evaluates paths against.
 *
 * The flavor is injected rather than derived so Windows semantics stay
 * testable on POSIX hosts and vice versa.
 */
export type WorkspacePathFlavor = 'posix' | 'win32';

/**
 * One resolved point inside the workspace.
 *
 * Every field is canonical: `root` and `absolutePath` come from `realpath` of
 * the nearest existing ancestor, and `relativePath` is the kernel-relative
 * descriptor (`'/'` separators, empty string for the root itself).
 */
export interface WorkspaceLocation {
  /**
   * Canonical real path of the owning root.
   *
   * Retained so callers can round-trip a location through
   * `toAbsolutePath(location.relativePath, location.root)` without losing the
   * secondary root it belongs to.
   */
  readonly root: string;

  /** Canonical absolute path of the resolved target. */
  readonly absolutePath: string;

  /** Kernel-relative path using `'/'` separators; `''` for the root itself. */
  readonly relativePath: string;
}

/**
 * Canonical workspace identity and path translation authority.
 *
 * The kernel speaks workspace-relative paths only. Hosts and legacy callers
 * speak absolute paths and may have several roots; this service is the single
 * place where the two are reconciled.
 *
 * All resolvers are strict: they canonicalize through real paths, reject
 * sibling-prefix matches with a segment-aware comparison, and reject symlink
 * traversal that leaves the owning root.
 */
export interface IWorkspaceService {
  /** Canonical roots, primary first. */
  readonly roots: readonly string[];

  /** Canonical root relative paths are resolved against by default. */
  readonly primaryRoot: string;

  /**
   * Resolves an absolute or relative user path into a canonical location.
   *
   * @param userPath - Absolute path, or relative path resolved against the primary root.
   * @returns The owning root, canonical absolute path, and kernel-relative path.
   * @throws {WorkspaceViolationError} When the path is malformed or not contained.
   */
  resolve(userPath: string): Promise<WorkspaceLocation>;

  /**
   * Reports whether an absolute (or primary-root-relative) path is contained.
   *
   * Predicate semantics: every violation, including null bytes and symlink
   * escapes, yields `false` instead of throwing.
   *
   * @param absolutePath - Candidate path to test.
   * @returns `true` when the canonical target lives inside a registered root.
   */
  contains(absolutePath: string): Promise<boolean>;

  /**
   * Translates a user path into a kernel-relative descriptor.
   *
   * @param userPath - Absolute or relative user path.
   * @returns `'/'`-separated relative path; `''` for the root itself.
   */
  toKernelPath(userPath: string): Promise<string>;

  /**
   * Translates a kernel-relative descriptor back into an absolute path.
   *
   * Synchronous and purely lexical: kernel paths are already canonical, so no
   * filesystem access and no re-encoding are required.
   *
   * @param kernelPath - Kernel-relative path (`'/'` separators, `''` for the root).
   * @param rootHint - Registered canonical root to resolve against. Defaults to
   * the primary root. Pass `location.root` from a {@link WorkspaceLocation} to
   * round-trip a path that belongs to a secondary root.
   * @returns Canonical absolute path under the selected root.
   * @throws {WorkspaceViolationError} When the descriptor is unsafe or the
   * hint is not a registered root.
   */
  toAbsolutePath(kernelPath: string, rootHint?: string): string;
}

/** Minimal filesystem surface the workspace authority needs. */
export interface IWorkspacePathPort {
  /**
   * Returns metadata for an existing entry, or `null` when it does not exist.
   *
   * @param absolutePath - Absolute path to inspect without following links.
   */
  lstat(absolutePath: string): Promise<WorkspacePathEntry | null>;

  /**
   * Resolves every symbolic link in an absolute path.
   *
   * @param absolutePath - Existing absolute path.
   */
  realpath(absolutePath: string): Promise<string>;
}

/** Subset of `lstat` output the workspace authority consults. */
export interface WorkspacePathEntry {
  readonly isSymbolicLink: boolean;

  /**
   * Modification time of the node, when the port can report it.
   *
   * Batch cache hits compare it against the memoized value so a node swapped
   * in place is re-canonicalized instead of trusted.
   */
  readonly mtimeMs?: number;
}

/** Machine-readable classification of a non-fatal workspace condition. */
export type WorkspaceWarningCode =
  | 'ROOT_NOT_CANONICALIZED'
  | 'ROOT_DUPLICATE'
  | 'ROOT_OVERLAP';

/**
 * Structured, path-free warning produced while canonicalizing roots.
 *
 * Messages carry root labels (index) rather than absolute host paths so they
 * can cross an RPC boundary safely.
 */
export interface WorkspaceWarning {
  readonly code: WorkspaceWarningCode;
  readonly message: string;
}

/** Hit and miss counters for a batch-scoped canonicalization cache. */
export interface WorkspaceBatchStats {
  /** Canonicalizations served from the batch cache. */
  readonly hits: number;

  /** Canonicalizations that reached the filesystem port. */
  readonly misses: number;
}

/**
 * Batch-scoped view over {@link IWorkspaceService}.
 *
 * A batch reuses canonicalization results for its lifetime, which is what the
 * legacy path cache did per operation batch. Results for paths that do not
 * exist are never memoized, so create targets stay accurate.
 */
export interface IWorkspaceResolutionBatch {
  /**
   * Resolves a user path using the batch cache.
   *
   * @param userPath - Absolute or relative user path.
   */
  resolve(userPath: string): Promise<WorkspaceLocation>;

  /**
   * Tests containment using the batch cache.
   *
   * @param absolutePath - Candidate path to test.
   */
  contains(absolutePath: string): Promise<boolean>;

  /**
   * Translates a user path using the batch cache.
   *
   * @param userPath - Absolute or relative user path.
   */
  toKernelPath(userPath: string): Promise<string>;

  /** Cache statistics for this batch. */
  readonly stats: WorkspaceBatchStats;
}
