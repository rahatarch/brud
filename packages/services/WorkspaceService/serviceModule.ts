import type { IStorageDriver } from '@brud/kernel';
import type { KernelServiceModuleContext } from '@brud/kernel';
import type { IKernelAccessBroker } from '@brud/kernel';
import type { ServiceContext } from '@brud/kernel';
import type { WorkspaceDescriptorOptions } from './descriptor/descriptor.js';
import { createWorkspaceDescriptor } from './descriptor/descriptor.js';
import {
  WORKSPACE_CONTEXT_SCOPE,
  WORKSPACE_ROOT_CONTEXT_FIELD,
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

  const options = context.options['workspace'] as WorkspaceDescriptorOptions | undefined;
  const driver = options?.driver
    ?? (context.options['storageDriver'] as IStorageDriver | undefined);

  // The root itself is read by the descriptor factory at boot, after the
  // context contract has validated every required field. Composition must not
  // enforce it here: that would make this one field fail in a different phase
  // and with a service-specific error type.
  const descriptor = createWorkspaceDescriptor({
    ...options,
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