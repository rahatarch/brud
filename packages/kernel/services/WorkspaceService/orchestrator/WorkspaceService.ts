import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type {
  IWorkspacePathPort,
  IWorkspaceResolutionBatch,
  IWorkspaceService,
  WorkspaceBatchStats,
  WorkspaceLocation,
  WorkspacePathFlavor,
  WorkspaceWarning,
} from '../contracts/IWorkspaceService.js';
import {
  WorkspaceConfigurationError,
  WorkspaceError,
  WorkspaceViolationError,
} from '../contracts/errors.js';
import {
  CanonicalizationCache,
  canonicalizeNearestExisting,
} from '../model/canonicalization.js';
import {
  assertSafeWorkspaceRelativePath,
  hasNullByte,
  isAbsolutePath,
  isAmbiguousAbsolutePath,
  isContainedInRoot,
  isDeviceOrNetworkRoot,
  isFilesystemRootPath,
  normalizeRootPath,
  pathApiFor,
  relativeWithinRoot,
  resolveWorkspaceFlavor,
  sharesTextualRootPrefix,
  toKernelSeparators,
} from '../model/pathRules.js';

/** Construction options for {@link WorkspaceService}. */
export interface WorkspaceServiceOptions {
  /** Declared roots. The first one is primary unless `primaryRoot` selects another. */
  readonly roots: readonly string[];

  /** Declared primary root. Ignored when it is not one of `roots`. */
  readonly primaryRoot?: string;

  /** Filesystem port used for canonicalization. */
  readonly port: IWorkspacePathPort;

  /** Path flavor. Defaults to the host platform. */
  readonly flavor?: WorkspacePathFlavor;

  /**
   * Allows a root that is a filesystem or volume root.
   *
   * Containment against `/` (or `C:\`) admits every path on the host, so it
   * must be requested explicitly.
   */
  readonly allowFilesystemRoot?: boolean;

  /** Optional sink for structured warnings. */
  readonly onWarning?: (warning: WorkspaceWarning) => void;
}

interface RootEntry {
  readonly declared: string;
  readonly canonical: string;
}

/**
 * Canonical workspace identity and path translation authority.
 *
 * Lifecycle: the constructor validates and registers the declared roots
 * synchronously; {@link initialize} canonicalizes them through `realpath` of
 * the nearest existing ancestor and is what the kernel calls at boot. Roots
 * stay authoritative for the whole boot lifetime: there is no reload path,
 * so containment cannot be relaxed mid-operation.
 *
 * The service is flavor-injected and only talks to an {@link IWorkspacePathPort},
 * so it holds no Node dependency and stays testable for both POSIX and Windows
 * semantics on one host.
 */
export class WorkspaceService implements IWorkspaceService, IServiceLifecycle {
  private entries: readonly RootEntry[];

  private primaryIndex = 0;

  private readonly flavorValue: WorkspacePathFlavor;

  private readonly port: IWorkspacePathPort;

  private readonly allowFilesystemRoot: boolean;

  private readonly onWarning: ((warning: WorkspaceWarning) => void) | undefined;

  private initialized = false;

  private initializing: Promise<void> | undefined;

