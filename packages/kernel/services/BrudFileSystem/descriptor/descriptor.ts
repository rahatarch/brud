import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import type { IStorageDriver } from '../../../drivers/contracts/index.js';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemToken } from './tokens.js';

export interface FileSystemDescriptorOptions {
  /** Storage backend used by the service. Defaults to {@link NodeStorageDriver}. */
  readonly driver?: IStorageDriver;

  /**
   * Canonical workspace root the service binds to.
   *
   * When set, the factory uses this root instead of the (possibly
   * uncanonicalized) `context.workspaceRoot`, which is what keeps the
   * filesystem's `PathValidator` root identical to
   * `WorkspaceService.primaryRoot`.
   */
  readonly root?: string;
}

export function createFileSystemDescriptor(
  options?: FileSystemDescriptorOptions,
): ServiceDescriptor<IBrudFileSystem, BrudFileSystem> {
  const driver = options?.driver ?? new NodeStorageDriver();

  return {
    token: FileSystemToken,
    tier: 'core',
    dependencies: [],
    factory: (context: ServiceContext): BrudFileSystem =>
      new BrudFileSystem(options?.root ?? context.workspaceRoot, driver),
    project: (instance: BrudFileSystem, caller: ServiceContext): IBrudFileSystem => {
      let projection: IBrudFileSystem = instance;

      if (caller.partitionPrefix !== undefined && caller.partitionPrefix.length > 0) {
        projection = new ScopedPartitionFacade(projection, caller.partitionPrefix);
      }

      if (caller.tier === 'userland') {
        projection = new ReadOnlyFacade(projection);
      }

      return projection;
    },
  };
}

export const FileSystemDescriptor: ServiceDescriptor<IBrudFileSystem, BrudFileSystem> =
  createFileSystemDescriptor();
