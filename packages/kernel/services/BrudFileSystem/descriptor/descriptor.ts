import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { SettingsReaderToken } from '../../SettingsService/descriptor/tokens.js';
import type { WorkspacePathFlavor } from '../../WorkspaceService/contracts/IWorkspaceService.js';
import { WorkspaceToken } from '../../WorkspaceService/descriptor/tokens.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { DurableNodeStorageDriver } from '../drivers/DurableNodeStorageDriver.js';
import type { IFileMutationJournal } from '../events/types.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import type { WorkspaceAuthority } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemToken } from './tokens.js';

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
   * Canonical workspace root the service binds to when no workspace authority
   * is injected. Defaults to `context.workspaceRoot`.
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
   * Only the owning subsystem is listed (history owns `.brud/history`), and
   * the capability is applied to the caller-facing projection rather than to
   * the shared instance.
   */
  readonly trustedWriteScopesByCaller?: Readonly<Record<string, readonly string[]>>;
}

const DEFAULT_TRUSTED_WRITE_SCOPES: Readonly<Record<string, readonly string[]>> = {
  'brud.core.universalHistory': ['.brud/history'],
};

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

  const trustedScopesByCaller = {
    ...DEFAULT_TRUSTED_WRITE_SCOPES,
    ...options?.trustedWriteScopesByCaller,
  };

  return {
    token: FileSystemToken,
    tier: 'core',
    dependencies: [WorkspaceToken, SettingsReaderToken],
    // Explicit policy: every tier may resolve the token, but mutating
    // authority is enforced by `project`. No caller is globally denied, so a
    // userland plugin can still receive a read-only projection.
    accessPolicy: { deniedCallers: [] },
    factory: (context: ServiceContext): BrudFileSystem => {
      const root = options?.root ?? context.workspaceRoot;
      const serviceOptions = {
        root,
        ...(options?.mutationJournal === undefined
          ? {}
          : { mutationJournal: options.mutationJournal }),
        ...(options?.flavor === undefined ? {} : { flavor: options.flavor }),
      };

      if (options?.workspace !== undefined) {
        return new BrudFileSystem(options.workspace, driver, serviceOptions);
      }

      return new BrudFileSystem(root, driver, serviceOptions);
    },
    project: (instance: BrudFileSystem, caller: ServiceContext): IBrudFileSystem => {
      const trustedScopes = trustedScopesByCaller[caller.callerId] ?? [];
      let projection: IBrudFileSystem = caller.tier === 'core' && trustedScopes.length > 0
        ? instance.createTrustedProjection(trustedScopes)
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
