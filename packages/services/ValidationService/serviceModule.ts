import type { IStorageDriver } from '../BrudFileSystem/contracts/index.js';
import type { KernelServiceModuleContext } from '@brud/kernel';
import type { WorkspaceDescriptorOptions } from '../WorkspaceService/descriptor/descriptor.js';
import type { ValidationDescriptorOptions } from './descriptor/ValidationDescriptor.js';
import {
  createValidationDescriptor,
  pinBootPolicies as pinBootPoliciesForInstances,
} from './descriptor/ValidationDescriptor.js';

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

  return descriptor;
}

export function pinBootPolicies(
  _context: KernelServiceModuleContext,
  instances: readonly object[],
): Promise<void> {
  return pinBootPoliciesForInstances(instances);
}