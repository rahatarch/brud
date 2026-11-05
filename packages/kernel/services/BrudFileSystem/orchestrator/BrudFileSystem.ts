import { dirname } from 'node:path';
import type { DirectoryEntry, FileStats, IStorageDriver } from '../../../drivers/contracts/index.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type {
  IWorkspaceService,
  WorkspaceLocation,
  WorkspacePathFlavor,
} from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { WorkspaceViolationError } from '../../WorkspaceService/contracts/errors.js';
import { WorkspaceService } from '../../WorkspaceService/orchestrator/WorkspaceService.js';
import { createStorageDriverPathPort } from '../../WorkspaceService/ports/StorageDriverPathPort.js';
import { KeyedWriteMutex } from '../concurrency/KeyedWriteMutex/KeyedWriteMutex.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { createFileMutationJournal } from '../events/FileMutationJournal.js';
import {
  captureMutationState,
  directoryState,
  fileStateFromPayload,
  missingState,
} from '../events/hash.js';
import type {
  FileMutationEvent,
  FileMutationListener,
  FileMutationOperation,
  FileMutationPhase,
  FileMutationState,
  IFileMutationJournal,
} from '../events/types.js';
import { createFile as createFileOperation } from '../operations/create_file/createFile.js';
import { copy as copyOperation } from '../operations/copy/copy.js';
import { createDirectory as createDirectoryOperation } from '../operations/create_directory/createDirectory.js';
import { deleteDirectory as deleteDirectoryOperation } from '../operations/delete_directory/deleteDirectory.js';
import { deleteFile as deleteFileOperation } from '../operations/delete_file/deleteFile.js';
import { readFile as readFileOperation, readText as readTextOperation } from '../operations/read_file/readFile.js';
import { readDirectory as readDirectoryOperation } from '../operations/read_directory/readDirectory.js';
import { rename as renameOperation } from '../operations/rename/rename.js';
import {
  CommittedWithDurabilityWarningError,
  FileAlreadyExistsError,
  FileSystemError,
} from '../operations/shared/errors.js';
import { createStagingPath, sweepStaleStagingFiles } from '../operations/shared/staging.js';
import { statPath as statPathOperation } from '../operations/stat_path/statPath.js';
import { writeAtomic as writeAtomicOperation } from '../operations/write_atomic/writeAtomic.js';
import { assertNotProtectedPath } from '../security/protectedPaths.js';
import { TrustedFileSystemProjection } from './TrustedFileSystemProjection.js';

/** Minimal logger surface accepted by {@link BrudFileSystem}. */
export interface IFileSystemLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

/** Configuration for {@link BrudFileSystem}. */
export interface BrudFileSystemOptions {
  /** Path flavor used when a workspace root string is supplied. */
  readonly flavor?: WorkspacePathFlavor;

  /** Diagnostic root hint used before the workspace authority is resolved. */
  readonly root?: string;

  /**
   * Pluggable history hook sink. Defaults to a private journal that stays
   * disabled until a listener subscribes through {@link BrudFileSystem.onMutation}.
   */
  readonly mutationJournal?: IFileMutationJournal;

  /**
   * Protected prefixes this instance is the owning writer for.
   *
   * Empty by default. The history subsystem is the only core service that may
   * stage under `.brud/history`, and it receives the capability through the
   * descriptor projection rather than a blanket constructor flag in the
   * standard kernel.
   */
  readonly trustedWriteScopes?: readonly string[];

  /** Receives staging-sweep failures. Defaults to the logger warning sink. */
  readonly onCleanupError?: (error: unknown, absolutePath: string) => void;

  /** Kernel logger used for non-fatal cleanup failures. Defaults to console. */
  readonly logger?: IFileSystemLogger;
}

/** A resolved workspace authority, or a probe that supplies one. */
export type WorkspaceAuthority = IWorkspaceService | (() => IWorkspaceService);

/**
 * Workspace authority surface the filesystem needs.
 *
 * `resolveContained` is the class-level spelling of `resolve` that states the
 * guarantee at the call site. Implementations that only expose `resolve` are
 * still accepted for compatibility.
 */
