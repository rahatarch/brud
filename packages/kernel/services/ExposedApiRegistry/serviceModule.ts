import type { KernelServiceModuleContext } from '../../src/bootstrap/bootTypes.js';
import {
  EXPOSED_API_REGISTRY_CONTEXT_SCOPE,
  EXPOSED_API_SCOPE_RECORD_PATH_FIELD,
  createExposedApiRegistryDescriptor,
} from './descriptor/ExposedApiRegistryDescriptor.js';
import type { IExposedApiRegistry } from './contracts/IExposedApiRegistry.js';
import { isExposedApiRegistrant } from './contracts/registrant.js';

const REGISTRY_SLOT = 'brud.core.exposedApiRegistry.instance';

export function createService(context: KernelServiceModuleContext) {
  context.declareContextFields(EXPOSED_API_REGISTRY_CONTEXT_SCOPE, [
    {
      name: EXPOSED_API_SCOPE_RECORD_PATH_FIELD,
      type: 'string',
      required: false,
      description: 'Absolute path to the protected exposed API scope record.',
    },
  ]);

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