  /**
   * @param options - Declared roots, filesystem port, flavor, and warning sink.
   * @throws {WorkspaceConfigurationError} When the root registry is unusable.
   */
  constructor(options: WorkspaceServiceOptions) {
    if (options.roots === undefined || options.roots.length === 0) {
      throw new WorkspaceConfigurationError(
        'at least one workspace root is required',
        'INVALID_INPUT',
      );
    }

    this.flavorValue = resolveWorkspaceFlavor(options.flavor);
    this.port = options.port;
    this.allowFilesystemRoot = options.allowFilesystemRoot === true;
    this.onWarning = options.onWarning;

    const declared: string[] = [];
    const seen = new Set<string>();

    for (const root of options.roots) {
      if (isDeviceOrNetworkRoot(root)) {
        throw new WorkspaceConfigurationError(
          'UNC, device, and NT object roots are not supported',
          'TRAVERSAL',
        );
      }

      const normalized = normalizeRootPath(root, this.flavorValue);

      if (!this.allowFilesystemRoot && isFilesystemRootPath(normalized, this.flavorValue)) {
        throw new WorkspaceConfigurationError(
          'a filesystem root requires allowFilesystemRoot',
          'FILESYSTEM_ROOT',
        );
      }

      const identity = this.rootIdentity(normalized);

      if (seen.has(identity)) {
        this.warn('ROOT_DUPLICATE', 'Duplicate workspace root declarations were collapsed');
        continue;
      }

      seen.add(identity);
      declared.push(normalized);
    }

    this.entries = declared.map((declaredRoot) => ({
      declared: declaredRoot,
      canonical: declaredRoot,
    }));

    if (options.primaryRoot !== undefined) {
      const primary = this.rootIdentity(normalizeRootPath(options.primaryRoot, this.flavorValue));
      const index = this.entries.findIndex((entry) => this.rootIdentity(entry.declared) === primary);

      if (index >= 0) {
        this.primaryIndex = index;
      }
    }

    this.warnOnOverlap();
  }

  /** Canonical roots, primary first. */
  get roots(): readonly string[] {
    return this.entries.map((entry) => entry.canonical);
  }

  /** Canonical primary root. */
  get primaryRoot(): string {
    return this.entryAt(this.primaryIndex).canonical;
  }

  /** Path flavor this instance evaluates paths with. */
  get flavor(): WorkspacePathFlavor {
    return this.flavorValue;
  }

  /** `true` once the declared roots were canonicalized through `realpath`. */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Canonicalizes every declared root through `realpath`.
   *
   * Idempotent and safe to call concurrently: the first call owns the work and
   * later callers await the same promise.
   *
   * @throws {WorkspaceConfigurationError} When a root canonicalizes onto a filesystem root.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initializing ??= this.canonicalizeRoots();