interface WorkspacePathAuthority extends IWorkspaceService {
  resolveContained(userPath: string): Promise<WorkspaceLocation>;
}

function supportsResolveContained(
  workspace: IWorkspaceService,
): workspace is WorkspacePathAuthority {
  return typeof (workspace as Partial<WorkspacePathAuthority>).resolveContained === 'function';
}

interface ResolvedTarget {
  readonly workspace: IWorkspaceService;
  readonly location: WorkspaceLocation;
}

interface TargetValidation {
  readonly stats: FileStats | null;
}

const DEFAULT_LOGGER: IFileSystemLogger = {
  warn: (message, meta) => {
    console.warn(message, meta ?? {});
  },
};

/**
 * Atomic filesystem service over a scoped storage driver.
 *
 * Path authority is not implemented here. Every public operation asks
 * `WorkspaceService` to canonicalize the caller's path and prove containment
 * before any driver call. Storage drivers only ever receive canonical absolute
 * paths produced by the workspace authority. Absolute paths are accepted only
 * when they resolve strictly inside the canonical workspace root.
 *
 * Mutations are serialized per canonical target and staged through an
 * unpredictable sibling file created with `O_EXCL`. The staged file is flushed
 * before an atomic rename/link. The mutation journal is published only after
 * staging succeeds, so a failed filesystem call produces no phantom history.
 */
export class BrudFileSystem implements IBrudFileSystem, IServiceLifecycle {
  private readonly driver: IStorageDriver;

  private readonly workspaceProvider: WorkspaceAuthority;

  private readonly writeMutex = new KeyedWriteMutex();

  private readonly journal: IFileMutationJournal;

  private readonly trustedWriteScopes: readonly string[];

  private readonly onCleanupError: ((error: unknown, absolutePath: string) => void) | undefined;

  private readonly logger: IFileSystemLogger;

  private workspaceInstance: IWorkspaceService | undefined;

  private rootHint: string;

  /**
   * @param workspaceOrRoot - Canonical workspace authority, a probe returning
   * one, or a workspace root string for standalone construction.
   * @param driver - Scoped storage driver.
   * @param options - Flavor, root hint, journal, and trusted scope overrides.
   */
  constructor(
    workspaceOrRoot: WorkspaceAuthority | string,
    driver: IStorageDriver,
    options?: BrudFileSystemOptions,
  ) {
    this.driver = driver;
    this.journal = options?.mutationJournal ?? createFileMutationJournal();
    this.trustedWriteScopes = options?.trustedWriteScopes ?? [];
    this.onCleanupError = options?.onCleanupError;
    this.logger = options?.logger ?? DEFAULT_LOGGER;

    if (typeof workspaceOrRoot === 'string') {
      this.rootHint = workspaceOrRoot;
      this.workspaceProvider = new WorkspaceService({
        roots: [workspaceOrRoot],
        primaryRoot: workspaceOrRoot,
        port: createStorageDriverPathPort(driver),
        ...(options?.flavor === undefined ? {} : { flavor: options.flavor }),
      });
    } else {
      this.rootHint = options?.root ?? '';
      this.workspaceProvider = workspaceOrRoot;
    }
  }

  /** Canonical workspace root this instance is bound to. */
  get workspaceRoot(): string {
    return this.workspaceInstance?.primaryRoot ?? this.rootHint;
  }

  /** Mutation journal bound to this instance. */
  get mutationJournal(): IFileMutationJournal {
    return this.journal;
  }

  /**
   * Subscribes a pre/post mutation listener.
   *
   * @param listener - History or telemetry observer.
   * @returns An unsubscribe function.
   */
  onMutation(listener: FileMutationListener): () => void {
    return this.journal.subscribe(listener);
  }

  /**
   * Builds a projection that may mutate one or more protected prefixes.
   *
   * The capability is held by the projection, not by the shared instance, so
   * only the owning core service (history) receives it from the descriptor.
   *
   * @param scopes - Protected workspace-relative prefixes to trust.
   */
  createTrustedProjection(scopes: readonly string[]): IBrudFileSystem {
    return new TrustedFileSystemProjection(this, scopes);
  }

