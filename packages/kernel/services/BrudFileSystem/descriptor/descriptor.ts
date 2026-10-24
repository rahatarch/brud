import type { ServiceContext } from '../../../src/contracts/lifecycle.js';
import type { ServiceDescriptor } from '../../../src/contracts/serviceDescriptor.js';
import { NodeStorageDriver } from '../../../drivers/node/index.js';
import type { IBrudFileSystem } from '../contracts/IBrudFileSystem/IBrudFileSystem.js';
import { BrudFileSystem } from '../orchestrator/BrudFileSystem.js';
import { ReadOnlyFacade } from '../projection/ReadOnlyFacade/ReadOnlyFacade.js';
import { ScopedPartitionFacade } from '../projection/ScopedPartitionFacade/ScopedPartitionFacade.js';
import { FileSystemToken } from './tokens.js';

export const FileSystemDescriptor: ServiceDescriptor<IBrudFileSystem, BrudFileSystem> = {
  token: FileSystemToken,
  tier: 'core',
  dependencies: [],
  factory: (context: ServiceContext): BrudFileSystem =>
    new BrudFileSystem(context.workspaceRoot, new NodeStorageDriver()),
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
