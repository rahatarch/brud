import type { IStorageDriver } from '../../drivers/contracts/index.js';
import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { IKernelAccessBroker } from '../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import type { WorkspaceDescriptorOptions } from './descriptor/descriptor.js';
import { createWorkspaceDescriptor } from './descriptor/descriptor.js';
import { MissingWorkspaceRootError } from './bootOptions.js';

const WORKSPACE_SLOT = 'brud.core.workspace.instance';

export function createService(context: KernelServiceModuleContext) {
  const workspaceRoot = context.options['workspaceRoot'];

  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    throw new MissingWorkspaceRootError();
  }

  const options = context.options['workspace'] as WorkspaceDescriptorOptions | undefined;
  const driver = options?.driver
    ?? (context.options['storageDriver'] as IStorageDriver | undefined);
  const descriptor = createWorkspaceDescriptor({
    ...options,
    roots: options?.roots !== undefined && options.roots.length > 0
      ? options.roots
      : [workspaceRoot],
    primaryRoot: options?.primaryRoot ?? workspaceRoot,
    ...(driver === undefined ? {} : { driver }),
  });

  return {
    ...descriptor,
    factory: (serviceContext: ServiceContext, broker: IKernelAccessBroker) => {
      const instance = descriptor.factory(serviceContext, broker);

      context.shared[WORKSPACE_SLOT] = instance;

      return instance;
    },
  };
}