  async initialize(): Promise<void> {
    const workspace = await this.resolveWorkspace();
    const lifecycle = workspace as { initialize?: () => Promise<void> | void };

    await lifecycle.initialize?.();

    this.rootHint = workspace.primaryRoot;
    await this.driver.mkdir(this.rootHint, { recursive: true });
    await sweepStaleStagingFiles(this.driver, this.rootHint, {
      onError: (error, absolutePath) => this.reportCleanupError(error, absolutePath),
    });
  }

  async dispose(): Promise<void> {
    this.writeMutex.clear();
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    const { location } = await this.resolveTarget(relativePath);

    return readFileOperation(this.driver, location.absolutePath);
  }

  async readText(relativePath: string, encoding?: BufferEncoding): Promise<string> {
    const { location } = await this.resolveTarget(relativePath);

    return readTextOperation(this.driver, location.absolutePath, encoding);
  }

  async writeAtomic(relativePath: string, data: Uint8Array | string): Promise<void> {
    await this.performWriteAtomic(relativePath, data, []);
  }

  async createFile(
    relativePath: string,
    data: Uint8Array | string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    await this.performCreateFile(relativePath, data, options, []);
  }

  async deleteFile(relativePath: string): Promise<void> {
    await this.performDeleteFile(relativePath, []);
  }

  async rename(sourceRelativePath: string, destinationRelativePath: string): Promise<void> {
    await this.performRename(sourceRelativePath, destinationRelativePath, []);
  }

  async copy(sourceRelativePath: string, destinationRelativePath: string): Promise<void> {
    await this.performCopy(sourceRelativePath, destinationRelativePath, []);
  }

  async createDirectory(relativePath: string): Promise<void> {
    await this.performCreateDirectory(relativePath, []);
  }

  async deleteDirectory(relativePath: string): Promise<void> {
    await this.performDeleteDirectory(relativePath, []);
  }

  async readDirectory(relativeDirectoryPath: string): Promise<readonly DirectoryEntry[]> {
    const { location } = await this.resolveTarget(relativeDirectoryPath);

    return readDirectoryOperation(this.driver, location.absolutePath);
  }

