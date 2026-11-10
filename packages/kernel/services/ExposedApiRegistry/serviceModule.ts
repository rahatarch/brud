import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import { createExposedApiRegistryDescriptor } from './descriptor/ExposedApiRegistryDescriptor.js';
import type { IExposedApiRegistry } from './contracts/IExposedApiRegistry.js';
import { isExposedApiRegistrant } from './contracts/registrant.js';

const REGISTRY_SLOT = 'brud.core.exposedApiRegistry.instance';

export function createService(context: KernelServiceModuleContext) {
  return createExposedApiRegistryDescriptor({
    onConstruct: (service) => {
      context.shared[REGISTRY_SLOT] = service;
    },
  });
}

export function registerBootRegistrants(
  context: KernelServiceModuleContext,
  instances: readonly object[],
): void {
  const registry = context.shared[REGISTRY_SLOT] as IExposedApiRegistry | undefined;

  if (registry === undefined) {
    return;
  }

  for (const instance of instances) {
    if (isExposedApiRegistrant(instance)) {
      instance.registerWithApiRegistry(registry);
    }
  }

  registry.closeRegistration();
}