    await this.initializing;
  }

  async resolve(userPath: string): Promise<WorkspaceLocation> {
    await this.initialize();

    return this.resolveInternal(userPath);
  }

  /**
   * Strict resolver: canonicalizes, routes, and rejects any escape.
   *
   * Alias of {@link resolve} with the containment contract spelled out, used
   * by the legacy adapter and by kernels that want the word "contained" in
   * their call site.
   *
   * @param userPath - Absolute or relative user path.
   */
  async resolveContained(userPath: string): Promise<WorkspaceLocation> {
    return this.resolve(userPath);
  }

  /**
   * Resolves a path against a specific root instead of the primary one.
   *
   * Needed by multi-root hosts that already know which folder the operation
   * targets. An unknown hint is rejected rather than silently falling back to
   * the primary root.
   *
   * @param rootHint - Declared or canonical root to resolve against.
   * @param userPath - Absolute or relative user path.
   */
  async resolveInRoot(rootHint: string, userPath: string): Promise<WorkspaceLocation> {
    await this.initialize();

    const entry = this.requireRoot(rootHint);

    return this.resolveInternal(userPath, undefined, entry);
  }

  async contains(absolutePath: string): Promise<boolean> {
    await this.initialize();

    try {
      await this.resolveInternal(absolutePath);

      return true;
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) {
        return false;
      }

      throw error;
    }
  }

  async toKernelPath(userPath: string): Promise<string> {
    return (await this.resolve(userPath)).relativePath;
  }

  toAbsolutePath(kernelPath: string, rootHint?: string): string {
    const raw = this.assertString(kernelPath);
    const api = pathApiFor(this.flavorValue);

    if (hasNullByte(raw)) {
      throw new WorkspaceViolationError('NULL_BYTE', raw, 'path contains a null byte');
    }

    const safe = assertSafeWorkspaceRelativePath(raw, this.flavorValue);
    const target = rootHint === undefined ? this.entryAt(this.primaryIndex) : this.requireRoot(rootHint);
    const absolute = safe === '' || safe === '.'
      ? target.canonical
      : api.resolve(target.canonical, safe);

    if (!isContainedInRoot(target.canonical, absolute, this.flavorValue)) {
      throw new WorkspaceViolationError(
        'OUTSIDE_ROOT',
        raw,
        'resolved path escapes the workspace boundary',
        target.canonical,
      );
    }

    return absolute;
  }

  /**
   * Creates a batch view that reuses canonicalization results.
   *
   * @returns A batch-scoped resolver with hit/miss statistics.
   */
  createBatch(): IWorkspaceResolutionBatch {
    const cache = new CanonicalizationCache();

    return {
      resolve: async (userPath: string): Promise<WorkspaceLocation> => {
        await this.initialize();

        return this.resolveInternal(userPath, cache);
      },
      contains: async (absolutePath: string): Promise<boolean> => {
        await this.initialize();

        try {
          await this.resolveInternal(absolutePath, cache);

          return true;
        } catch (error: unknown) {
          if (error instanceof WorkspaceError) {
            return false;
          }

          throw error;
        }
      },
      toKernelPath: async (userPath: string): Promise<string> => {
        await this.initialize();

        return (await this.resolveInternal(userPath, cache)).relativePath;
      },
      get stats(): WorkspaceBatchStats {
        return { hits: cache.hits, misses: cache.misses };
      },
    };
  }

  private async canonicalizeRoots(): Promise<void> {
    const api = pathApiFor(this.flavorValue);
    const cache = new CanonicalizationCache();
    const canonicalEntries: RootEntry[] = [];

    for (const [index, entry] of this.entries.entries()) {
      const outcome = await cache.canonicalize(this.port, api, entry.declared);

      if (!outcome.ok) {
        this.warn(
          'ROOT_NOT_CANONICALIZED',
          `Workspace root #${index} is a dangling symbolic link; the lexical path is used`,
        );
        canonicalEntries.push(entry);
        continue;
      }

      if (!outcome.existed || outcome.degraded) {
        this.warn(
          'ROOT_NOT_CANONICALIZED',
          `Workspace root #${index} could not be fully canonicalized; the nearest existing ancestor was used`,
        );
      }

      const canonical = normalizeRootPath(outcome.canonical, this.flavorValue);

      if (!this.allowFilesystemRoot && isFilesystemRootPath(canonical, this.flavorValue)) {
        throw new WorkspaceConfigurationError(
          `workspace root #${index} canonicalizes to a filesystem root, which requires allowFilesystemRoot`,
          'FILESYSTEM_ROOT',
        );
      }

      canonicalEntries.push({ declared: entry.declared, canonical });
    }

    const primaryDeclared = this.entries[this.primaryIndex]?.declared;
    const seen = new Set<string>();
    const deduped: RootEntry[] = [];

    for (const entry of canonicalEntries) {
      const identity = this.rootIdentity(entry.canonical);

      if (seen.has(identity)) {
        this.warn('ROOT_DUPLICATE', 'Workspace roots canonicalized onto the same directory');
        continue;
      }

      seen.add(identity);
      deduped.push(entry);
    }

    this.entries = deduped;

    const primaryCanonical = canonicalEntries.find(
      (candidate) => candidate.declared === primaryDeclared,
    )?.canonical;
    const primaryMatch = primaryCanonical === undefined
      ? -1
      : deduped.findIndex(
        (entry) => this.rootIdentity(entry.canonical) === this.rootIdentity(primaryCanonical),
      );

    this.primaryIndex = primaryMatch >= 0 ? primaryMatch : 0;
    this.initialized = true;
    this.warnOnOverlap();
  }

  private async resolveInternal(
    userPath: string,
    cache?: CanonicalizationCache,
    rootOverride?: RootEntry,
  ): Promise<WorkspaceLocation> {
    const raw = this.assertString(userPath);
    const api = pathApiFor(this.flavorValue);

    if (hasNullByte(raw)) {
      throw new WorkspaceViolationError('NULL_BYTE', raw, 'path contains a null byte');
    }

    const danglingSymlink = (candidate: string, root: string): WorkspaceViolationError =>
      new WorkspaceViolationError(
        'SYMLINK_ESCAPE',
        candidate,
        'symbolic link target does not exist or cannot be resolved',
        root,
      );

    let lexicalTarget: string;
    let logicalRoot: string;

    if (raw === '' || raw === '.') {
      const entry = rootOverride ?? this.entryAt(this.primaryIndex);
      lexicalTarget = entry.canonical;
      logicalRoot = entry.canonical;
    } else if (isAbsolutePath(raw, this.flavorValue)) {
      if (isAmbiguousAbsolutePath(raw, this.flavorValue)) {
        throw new WorkspaceViolationError(
          'TRAVERSAL',
          raw,
          'UNC, device, and drive-relative paths are not permitted',
        );
      }

      lexicalTarget = api.resolve(raw);

      if (rootOverride === undefined) {
        logicalRoot = this.routeLexical(lexicalTarget, raw).canonical;
      } else if (this.isWithinRootHint(rootOverride, lexicalTarget)) {
        // The hint is authoritative: an absolute path is never silently
        // re-routed to a different root, even when another root owns it.
        logicalRoot = rootOverride.canonical;
      } else {
        throw new WorkspaceViolationError(
          'OUTSIDE_ROOT',
          raw,
          'the absolute path is outside the requested workspace root',
          rootOverride.canonical,
        );
      }
    } else {
      const safe = assertSafeWorkspaceRelativePath(raw, this.flavorValue);
      const entry = rootOverride ?? this.entryAt(this.primaryIndex);
      logicalRoot = entry.canonical;
      lexicalTarget = safe === '' || safe === '.'
        ? entry.canonical
        : api.resolve(entry.canonical, safe);
    }

    let outcome;

    try {
      outcome = cache === undefined
        ? await canonicalizeNearestExisting(this.port, api, lexicalTarget)
        : await cache.canonicalize(this.port, api, lexicalTarget);
    } catch (error: unknown) {
      if (error instanceof WorkspaceError) {
        // Re-anchor an internal lineage failure on the caller's own input so
        // the internal absolute probe path never reaches the caller.
        throw new WorkspaceViolationError(
          error.rule ?? 'UNVERIFIABLE_LINEAGE',
          raw,
          error.reason ?? 'the workspace ancestry could not be verified',
          logicalRoot,
        );
      }

      throw error;
    }

    if (!outcome.ok) {
      throw danglingSymlink(raw, logicalRoot);
    }

    const entry = this.routeCanonical(outcome.canonical, raw, logicalRoot, rootOverride);

    return {
      root: entry.canonical,
      absolutePath: outcome.canonical,
      relativePath: toKernelSeparators(
        relativeWithinRoot(entry.canonical, outcome.canonical, this.flavorValue),
        this.flavorValue,
      ),
    };
  }

  /** Reports whether a lexical candidate falls under a root or its declared alias. */
  private isWithinRootHint(entry: RootEntry, candidate: string): boolean {
    return isContainedInRoot(entry.canonical, candidate, this.flavorValue)
      || isContainedInRoot(entry.declared, candidate, this.flavorValue);
  }

  private requireRoot(rootHint: string): RootEntry {
    let identity: string;

    try {
      identity = this.rootIdentity(normalizeRootPath(rootHint, this.flavorValue));
    } catch {
      throw new WorkspaceViolationError(
        'UNKNOWN_ROOT',
        rootHint,
        'the requested root is not an absolute registered workspace root',
      );
    }

    const entry = this.entries.find(
      (candidate) => this.rootIdentity(candidate.canonical) === identity
        || this.rootIdentity(candidate.declared) === identity,
    );

    if (entry === undefined) {
      throw new WorkspaceViolationError(
        'UNKNOWN_ROOT',
        rootHint,
        'the requested root is not registered in this workspace',
      );
    }

    return entry;
  }

  private routeLexical(lexicalTarget: string, raw: string): RootEntry {
    const canonicalMatches = this.entries.filter(
      (entry) => isContainedInRoot(entry.canonical, lexicalTarget, this.flavorValue),
    );

    if (canonicalMatches.length > 1) {
      throw new WorkspaceViolationError(
        'AMBIGUOUS_ROOT',
        raw,
        'the path is contained by more than one workspace root',
      );
    }

    if (canonicalMatches.length === 1) {
      return canonicalMatches[0] as RootEntry;
    }

    // A root reached through a symbolic link is still a legitimate prefix for
    // a legacy caller: the declared alias is admitted here and the canonical
    // routing below still has to prove containment.
    const declaredMatches = this.entries.filter(
      (entry) => isContainedInRoot(entry.declared, lexicalTarget, this.flavorValue),
    );

    if (declaredMatches.length > 1) {
      throw new WorkspaceViolationError(
        'AMBIGUOUS_ROOT',
        raw,
        'the path is contained by more than one declared workspace root',
      );
    }

    if (declaredMatches.length === 1) {
      return declaredMatches[0] as RootEntry;
    }

    const sibling = this.entries.flatMap((entry) => [entry.canonical, entry.declared]).find(
      (root) => sharesTextualRootPrefix(root, lexicalTarget, this.flavorValue),
    );

    throw new WorkspaceViolationError(
      sibling === undefined ? 'OUTSIDE_ROOT' : 'SIBLING_PREFIX',
      raw,
      sibling === undefined
        ? 'the path is outside every workspace root'
        : 'the path shares a textual prefix with a workspace root but is not contained by it',
      sibling,
    );
  }

  private routeCanonical(
    canonicalTarget: string,
    raw: string,
    logicalRoot: string,
    rootOverride?: RootEntry,
  ): RootEntry {
    if (rootOverride !== undefined) {
      if (isContainedInRoot(rootOverride.canonical, canonicalTarget, this.flavorValue)) {
        // An explicit hint disambiguates nested roots: the caller's root wins
        // over every other root that also contains the target.
        return rootOverride;
      }

      throw new WorkspaceViolationError(
        'SYMLINK_ESCAPE',
        raw,
        'resolved real path escapes the requested workspace root through a symbolic link',
        rootOverride.canonical,
      );
    }

    const matches = this.entries.filter(
      (entry) => isContainedInRoot(entry.canonical, canonicalTarget, this.flavorValue),
    );

    if (matches.length === 1) {
      return matches[0] as RootEntry;
    }

    if (matches.length > 1) {
      throw new WorkspaceViolationError(
        'AMBIGUOUS_ROOT',
        raw,
        'the canonical path is contained by more than one workspace root',
      );
    }

    // The logical path was admitted by a registered root, so leaving every
    // root here means a symbolic link redirected the real path outwards.
    throw new WorkspaceViolationError(
      'SYMLINK_ESCAPE',
      raw,
      'resolved real path escapes the workspace boundary through a symbolic link',
      logicalRoot,
    );
  }

  private entryAt(index: number): RootEntry {
    const entry = this.entries[index];

    if (entry === undefined) {
      throw new WorkspaceConfigurationError('workspace root registry is empty', 'INVALID_INPUT');
    }

    return entry;
  }

  private rootIdentity(root: string): string {
    if (this.flavorValue === 'win32') {
      return root.toLowerCase();
    }

    return root;
  }

  private assertString(value: unknown): string {
    if (typeof value !== 'string') {
      throw new WorkspaceViolationError('INVALID_INPUT', '', 'path must be a string');
    }

    return value;
  }

  private warnOnOverlap(): void {
    for (let outer = 0; outer < this.entries.length; outer += 1) {
      for (let inner = 0; inner < this.entries.length; inner += 1) {
        if (outer === inner) {
          continue;
        }

        const outerEntry = this.entryAt(outer);
        const innerEntry = this.entryAt(inner);

        if (isContainedInRoot(outerEntry.canonical, innerEntry.canonical, this.flavorValue)) {
          this.warn(
            'ROOT_OVERLAP',
            'Workspace roots overlap; paths inside both are rejected as ambiguous',
          );

          return;
        }
      }
    }
  }

  private warn(code: WorkspaceWarning['code'], message: string): void {
    if (this.onWarning === undefined) {
      return;
    }

    try {
      this.onWarning({ code, message });
    } catch {
      // A broken warning sink must never fail boot or containment.
    }
  }
}