  async stat(relativePath: string): Promise<FileStats | null> {
    const { location } = await this.resolveTarget(relativePath);

    return statPathOperation(this.driver, location.absolutePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    const { location } = await this.resolveTarget(relativePath);

    return this.driver.exists(location.absolutePath);
  }

  /** @internal Trusted projection entry point for {@link writeAtomic}. */
  async writeAtomicWithinScopes(
    relativePath: string,
    data: Uint8Array | string,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performWriteAtomic(relativePath, data, scopes);
  }

  /** @internal Trusted projection entry point for {@link createFile}. */
  async createFileWithinScopes(
    relativePath: string,
    data: Uint8Array | string,
    options: { overwrite?: boolean } | undefined,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performCreateFile(relativePath, data, options, scopes);
  }

  /** @internal Trusted projection entry point for {@link deleteFile}. */
  async deleteFileWithinScopes(
    relativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performDeleteFile(relativePath, scopes);
  }

  /** @internal Trusted projection entry point for {@link rename}. */
  async renameWithinScopes(
    sourceRelativePath: string,
    destinationRelativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performRename(sourceRelativePath, destinationRelativePath, scopes);
  }

  /** @internal Trusted projection entry point for {@link copy}. */
  async copyWithinScopes(
    sourceRelativePath: string,
    destinationRelativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performCopy(sourceRelativePath, destinationRelativePath, scopes);
  }

  /** @internal Trusted projection entry point for {@link createDirectory}. */
  async createDirectoryWithinScopes(
    relativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performCreateDirectory(relativePath, scopes);
  }

  /** @internal Trusted projection entry point for {@link deleteDirectory}. */
  async deleteDirectoryWithinScopes(
    relativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    await this.performDeleteDirectory(relativePath, scopes);
  }

  private async performWriteAtomic(
    relativePath: string,
    data: Uint8Array | string,
    scopes: readonly string[],
  ): Promise<void> {
    const target = await this.resolveTarget(relativePath);

    await this.writeMutex.runExclusive(target.location.absolutePath, async () => {
      const trustedScopes = this.scopesWith(scopes);
      const validation = await this.validateWriteTarget(relativePath, target, trustedScopes);
      const tracked = this.journal.enabled;
      const mutationId = tracked ? this.newMutationId() : '';
      const previous = tracked
        ? await captureMutationState(this.driver, target.location.absolutePath)
        : missingState();
      const intended = tracked ? await fileStateFromPayload(data) : missingState();
      const mode = this.modeFor(validation.stats);
      const stagingPath = await this.resolveStagingPath(
        target,
        createStagingPath(target.location.absolutePath),
      );

      await this.ensureTrackedParent(target);

      try {
        await writeAtomicOperation(this.driver, target.location.absolutePath, data, {
          stagingPath,
          mode,
          ...(tracked
            ? { beforeCommit: (): void => this.emit('write', 'before', target, mutationId, previous, intended) }
            : {}),
        });
      } catch (error: unknown) {
        if (error instanceof CommittedWithDurabilityWarningError) {
          await this.publishCommittedWithWarning('write', target, mutationId, previous, error);
        }

        throw error;
      }

      if (tracked) {
        const actual = await captureMutationState(this.driver, target.location.absolutePath);

        this.emit('write', 'after', target, mutationId, previous, actual, {
          status: 'committed',
          committed: true,
        });
      }
    });
  }

  private async performCreateFile(
    relativePath: string,
    data: Uint8Array | string,
    options: { overwrite?: boolean } | undefined,
    scopes: readonly string[],
  ): Promise<void> {
    const target = await this.resolveTarget(relativePath);

    await this.writeMutex.runExclusive(target.location.absolutePath, async () => {
      const trustedScopes = this.scopesWith(scopes);
      const validation = await this.validateWriteTarget(relativePath, target, trustedScopes);

      if (options?.overwrite === false && validation.stats !== null) {
        throw new FileAlreadyExistsError(target.location.absolutePath);
      }

      const tracked = this.journal.enabled;
      const mutationId = tracked ? this.newMutationId() : '';
      const previous = tracked
        ? await captureMutationState(this.driver, target.location.absolutePath)
        : missingState();
      const intended = tracked ? await fileStateFromPayload(data) : missingState();
      const mode = this.modeFor(validation.stats);
      const stagingPath = await this.resolveStagingPath(
        target,
        createStagingPath(target.location.absolutePath),
      );

      await this.ensureTrackedParent(target);

      try {
        await createFileOperation(this.driver, target.location.absolutePath, data, {
          stagingPath,
          mode,
          ...(options?.overwrite === undefined ? {} : { overwrite: options.overwrite }),
          ...(tracked
            ? { beforeCommit: (): void => this.emit('write', 'before', target, mutationId, previous, intended) }
            : {}),
        });
      } catch (error: unknown) {
        if (error instanceof CommittedWithDurabilityWarningError) {
          await this.publishCommittedWithWarning('write', target, mutationId, previous, error);
        }

        throw error;
      }

      if (tracked) {
        const actual = await captureMutationState(this.driver, target.location.absolutePath);

        this.emit('write', 'after', target, mutationId, previous, actual, {
          status: 'committed',
          committed: true,
        });
      }
    });
  }

  private async performDeleteFile(
    relativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    const target = await this.resolveTarget(relativePath);

    await this.writeMutex.runExclusive(target.location.absolutePath, async () => {
      const trustedScopes = this.scopesWith(scopes);
      this.assertMutableTarget(relativePath, target, trustedScopes);

      const stats = await this.driver.stat(target.location.absolutePath);

      if (stats === null) {
        return;
      }

      if (stats.isDirectory) {
        throw new FileSystemError(
          'CANNOT_DELETE_DIRECTORY',
          target.location.relativePath,
          `Cannot delete a directory through deleteFile: "${target.location.relativePath}"`,
        );
      }

      const tracked = this.journal.enabled;
      const mutationId = tracked ? this.newMutationId() : '';
      const previous = tracked
        ? await captureMutationState(this.driver, target.location.absolutePath)
        : missingState();
      const intended = missingState();

      if (tracked) {
        this.emit('unlink', 'before', target, mutationId, previous, intended);
      }

      await deleteFileOperation(this.driver, target.location.absolutePath);

      if (tracked) {
        const actual = await captureMutationState(this.driver, target.location.absolutePath);

        this.emit('unlink', 'after', target, mutationId, previous, actual, {
          status: 'committed',
          committed: true,
        });
      }
    });
  }

  private async performRename(
    sourceRelativePath: string,
    destinationRelativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    const source = await this.resolveTarget(sourceRelativePath);
    const destination = await this.resolveTarget(destinationRelativePath);

    await this.runExclusiveAll(
      [source.location.absolutePath, destination.location.absolutePath],
      async () => {
        const trustedScopes = this.scopesWith(scopes);

        this.assertMutableTarget(sourceRelativePath, source, trustedScopes);
        this.assertMutableTarget(destinationRelativePath, destination, trustedScopes);
        await this.assertRenamePreconditions(source, destination);

        const tracked = this.journal.enabled;
        const mutationId = tracked ? this.newMutationId() : '';
        const previousSource = tracked
          ? await captureMutationState(this.driver, source.location.absolutePath)
          : missingState();
        const previousDestination = tracked
          ? await captureMutationState(this.driver, destination.location.absolutePath)
          : missingState();

        if (tracked) {
          this.emit('renamed', 'before', source, mutationId, previousSource, missingState(), {
            sourcePath: source.location.relativePath,
            destinationPath: destination.location.relativePath,
          });
        }

        await renameOperation(
          this.driver,
          source.location.absolutePath,
          destination.location.absolutePath,
        );

        if (tracked) {
          const actual = await captureMutationState(
            this.driver,
            destination.location.absolutePath,
          );

          this.emit('renamed', 'after', destination, mutationId, previousDestination, actual, {
            status: 'committed',
            committed: true,
            sourcePath: source.location.relativePath,
            destinationPath: destination.location.relativePath,
          });
        }
      },
    );
  }

  private async performCopy(
    sourceRelativePath: string,
    destinationRelativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    const source = await this.resolveTarget(sourceRelativePath);
    const destination = await this.resolveTarget(destinationRelativePath);

    await this.runExclusiveAll(
      [source.location.absolutePath, destination.location.absolutePath],
      async () => {
        const trustedScopes = this.scopesWith(scopes);

        this.assertMutableTarget(sourceRelativePath, source, trustedScopes);
        this.assertMutableTarget(destinationRelativePath, destination, trustedScopes);
        await this.assertCopyPreconditions(source, destination);

        const tracked = this.journal.enabled;
        const mutationId = tracked ? this.newMutationId() : '';
        const previousDestination = tracked
          ? await captureMutationState(this.driver, destination.location.absolutePath)
          : missingState();
        const intended = tracked
          ? await captureMutationState(this.driver, source.location.absolutePath)
          : missingState();

        if (tracked) {
          this.emit('copied', 'before', destination, mutationId, previousDestination, intended, {
            sourcePath: source.location.relativePath,
            destinationPath: destination.location.relativePath,
          });
        }

        await copyOperation(
          this.driver,
          source.location.absolutePath,
          destination.location.absolutePath,
        );

        if (tracked) {
          const actual = await captureMutationState(
            this.driver,
            destination.location.absolutePath,
          );

          this.emit('copied', 'after', destination, mutationId, previousDestination, actual, {
            status: 'committed',
            committed: true,
            sourcePath: source.location.relativePath,
            destinationPath: destination.location.relativePath,
          });
        }
      },
    );
  }

  private async performCreateDirectory(
    relativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    const target = await this.resolveTarget(relativePath);

    await this.runExclusiveAll([target.location.absolutePath], async () => {
      const trustedScopes = this.scopesWith(scopes);

      this.assertMutableTarget(relativePath, target, trustedScopes);

      const existing = await this.driver.stat(target.location.absolutePath);

      if (existing !== null) {
        if (!existing.isDirectory) {
          throw new FileSystemError(
            'CONFLICT',
            target.location.relativePath,
            `A non-directory entry already exists at "${target.location.relativePath}"`,
          );
        }

        return;
      }

      const tracked = this.journal.enabled;
      const mutationId = tracked ? this.newMutationId() : '';

      if (tracked) {
        this.emit(
          'created_directory',
          'before',
          target,
          mutationId,
          missingState(),
          directoryState(),
        );
      }

      await createDirectoryOperation(this.driver, target.location.absolutePath);

      if (tracked) {
        const actual = await captureMutationState(
          this.driver,
          target.location.absolutePath,
        );

        this.emit('created_directory', 'after', target, mutationId, missingState(), actual, {
          status: 'committed',
          committed: true,
        });
      }
    });
  }

  private async performDeleteDirectory(
    relativePath: string,
    scopes: readonly string[],
  ): Promise<void> {
    const target = await this.resolveTarget(relativePath);

    await this.runExclusiveAll([target.location.absolutePath], async () => {
      const trustedScopes = this.scopesWith(scopes);

      this.assertMutableTarget(relativePath, target, trustedScopes);

      const stats = await this.driver.stat(target.location.absolutePath);

      if (stats === null) {
        return;
      }

      if (!stats.isDirectory) {
        throw new FileSystemError(
          'CANNOT_DELETE_FILE_AS_DIRECTORY',
          target.location.relativePath,
          `Cannot delete a file as a directory: "${target.location.relativePath}"`,
        );
      }

      const tracked = this.journal.enabled;
      const mutationId = tracked ? this.newMutationId() : '';

      if (tracked) {
        await this.captureDirectoryFileStates(target, mutationId);
        this.emit(
          'deleted_directory',
          'before',
          target,
          mutationId,
          directoryState(),
          missingState(),
        );
      }

      await deleteDirectoryOperation(this.driver, target.location.absolutePath);

      if (tracked) {
        this.emit(
          'deleted_directory',
          'after',
          target,
          mutationId,
          directoryState(),
          missingState(),
          { status: 'committed', committed: true },
        );
      }
    });
  }

  private async assertRenamePreconditions(
    source: ResolvedTarget,
    destination: ResolvedTarget,
  ): Promise<void> {
    if ((await this.driver.lstat(source.location.absolutePath)) === null) {
      throw new FileSystemError(
        'FILE_NOT_FOUND',
        source.location.relativePath,
        `Rename source does not exist: "${source.location.relativePath}"`,
      );
    }

    if ((await this.driver.lstat(destination.location.absolutePath)) !== null) {
      throw new FileSystemError(
        'CONFLICT',
        destination.location.relativePath,
        `Rename destination already exists: "${destination.location.relativePath}"`,
      );
    }

    const parent = await this.driver.stat(dirname(destination.location.absolutePath));

    if (parent === null || !parent.isDirectory) {
      throw new FileSystemError(
        'PARENT_NOT_FOUND',
        destination.location.relativePath,
        `Rename destination parent does not exist: "${destination.location.relativePath}"`,
      );
    }
  }

  private async assertCopyPreconditions(
    source: ResolvedTarget,
    destination: ResolvedTarget,
  ): Promise<void> {
    if ((await this.driver.lstat(source.location.absolutePath)) === null) {
      throw new FileSystemError(
        'FILE_NOT_FOUND',
        source.location.relativePath,
        `Copy source does not exist: "${source.location.relativePath}"`,
      );
    }

    if ((await this.driver.lstat(destination.location.absolutePath)) !== null) {
      throw new FileSystemError(
        'CONFLICT',
        destination.location.relativePath,
        `Copy destination already exists: "${destination.location.relativePath}"`,
      );
    }

    const parent = await this.driver.stat(dirname(destination.location.absolutePath));

    if (parent === null || !parent.isDirectory) {
      throw new FileSystemError(
        'PARENT_NOT_FOUND',
        destination.location.relativePath,
        `Copy destination parent does not exist: "${destination.location.relativePath}"`,
      );
    }
  }

  private async captureDirectoryFileStates(
    target: ResolvedTarget,
    mutationId: string,
  ): Promise<void> {
    const pending: Array<{ readonly absolutePath: string; readonly relativePath: string }> = [
      {
        absolutePath: target.location.absolutePath,
        relativePath: target.location.relativePath,
      },
    ];

    while (pending.length > 0) {
      const current = pending.pop();

      if (current === undefined) {
        continue;
      }

      let entries: readonly DirectoryEntry[];

      try {
        entries = await this.driver.readDir(current.absolutePath);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const absolutePath = `${current.absolutePath}/${entry.name}`;
        const relativePath = `${current.relativePath}/${entry.name}`;

        if (entry.isDirectory) {
          pending.push({ absolutePath, relativePath });
          continue;
        }

        if (!entry.isFile) {
          continue;
        }

        const state = await captureMutationState(this.driver, absolutePath);

        this.emitAtPath(
          'unlink',
          'before',
          relativePath,
          mutationId,
          state,
          missingState(),
        );
      }
    }
  }

  private async runExclusiveAll<T>(
    keys: readonly string[],
    task: () => Promise<T>,
  ): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();

    const run = async (index: number): Promise<T> => {
      if (index >= uniqueKeys.length) {
        return task();
      }

      const key = uniqueKeys[index] as string;

      return this.writeMutex.runExclusive(key, () => run(index + 1));
    };

    return run(0);
  }

