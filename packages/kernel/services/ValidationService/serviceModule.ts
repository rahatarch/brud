import type { IStorageDriver } from '../../drivers/contracts/index.js';
import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import type { IKernelAccessBroker } from '../../src/contracts/accessBroker.js';
import type { ServiceContext } from '../../src/contracts/lifecycle.js';
import type { WorkspaceDescriptorOptions } from '../WorkspaceService/descriptor/descriptor.js';
import type { ValidationDescriptorOptions } from './descriptor/ValidationDescriptor.js';
import {
  createValidationDescriptor,
  pinBootPolicies as pinBootPoliciesForInstances,
} from './descriptor/ValidationDescriptor.js';

const VALIDATION_SLOT = 'brud.core.validation.instance';

export function createService(context: KernelServiceModuleContext) {
  const options = context.options['validation'] as
    | ValidationDescriptorOptions
    | undefined;
  const workspaceOptions = context.options['workspace'] as
    | WorkspaceDescriptorOptions
    | undefined;
  const workspaceDriver = workspaceOptions?.driver
    ?? (context.options['storageDriver'] as IStorageDriver | undefined);
  const descriptor = createValidationDescriptor({
    ...options,
    ...(options?.ignoreFileReader === undefined && workspaceDriver !== undefined
      ? {
          ignoreFileReader: (absolutePath: string) =>
            workspaceDriver.readFile(absolutePath),
        }
      : {}),
  });

  return {
    ...descriptor,
    factory: (serviceContext: ServiceContext, broker: IKernelAccessBroker) => {
      const instance = descriptor.factory(serviceContext, broker);

      context.shared[VALIDATION_SLOT] = instance;

      return instance;
    },
  };
}

export function pinBootPolicies(
  _context: KernelServiceModuleContext,
  instances: readonly object[],
): Promise<void> {
  return pinBootPoliciesForInstances(instances);
}