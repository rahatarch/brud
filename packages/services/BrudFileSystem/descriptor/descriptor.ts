import type { IStorageDriver } from '@brud/kernel';
import type { ServiceContext } from '@brud/kernel';
import type { ServiceDescriptor } from '@brud/kernel';
import { CORE_API_NAME, lastProjectionWins, withExposedApis } from '../../ExposedApiRegistry/contracts/index.js';
import { SettingsReaderToken } from '../../SettingsService/descriptor/tokens.js';
import type { WorkspacePathFlavor } from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import { requireContextString } from '@brud/kernel';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import type { IFileMutationJournal } from '../events/types.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import type { ValidationAuthority, WorkspaceAuthority } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemToken } from './tokens.js';

/** Namespace owned by the filesystem service in the context contract. */
export const FILESYSTEM_CONTEXT_SCOPE = 'filesystem';

/** Namespaced context field holding the workspace root. */
export const FILESYSTEM_ROOT_CONTEXT_FIELD = 'filesystem.root';

/** Configuration for {@link createFileSystemDescriptor}. */
export interface FileSystemDescriptorOptions {
  /** Storage backend used by the service. Defaults to {@link DurableNodeStorageDriver}. */
  readonly driver?: IStorageDriver;

  /**
   * Canonical workspace authority injected by the kernel composition.
   *
   * The standard bootstrap supplies a probe that returns the already
   * initialized `brud.core.workspace` instance. When omitted, the descriptor
   * builds a single-root `WorkspaceService` over the boot workspace root so
   * the filesystem remains usable in standalone compositions.
   */
  readonly workspace?: WorkspaceAuthority;

  /**
   * Policy authority injected by the kernel composition.
   *
   * The standard bootstrap supplies a probe that returns the already
   * initialized `brud.core.validation` instance; validation is constructed
   * after the filesystem in the boot order, so the probe is lazy. When
   * omitted, the filesystem constructs a standalone validation service over
   * its workspace authority.
   */
  readonly validation?: ValidationAuthority;

  /**
   * Canonical workspace root the service binds to when no workspace authority
   * is injected. Defaults to the declared `filesystem.root` context field.
   */
  readonly root?: string;

  /** Path flavor used by the standalone fallback workspace authority. */
  readonly flavor?: WorkspacePathFlavor;

  /**
   * Mutation journal the filesystem publishes pre/post descriptors to.
   * Defaults to a private journal that is enabled when a listener subscribes.
   */
  readonly mutationJournal?: IFileMutationJournal;

  /**
   * Protected-prefix capabilities granted to specific core callers.
   *
   * None are granted by default: the history engine writes `.brud/history`
   * through the storage driver, never through this service (D-15 U-7). A
   * capability is applied to the caller-facing projection rather than to the
   * shared instance.
   */
  readonly authorizedWriteScopesByCaller?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Builds the filesystem service descriptor.
 *
 * Declared dependencies make the boot graph explicit:
 *
 * - `brud.core.workspace` is the single path authority. Every operation is
 *   canonicalized and containment-checked there before a driver is touched.
 * - `brud.core.settings.reader` establishes ordering behind the workspace
 *   authority; containment never consults mutable settings.
 *
 * @param options - Driver, workspace authority, root, and journal overrides.
 * @returns A core-tier descriptor for `brud.core.filesystem`.
 */
export function createFileSystemDescriptor(
  options?: FileSystemDescriptorOptions,
): ServiceDescriptor<IBrudFileSystem, BrudFileSystem> {
  const driver = options?.driver ?? new DurableNodeStorageDriver();

  const authorizedScopesByCaller = { ...options?.authorizedWriteScopesByCaller };

  return {
    token: FileSystemToken,
    tier: 'core',
    dependencies: [WorkspaceToken, SettingsReaderToken],
    // Explicit policy: every tier may resolve the token, but mutating
    // authority is enforced by `project`. No caller is globally denied, so a
    // userland plugin can still receive a read-only projection.
    accessPolicy: { deniedCallers: [] },
    factory: (context: ServiceContext): BrudFileSystem => {
      const root = options?.root ?? requireContextString(
        context.options,
        FILESYSTEM_ROOT_CONTEXT_FIELD,
        FileSystemToken.id,
      );
      const serviceOptions = {
        root,
        ...(options?.mutationJournal === undefined
          ? {}
          : { mutationJournal: options.mutationJournal }),
        ...(options?.flavor === undefined ? {} : { flavor: options.flavor }),
        ...(options?.validation === undefined ? {} : { validation: options.validation }),
      };

      const instance = options?.workspace !== undefined
        ? new BrudFileSystem(options.workspace, driver, serviceOptions)
        : new BrudFileSystem(root, driver, serviceOptions);

      return withExposedApis(instance, (registry) => {
        registry.registerApi(CORE_API_NAME.fileSystem, FileSystemToken, {
          capability: 'fs:read',
          scope: 'runtime',
          projection: (service) => new ReadOnlyFacade(service as IBrudFileSystem),
          combine: lastProjectionWins,
        });
        registry.registerApi(CORE_API_NAME.fileSystem, FileSystemToken, {
          capability: 'fs:write',
          scope: 'runtime',
          combine: lastProjectionWins,
        });
      });
    },
    project: (instance: BrudFileSystem, caller: ServiceContext): IBrudFileSystem => {
      const authorizedScopes = authorizedScopesByCaller[caller.callerId] ?? [];
      let projection: IBrudFileSystem = caller.tier === 'core' && authorizedScopes.length > 0
        ? instance.createAuthorizedProjection(authorizedScopes)
        : instance;

      if (caller.partitionPrefix !== undefined && caller.partitionPrefix.length > 0) {
        projection = new ScopedPartitionFacade(projection, caller.partitionPrefix);
      }

      if (caller.tier === 'userland') {
        projection = new ReadOnlyFacade(projection);
      }

      if (caller.tier === 'kernel' && (caller.partitionPrefix === undefined || caller.partitionPrefix.length === 0)) {
        // Raw writable handles are reserved for `tier: 'core'`. Kernel-tier
        // callers without an explicit partition receive read-only access.
        projection = new ReadOnlyFacade(projection);
      }

      return projection;
    },
  };
}

export const FileSystemDescriptor: ServiceDescriptor<IBrudFileSystem, BrudFileSystem> =
  createFileSystemDescriptor();