  private async resolveWorkspace(): Promise<IWorkspaceService> {
    if (this.workspaceInstance !== undefined) {
      return this.workspaceInstance;
    }

    const provider = this.workspaceProvider;
    const instance = typeof provider === 'function' ? provider() : provider;

    this.workspaceInstance = instance;

    return instance;
  }

  private async resolveTarget(relativePath: string): Promise<ResolvedTarget> {
    const workspace = await this.resolveWorkspace();
    const location = supportsResolveContained(workspace)
      ? await workspace.resolveContained(relativePath)
      : await workspace.resolve(relativePath);

    return { workspace, location };
  }

  /**
   * Validates a write target before any staging or journal publication.
   *
   * Rejects the workspace root, directories, and the immutable protected-path
   * denylist. Absolute paths are accepted only when `WorkspaceService` already
   * proved they are inside the canonical root.
   */
  private async validateWriteTarget(
    callerPath: string,
    target: ResolvedTarget,
    trustedScopes: readonly string[],
  ): Promise<TargetValidation> {
    this.assertMutableTarget(callerPath, target, trustedScopes);

    const stats = await this.driver.stat(target.location.absolutePath);

    if (stats?.isDirectory === true) {
      throw new FileSystemError(
        'CANNOT_WRITE_DIRECTORY',
        target.location.relativePath,
        `Cannot write to a directory: "${target.location.relativePath}"`,
      );
    }

    return { stats };
  }

