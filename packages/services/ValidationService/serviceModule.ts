import type { IStorageDriver } from '../BrudFileSystem/contracts/index.js';
import type { KernelServiceModuleContext } from '@brud/kernel';
import type { IKernelAccessBroker } from '@brud/kernel';
import type { ServiceContext } from '@brud/kernel';
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