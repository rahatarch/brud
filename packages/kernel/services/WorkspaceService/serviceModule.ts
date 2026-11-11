import type { IStorageDriver } from '../../drivers/contracts/index.js';
import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { IKernelAccessBroker } from '../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import type { WorkspaceDescriptorOptions } from './descriptor/descriptor.js';
import { createWorkspaceDescriptor } from './descriptor/descriptor.js';
import {
  WORKSPACE_CONTEXT_SCOPE,
  WORKSPACE_ROOT_CONTEXT_FIELD,
  requireNamespacedWorkspaceRoot,
} from './bootOptions.js';

const WORKSPACE_SLOT = 'brud.core.workspace.instance';

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(WORKSPACE_CONTEXT_SCOPE, [
    {
      name: WORKSPACE_ROOT_CONTEXT_FIELD,
      type: 'string',
      required: true,
      description: 'Absolute root of the workspace served by this kernel.',
    },
  ]);

  const workspaceRoot = requireNamespacedWorkspaceRoot(
    context.options,
    'brud.core.workspace',
  );

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