  private assertMutableTarget(
    callerPath: string,
    target: ResolvedTarget,
    trustedScopes: readonly string[],
  ): void {
    const relative = target.location.relativePath;

    if (relative === '' || relative === '.') {
      throw new WorkspaceViolationError(
        'PATH_VIOLATION',
        callerPath,
        'the workspace root is not a mutable file target',
        target.location.root,
      );
    }

    assertNotProtectedPath(relative, trustedScopes);
  }

  private scopesWith(extraScopes: readonly string[]): readonly string[] {
    if (this.trustedWriteScopes.length === 0) {
      return extraScopes;
    }

    if (extraScopes.length === 0) {
      return this.trustedWriteScopes;
    }

    return [...this.trustedWriteScopes, ...extraScopes];
  }

  private modeFor(stats: FileStats | null): number {
    return stats?.isFile === true && stats.mode !== undefined
      ? stats.mode & 0o777
      : 0o644;
  }

  /**
   * Re-validates the generated staging path through `WorkspaceService`.
   *
   * The staging file lives beside the target, so containment is inherited
   * from the target's canonical parent. Routing it through the workspace
   * authority keeps the invariant that drivers never receive an unvalidated
   * absolute path.
   */
  private async resolveStagingPath(
    target: ResolvedTarget,
    stagingPath: string,
  ): Promise<string> {
    const workspace = target.workspace;
    const location = supportsResolveContained(workspace)
      ? await workspace.resolveContained(stagingPath)
      : await workspace.resolve(stagingPath);

    if (location.root !== target.location.root) {
      throw new WorkspaceViolationError(
        'OUTSIDE_ROOT',
        stagingPath,
        'the staging path resolved outside the target workspace root',
        target.location.root,
      );
    }

    return location.absolutePath;
  }

  private async publishCommittedWithWarning(
    operation: FileMutationOperation,
    target: ResolvedTarget,
    mutationId: string,
    previous: FileMutationState,
    error: CommittedWithDurabilityWarningError,
  ): Promise<void> {
    if (!this.journal.enabled) {
      return;
    }

    const actual = await captureMutationState(this.driver, target.location.absolutePath);

    this.emit(operation, 'after', target, mutationId, previous, actual, {
      status: 'committed_with_durability_warning',
      committed: true,
      error: error.fsyncError,
    });
  }

  private reportCleanupError(error: unknown, absolutePath: string): void {
    if (this.onCleanupError !== undefined) {
      try {
        this.onCleanupError(error, absolutePath);
      } catch {
        // A broken cleanup sink must not fail initialization.
      }

      return;
    }

    try {
      this.logger.warn('brud.core.filesystem: staging sweep failed', {
        path: absolutePath,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Logging must never fail initialization.
    }
  }

  /**
   * Announces directory creation performed implicitly by a file mutation.
   *
   * The event is emitted only when a journal listener is present, and only for
   * a parent that does not exist yet.
   */
  private async ensureTrackedParent(target: ResolvedTarget): Promise<void> {
    if (!this.journal.enabled || target.location.relativePath === '') {
      return;
    }

    const separatorIndex = target.location.relativePath.lastIndexOf('/');

    if (separatorIndex < 0) {
      return;
    }

    const parentRelativePath = separatorIndex === 0
      ? ''
      : target.location.relativePath.slice(0, separatorIndex);

    if (parentRelativePath === '') {
      return;
    }

    const parentAbsolutePath = target.workspace.toAbsolutePath(
      parentRelativePath,
      target.location.root,
    );

    if (await this.driver.exists(parentAbsolutePath)) {
      return;
    }

    const mutationId = this.newMutationId();
    const previous = missingState();
    const intended = directoryState();

    this.emitAtPath('mkdir', 'before', parentRelativePath, mutationId, previous, intended);
    await this.driver.mkdir(parentAbsolutePath, { recursive: true });
    const actual = await captureMutationState(this.driver, parentAbsolutePath);

    this.emitAtPath('mkdir', 'after', parentRelativePath, mutationId, previous, actual, {
      status: 'committed',
      committed: true,
    });
  }

  private emit(
    operation: FileMutationOperation,
    phase: FileMutationPhase,
    target: ResolvedTarget,
    mutationId: string,
    previous: FileMutationState,
    updated: FileMutationState,
    extra?: Pick<
      FileMutationEvent,
      'status' | 'committed' | 'error' | 'sourcePath' | 'destinationPath'
    >,
  ): void {
    this.emitAtPath(
      operation,
      phase,
      target.location.relativePath,
      mutationId,
      previous,
      updated,
      extra,
    );
  }

  private emitAtPath(
    operation: FileMutationOperation,
    phase: FileMutationPhase,
    path: string,
    mutationId: string,
    previous: FileMutationState,
    updated: FileMutationState,
    extra?: Pick<
      FileMutationEvent,
      'status' | 'committed' | 'error' | 'sourcePath' | 'destinationPath'
    >,
  ): void {
    const event: FileMutationEvent = {
      mutationId,
      operation,
      phase,
      path,
      previous,
      updated,
      timestamp: Date.now(),
      ...(extra ?? {}),
    };

    this.journal.publish(event);
  }

  private newMutationId(): string {
    return globalThis.crypto.randomUUID();
  }
}
